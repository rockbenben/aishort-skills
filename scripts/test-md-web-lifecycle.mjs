#!/usr/bin/env node
/**
 * Tests for md-web's S3 lifecycle handling.
 *
 * S3 has no per-rule lifecycle API: PUT ?lifecycle replaces the whole
 * configuration. So this script reads the bucket's configuration, drops only its
 * own rule, and writes the rest back. Getting that wrong is invisible in normal use
 * and destructive when it goes wrong — a regex that mis-parses the response would
 * write back a configuration with the user's own retention rules missing, and
 * expire_days: 0 used to DELETE the entire configuration outright. So the merge is
 * driven here against a scripted S3, with every request recorded.
 *
 * What is asserted, per scenario: which lifecycle requests were issued at all
 * (the point of the fix is that the default issues none), and what the written
 * configuration contains — in particular that rules the user set themselves come
 * back byte-for-byte.
 *
 * Usage:
 *   node scripts/test-md-web-lifecycle.mjs
 *
 * Needs no dependencies.
 */
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = join(ROOT, "skills", "md-web");
const UPLOAD_JS = join(SKILL_DIR, "upload.js");
const realRequire = createRequire(import.meta.url);

let failures = 0;
const fail = (msg) => { console.error(`  FAIL  ${msg}`); failures++; };
const pass = (msg) => console.log(`  ok    ${msg}`);

const NO_LIFECYCLE =
  '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchLifecycleConfiguration</Code><Message>no config</Message></Error>';
const xml = (rules) =>
  '<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
  rules.join("") +
  "</LifecycleConfiguration>";
const USER_RULE =
  "<Rule><ID>keep-my-backups</ID><Filter><Prefix>backups/</Prefix></Filter><Status>Enabled</Status><Expiration><Days>365</Days></Expiration></Rule>";
const OUR_RULE = (days) =>
  `<Rule><ID>md-web-auto-expire</ID><Filter><Prefix>md-web/</Prefix></Filter><Status>Enabled</Status><Expiration><Days>${days}</Days></Expiration></Rule>`;

/** Run upload.js --setup against a scripted S3 and return every request it made. */
async function runSetup(config, s3) {
  const home = mkdtempSync(join(tmpdir(), "md-web-test-"));
  try {
    mkdirSync(join(home, ".md-web"));
    writeFileSync(join(home, ".md-web", "config.json"), JSON.stringify(config));
    const calls = [];
    const out = [];
    let index = null;

    const fakeHttps = {
      Agent: class { destroy() {} },
      request(options, callback) {
        const call = { method: options.method, path: options.path, body: null, headers: options.headers };
        calls.push(call);
        const listeners = {};
        const req = {
          on(event, fn) { listeners[event] = fn; return req; },
          end(payload) {
            if (payload) call.body = Buffer.from(payload).toString("utf-8");
            const isIndex = call.path === '/' + config.bucket + '/index.html';
            const res = isIndex && call.method === 'GET'
              ? index === null ? {status: 404} : {status: 200, body: index, headers: {etag: '"index"'}}
              : s3(call);
            if (isIndex && call.method === 'PUT' && res.status >= 200 && res.status < 300) index = call.body;
            const rs = { statusCode: res.status, headers: res.headers || {} };
            rs.on = (ev, fn) => { rs[ev] = fn; return rs; };
            callback(rs);
            setTimeout(() => { rs.data?.(Buffer.from(res.body ?? "", "utf-8")); rs.end?.(); }, 0);
          },
        };
        return req;
      },
    };

    const sandbox = {
      require: (id) => {
        if (id === "node:https") return fakeHttps;
        if (id === "node:os") return { homedir: () => home };
        return realRequire(id);
      },
      module: { exports: {} }, exports: {},
      __dirname: SKILL_DIR, __filename: UPLOAD_JS,
      process: {
        argv: ["node", UPLOAD_JS, "--setup"], platform: process.platform, env: {},
        exitCode: 0, exit(code) { throw new Error(`upload.js exited with ${code}`); },
      },
      console: { log: (...a) => out.push(a.join(" ")), error: (...a) => out.push(a.join(" ")) },
      Buffer, Promise, Date, setTimeout, encodeURIComponent, isFinite,
    };
    sandbox.require.main = sandbox.module;
    sandbox.globalThis = sandbox;
    createContext(sandbox);
    runInContext(readFileSync(UPLOAD_JS, "utf8"), sandbox, { filename: UPLOAD_JS });
    await sandbox.completion;
    return { calls, out };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// SigV4 canonicalization renders the valueless "lifecycle" parameter as
// "?lifecycle=" on the wire, so both spellings have to match.
const lifecycleOf = (calls) => calls.filter((c) => /^\/[^/]+\?lifecycle=?$/.test(c.path));
// A scenario that expected a request and got none usually means the run died
// earlier (setup failed, a file was missing). Both the recorded requests and the
// captured output say why; without them, "expected a PUT, got nothing" sends you
// hunting in the wrong file.
const why = ({ calls, out }) =>
  `\n        requests: ${calls.map((c) => `${c.method} ${c.path}`).join(", ") || "(none)"}` +
  `\n        output: ${out.join(" | ") || "(none)"}`;
const baseConfig = { access_key: "AK", secret_key: "SK", endpoint: "example.invalid", bucket: "b", public_url: "https://x.example", region: "auto" };
const okPut = (call) => ({ status: 200, body: "" });

// ── The default: no expire_days, no bucket-level request at all ──
{
  const { calls } = await runSetup({ ...baseConfig }, (call) =>
    call.path.includes("?lifecycle") ? { status: 404, body: NO_LIFECYCLE } : okPut(call));
  const lc = lifecycleOf(calls);
  if (lc.length) fail(`expire_days unset issued ${lc.length} lifecycle request(s): ${lc.map((c) => c.method).join(", ")}`);
  else pass("expire_days unset → no lifecycle request at all (object-write token is enough)");
}

// ── First run with an expiry: creates our one rule ──
{
  const run = await runSetup({ ...baseConfig, expire_days: 30 }, (call) =>
    call.path.includes("?lifecycle")
      ? (call.method === "GET" ? { status: 404, body: NO_LIFECYCLE } : okPut(call))
      : okPut(call));
  const lc = lifecycleOf(run.calls);
  const put = lc.find((c) => c.method === "PUT");
  if (lc.map((c) => c.method).join(",") !== "GET,GET,PUT")
    fail(`expected an initial read, a conflict check then a PUT, got ${lc.map((c) => c.method).join(",") || "nothing"}${why(run)}`);
  else if (!put.body.includes("<ID>md-web-auto-expire</ID>") || !put.body.includes("<Days>30</Days>"))
    fail(`the written rule is missing our ID or days:\n${put.body}`);
  else if (!put.body.includes("<Prefix>md-web/</Prefix>"))
    fail("the written rule is not scoped to the md-web/ prefix");
  else pass("expire_days 30 on an empty bucket → read, conflict check then PUT, one rule scoped to md-web/");
}

// ── Existing config: the user's own rules survive a change of expire_days ──
{
  const { calls } = await runSetup({ ...baseConfig, expire_days: 7 }, (call) =>
    call.path.includes("?lifecycle")
      ? (call.method === "GET" ? { status: 200, body: xml([USER_RULE]) } : okPut(call))
      : okPut(call));
  const put = lifecycleOf(calls).find((c) => c.method === "PUT");
  if (!put) fail("no PUT issued while updating an existing lifecycle");
  else if (!put.body.includes(USER_RULE))
    fail("the user's own rule was not written back verbatim:\n" + put.body);
  else if (!put.body.includes("<Days>7</Days>"))
    fail("our rule did not pick up the new value:\n" + put.body);
  else pass("expire_days 7 alongside an existing rule → the user's rule is preserved verbatim");
}

// ── Our own rule is replaced, not duplicated ──
{
  const { calls } = await runSetup({ ...baseConfig, expire_days: 45 }, (call) =>
    call.path.includes("?lifecycle")
      ? (call.method === "GET" ? { status: 200, body: xml([USER_RULE, OUR_RULE(30)]) } : okPut(call))
      : okPut(call));
  const put = lifecycleOf(calls).find((c) => c.method === "PUT");
  const ours = put ? (put.body.match(/md-web-auto-expire/g) || []).length : 0;
  if (ours !== 1) fail(`expected exactly one md-web rule in the written config, found ${ours}:\n${put?.body}`);
  else if (!put.body.includes("<Days>45</Days>")) fail("the existing md-web rule was not updated to 45 days");
  else pass("re-running with a new expire_days replaces our rule instead of stacking a second one");
}

// ── expire_days: 0 removes only our rule ──
{
  const { calls } = await runSetup({ ...baseConfig, expire_days: 0 }, (call) =>
    call.path.includes("?lifecycle")
      ? (call.method === "GET" ? { status: 200, body: xml([USER_RULE, OUR_RULE(30)]) } : okPut(call))
      : okPut(call));
  const lc = lifecycleOf(calls);
  const put = lc.find((c) => c.method === "PUT");
  if (lc.some((c) => c.method === "DELETE")) fail("expire_days 0 issued DELETE while the user still had a rule of their own");
  else if (!put) fail("no PUT issued while removing our rule");
  else if (put.body.includes("md-web-auto-expire")) fail("our rule survived in the written config");
  else if (!put.body.includes(USER_RULE)) fail("the user's rule was dropped along with ours");
  else pass("expire_days 0 → our rule is dropped, the user's rule is written back, DELETE is not used");
}

// ── expire_days: 0 with nothing else left is the one case DELETE is correct ──
{
  const { calls } = await runSetup({ ...baseConfig, expire_days: 0 }, (call) =>
    call.path.includes("?lifecycle")
      ? (call.method === "GET" ? { status: 200, body: xml([OUR_RULE(30)]) } : okPut(call))
      : okPut(call));
  const lc = lifecycleOf(calls);
  if (lc.map((c) => c.method).join(",") !== "GET,GET,DELETE")
    fail(`expected read, conflict check then DELETE, got ${lc.map((c) => c.method).join(",") || "nothing"}`);
  else pass("expire_days 0 on a bucket holding only our rule → DELETE, after proving nothing else was there");
}

// ── Nothing to do ──
{
  const { calls } = await runSetup({ ...baseConfig, expire_days: 0 }, (call) =>
    call.path.includes("?lifecycle")
      ? (call.method === "GET" ? { status: 404, body: NO_LIFECYCLE } : okPut(call))
      : okPut(call));
  const lc = lifecycleOf(calls);
  if (lc.map((c) => c.method).join(",") !== "GET") fail(`expected a read and nothing else, got ${lc.map((c) => c.method).join(",") || "nothing"}`);
  else pass("expire_days 0 on a bucket with no lifecycle at all → no write, no DELETE");
}

// ── A failed read must not turn into a write ──
{
  const { calls, out } = await runSetup({ ...baseConfig, expire_days: 30 }, (call) =>
    call.path.includes("?lifecycle") ? { status: 403, body: "<Error><Code>AccessDenied</Code></Error>" } : okPut(call));
  const lc = lifecycleOf(calls);
  if (lc.some((c) => c.method !== "GET")) fail("a denied read was followed by a write, which would erase rules we never read");
  else if (!out.some((l) => l.includes("Admin Read & Write"))) fail("the warning does not say which permission is missing");
  else pass("a denied lifecycle read is reported and never followed by a write");
}

// Invalid retention values must be rejected before any object or bucket writes.
for (const expire_days of ["forever", 0.5, false, " ", -1, "1.5"]) {
  const { calls, out } = await runSetup({ ...baseConfig, expire_days }, okPut);
  if (calls.length || !out.some(line => line.includes("CONFIG_INVALID")))
    fail("invalid expire_days was not rejected before writes: " + JSON.stringify(expire_days));
}

// ── Transient failures are retried; a 4xx is final ──
{
  let first = null;
  const run = await runSetup({ ...baseConfig }, (call) => {
    if (!first) { first = { method: call.method, path: call.path }; return { status: 500, body: "<Error><Code>InternalError</Code></Error>" }; }
    return okPut(call);
  });
  const tries = run.calls.filter((c) => c.method === first.method && c.path === first.path).length;
  if (tries !== 2) fail(`a 500 was not retried exactly once (${tries} attempts)${why(run)}`);
  else if (!run.out.some((l) => l.includes("retry 1/2"))) fail(`no retry note in the output${why(run)}`);
  else pass("a 500 is retried once and the setup completes");
}
{
  let first = null;
  const run = await runSetup({ ...baseConfig }, (call) => {
    if (!first) { first = { method: call.method, path: call.path }; return { status: 403, body: "<Error><Code>AccessDenied</Code></Error>" }; }
    return okPut(call);
  }, 800);
  const tries = run.calls.filter((c) => c.method === first.method && c.path === first.path).length;
  if (tries !== 1) fail(`a 403 was retried (${tries} attempts)${why(run)}`);
  else pass("a 403 is final, not retried");
}

// ── The retry budget is finite, and a give-up is loud ──
{
  const run = await runSetup({ ...baseConfig }, () => ({ status: 500, body: "<Error><Code>InternalError</Code></Error>" }));
  // The budget is per request: every upload is tried once and then retried twice.
  const byPath = new Map();
  for (const c of run.calls.filter(c => c.method === 'PUT')) byPath.set(c.path, (byPath.get(c.path) || 0) + 1);
  const attempts = [...byPath.values()];
  if (!attempts.length || !attempts.every((n) => n === 3)) fail(`a persistent 500 was not retried up to the budget (${JSON.stringify([...byPath])})${why(run)}`);
  else if (!run.out.some((l) => l.includes("retry 2/2"))) fail(`no second-retry note in the output${why(run)}`);
  else if (!run.out.some((l) => l.includes("UPLOAD_FAILED"))) fail(`a give-up after the budget was not reported${why(run)}`);
  else pass("a persistent 500 is retried up to the budget and then fails the run");
}

// ── 429 is transient ──
{
  let first = true;
  const run = await runSetup({ ...baseConfig }, (call) => {
    if (first) { first = false; return { status: 429, body: "" }; }
    return okPut(call);
  });
  if (run.calls.length < 2) fail(`a 429 was not retried (${run.calls.length} attempts)${why(run)}`);
  else pass("429 is transient and is retried");
}

// ── A lifecycle body we cannot parse must never be written back ──
{
  const run = await runSetup({ ...baseConfig, expire_days: 30 }, (call) =>
    call.path.includes("?lifecycle")
      ? { status: 200, body: "<html><body>not a lifecycle configuration</body></html>" }
      : okPut(call));
  const writes = lifecycleOf(run.calls).filter((c) => c.method !== "GET");
  if (writes.length) fail(`an unparseable lifecycle body was written back: ${JSON.stringify(writes)}${why(run)}`);
  else if (!run.out.some((l) => /not a LifecycleConfiguration/.test(l))) fail(`the refusal was not reported${why(run)}`);
  else pass("an unreadable lifecycle body is refused instead of overwriting the bucket's own rules");
}

// ── An explicit :443 endpoint is signed with the port and must be sent with it ──
// Node omits the default port from the Host header it generates, so without an
// explicit Host the server sees "host" while the signature covers "host:443".
{
  const cfg = { ...baseConfig, endpoint: "acct.r2.cloudflarestorage.com:443" };
  const run = await runSetup(cfg, okPut);
  const hosts = [...new Set(run.calls.map((c) => c.headers && c.headers.Host))];
  if (hosts.length !== 1 || hosts[0] !== cfg.endpoint)
    fail(`an explicit :443 endpoint was not sent as the signed Host (${JSON.stringify(hosts)})${why(run)}`);
  else pass("an explicit :443 endpoint is sent as the Host header it signs");
}

// AWS exposes its bucket-wide transition default in an HTTP header.
for (const value of ["varies_by_storage_class", "all_storage_classes_128K"]) {
  for (const days of [0, 30]) {
    const run = await runSetup({ ...baseConfig, expire_days: days }, call =>
      call.method === "GET" ? { status: 200, body: xml([USER_RULE, OUR_RULE(7)]),
        headers: { "x-amz-transition-default-minimum-object-size": value } } : okPut(call));
    const put = lifecycleOf(run.calls).find(call => call.method === "PUT");
    if (put?.headers["x-amz-transition-default-minimum-object-size"] !== value || !put.body.includes(USER_RULE))
      fail("AWS lifecycle transition header or unrelated rule was lost");
    else pass("AWS lifecycle header preserved for expire_days " + days + ": " + value);
  }
}

console.log(`\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
