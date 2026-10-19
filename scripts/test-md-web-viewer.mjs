#!/usr/bin/env node
/**
 * Regression tests for the md-web viewer: the document-route guard in
 * assets/config.js, and the Content-Security-Policy in index.html that makes the
 * guard's job survivable even if it regresses.
 *
 * Why this exists. A viewer link is `#/md-web/<name>`, and the route comes straight
 * out of the URL fragment — i.e. out of a link anyone can be sent. Docsify resolves a
 * route containing ":" or "//" as a *remote* URL and fetches it with XMLHttpRequest,
 * then inserts the returned Markdown as HTML with sanitizing off. A crafted link
 * (`#https://someone-elses-host/x.md`, on a host that answers with CORS) therefore
 * rendered attacker-controlled HTML on this origin. The guard refuses every route that
 * is not a same-origin path under md-web/, and connect-src 'self' blocks the fetch
 * behind it.
 *
 * The guard runs as a plain browser script, so it is exercised the way a browser runs
 * it — in a vm context with location/history/window stubs — rather than by importing
 * an exported function. Nothing test-only is exported from the shipped file.
 *
 * Usage:
 *   node scripts/test-md-web-viewer.mjs
 *
 * Needs no dependencies.
 */
import { readFileSync, existsSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "skills", "md-web", "docsify-server");
const CONFIG_JS = join(SERVER, "assets", "config.js");
const INDEX_HTML = join(SERVER, "index.html");

let failures = 0;
const fail = (msg) => { console.error(`  FAIL  ${msg}`); failures++; };
const pass = (msg) => console.log(`  ok    ${msg}`);

/** Load config.js in a sandbox that behaves enough like a browser for the guard. */
function loadViewer(hash) {
  const calls = { replaceState: [], replace: [], listeners: [] };
  const location = { hash, pathname: "/index.html", search: "", replace: (url) => calls.replace.push(url) };
  const sandbox = {
    location,
    // A real replaceState rewrites location.hash in place, and config.js reads the
    // hash again right after (for search.paths). Mirror that or the test would be
    // checking a state no browser can be in.
    history: {
      replaceState: (_state, _title, url) => {
        calls.replaceState.push(url);
        location.hash = url.slice(url.indexOf("#"));
      },
    },
    window: { addEventListener: (type, fn) => { if (type === "hashchange") calls.listeners.push(fn); } },
    document: { title: "MD Web" },
    console,
  };
  sandbox.window.location = location;
  createContext(sandbox);
  runInContext(readFileSync(CONFIG_JS, "utf8"), sandbox, { filename: CONFIG_JS });
  return { calls, sandbox };
}

/** Open `hash`, then fire a hashchange for `to` the way a link click would. */
function navigates(from, to) {
  const { calls } = loadViewer(from);
  calls.replace.length = 0;
  const ctx = loadViewer(from);
  ctx.sandbox.location.hash = to;
  for (const fn of ctx.calls.listeners) fn();
  return ctx.calls.replace;
}

// ── Route guard ──
const ALLOWED = [
  ["#/", "landing page"],
  ["#", "bare hash"],
  ["", "no hash at all"],
  ["#/index.html", "viewer file by name"],
  ["#/md-web/20260305-091500-api-docs", "a document this skill published"],
  ["#/md-web/20260305-091500-api-docs?id=section", "a document with an anchor"],
  ["#/md-web/nested/deep-note.md", "a document with an extension"],
];

const BLOCKED = [
  ["#//evil.example/x.md", "protocol-relative URL"],
  ["#/../secrets.md", "traversal out of the prefix"],
  ["#/md-web/../../secret.md", "traversal from inside the prefix"],
  ["#/md-web/%2e%2e/%2e%2e/secret.md", "percent-encoded traversal"],
  ["#/md-web/%zz.md", "malformed percent-encoding"],
  ["#http://evil.example/x.md", "absolute http URL"],
  ["#https://evil.example/x.md", "absolute https URL"],
  ["#javascript:alert(1)", "javascript: URL"],
  ["#data:text/html,<script>alert(1)</script>", "data: URL"],
  ["#/md-web\\..\\secret.md", "backslash traversal"],
  ["#md-web/x.md", "prefix without a leading slash"],
  ["#/elsewhere/x.md", "same-origin path outside md-web/"],
];

for (const [hash, what] of ALLOWED) {
  const { calls, sandbox } = loadViewer(hash);
  if (calls.replaceState.length) fail(`${what} (${hash || "<empty>"}) was rewritten to ${calls.replaceState[0]}`);
  else pass(`${what} (${hash || "<empty>"}) is left alone`);
}

for (const [hash, what] of BLOCKED) {
  const { calls, sandbox } = loadViewer(hash);
  // Two things have to hold: nothing was fetched from the crafted route, and the
  // search index did not inherit it either.
  const searchPath = sandbox.window.$docsify.search.paths[0];
  const rewrote = calls.replaceState.length > 0 || calls.replace.length > 0;
  if (!rewrote) fail(`${what} (${hash}) was not refused on first load`);
  else if (searchPath !== "/") fail(`${what} (${hash}) still reached search.paths as ${searchPath}`);
  else pass(`${what} (${hash}) is refused, and search falls back to "/"`);
}

for (const [from, to] of [
  ["#/", "#//evil.example/x.md"],
  ["#/md-web/a", "#https://evil.example/x.md"],
  ["#/md-web/a", "#/md-web/../../secret.md"],
]) {
  const redirects = navigates(from, to);
  if (redirects.length !== 1 || !redirects[0].endsWith("#/"))
    fail(`a link from ${from} to ${to} was not bounced to the landing page`);
  else pass(`a link from ${from} to ${to} is bounced to the landing page`);
}

for (const [from, to] of [
  ["#/", "#/md-web/b"],
  ["#/md-web/a", "#/md-web/b.md"],
]) {
  const redirects = navigates(from, to);
  if (redirects.length) fail(`ordinary navigation ${from} → ${to} was bounced`);
  else pass(`ordinary navigation ${from} → ${to} is left alone`);
}

// ── Content-Security-Policy ──
const html = readFileSync(INDEX_HTML, "utf8");
const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];

if (!csp) fail("index.html has no Content-Security-Policy meta tag");
else {
  pass("index.html declares a Content-Security-Policy");
  // The whole point: inline script in a rendered document must not be able to run.
  const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1] ?? "";
  if (!scriptSrc.includes("'self'")) fail(`script-src is "${scriptSrc}", expected it to allow 'self'`);
  else if (scriptSrc.includes("'unsafe-inline'")) fail("script-src allows 'unsafe-inline', which reinstates the injected-HTML vector");
  else pass(`script-src is ${scriptSrc} — no 'unsafe-inline'`);
  if (!/connect-src 'self'/.test(csp)) fail("connect-src is not 'self', so a cross-origin document route would still be fetched");
  else pass("connect-src 'self' blocks a cross-origin document fetch");
}

// The config has to live in a file for the policy above to be expressible.
// Comments are stripped first: prose in this very file mentions an inline <script>,
// and a check that trips on a comment trains people to ignore it.
const markup = html.replace(/<!--[\s\S]*?-->/g, "");
const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.exec(markup);
if (inlineScript) fail(`index.html still carries an inline <script> block: ${inlineScript[0].slice(0, 60)}…`);
else pass("index.html has no inline <script> — config lives in assets/config.js");

// A stale asset reference 404s the whole viewer, and the CSP means a 404 is not obvious.
for (const [, asset] of markup.matchAll(/(?:src|href)="(assets\/[^"?]+)"/g)) {
  if (!existsSync(join(SERVER, asset))) fail(`index.html references ${asset}, which is not on disk`);
}
pass("every asset referenced by index.html exists");

// Order is load-bearing: the guard must run before docsify parses the first route.
const configAt = html.indexOf("assets/config.js");
const docsifyAt = html.indexOf("assets/docsify.min.js");
if (configAt === -1 || docsifyAt === -1 || configAt > docsifyAt)
  fail("assets/config.js must load before assets/docsify.min.js so the route is normalized first");
else pass("assets/config.js loads before docsify.min.js");

console.error(`\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
