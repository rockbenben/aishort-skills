#!/usr/bin/env node
/**
 * Regression tests for the md-web publish path: the helpers that decide what lands in
 * the bucket and under which key.
 *
 * Why this exists.
 *
 * 1. Front matter. Docsify 4 has no front-matter support, so the uploaded copy strips it.
 *    The first cut matched "the first --- ... the next ---", which also matches a Markdown
 *    document that merely OPENS with a thematic break: everything between the two rules
 *    (the title, the intro) was deleted from the published copy, while the public URL
 *    still answered 200 with the truncated body. The published document silently lost
 *    content.
 *
 * 2. Key collisions. The remote key is a timestamp plus a slug, and the slug is lossy —
 *    every name without ASCII letters or digits collapses to "doc". Two documents
 *    published in the same second therefore landed on the same object: the second PUT
 *    overwrote the first, and the first URL kept answering 200 with the wrong document.
 *
 * The helpers are pure, so they are read out of upload.js and exercised directly rather
 * than through a live bucket.
 *
 * Usage:
 *   node scripts/test-md-web-publish.mjs
 *
 * Needs no dependencies.
 */
import fs, { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import crypto from "node:crypto";
import path from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UPLOAD_JS = join(ROOT, "skills", "md-web", "upload.js");

let failures = 0;
const fail = (msg) => { console.error(`  FAIL  ${msg}`); failures++; };
const pass = (msg) => console.log(`  ok    ${msg}`);

/** Pull one top-level function out of upload.js by brace matching. */
function functionSource(source, name) {
  const start = source.indexOf("function " + name);
  if (start < 0) throw new Error(`upload.js no longer defines ${name}()`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`could not read the body of ${name}()`);
}

/** Load the publish-path helpers out of upload.js without running its main flow. */
function loadHelpers(skillDir = ROOT) {
  const source = readFileSync(UPLOAD_JS, "utf8");
  const consts = [
    source.match(/var SCRIPT_DIR = .*;/)?.[0],
    source.match(/var YAML_KEY_LINE = .*;/)?.[0],
    source.match(/var DOC_EXTS = .*;/)?.[0],
    source.match(/var SERVER_DIR = .*;/)?.[0],
    source.match(/var JUNK = .*;/)?.[0],
    source.match(/var _serverHash = .*;/)?.[0],
  ].filter(Boolean);
  const context = { crypto, path, fs, console, process, Buffer, __dirname: skillDir };
  createContext(context);
  runInContext(
    [
      ...consts,
      functionSource(source, "slugify"),
      functionSource(source, "timestamp"),
      functionSource(source, "addTimestamp"),
      functionSource(source, "prepareMarkdown"),
      functionSource(source, "listServerFiles"),
      functionSource(source, "serverDirHash"),
      "this.helpers = { slugify, timestamp, addTimestamp, prepareMarkdown, listServerFiles, serverDirHash };",
    ].join("\n"),
    context,
  );
  return context.helpers;
}

const { slugify, addTimestamp, prepareMarkdown } = loadHelpers();

console.log("publish-path helpers");

// ---- front matter ----
{
  const fm = "---\ntitle: Release notes\ntags: [a, b]\n---\n\n# Title\n\nBody text\n";
  const out = prepareMarkdown(Buffer.from(fm, "utf8")).toString("utf8");
  if (out === "# Title\n\nBody text\n") pass("real YAML front matter is stripped");
  else fail(`front matter was not stripped; got ${JSON.stringify(out)}`);
}

{
  // A document that opens with a thematic break, not front matter.
  const doc = "---\n# Release notes\n\nIntro paragraph.\n\n---\n\nSecond section\n";
  const out = prepareMarkdown(Buffer.from(doc, "utf8")).toString("utf8");
  if (out === doc) pass("a leading thematic break is left alone");
  else fail(`a leading thematic break was treated as front matter and content was lost; got ${JSON.stringify(out)}`);
}

{
  // Two rules with prose between them: nothing is a YAML key, so nothing is stripped.
  const doc = "---\nSome prose: with a colon\n\n---\n\nMore\n";
  const out = prepareMarkdown(Buffer.from(doc, "utf8")).toString("utf8");
  if (out === doc) pass("prose between two rules is not stripped");
  else fail(`prose between two rules was stripped; got ${JSON.stringify(out)}`);
}

{
  // A document that is nothing but front matter has no body to publish.
  let threw = null;
  try { prepareMarkdown(Buffer.from("---\ntitle: x\n---\n", "utf8")); }
  catch (e) { threw = e; }
  if (threw) pass("a document that is only front matter is refused");
  else fail("a document that is only front matter was published empty");
}

// ---- remote keys ----
{
  if (slugify("报告") === "doc" && slugify("api-docs") === "api-docs")
    pass("slugify collapses a name without ASCII letters and digits");
  else fail(`slugify changed shape: ${slugify("报告")} / ${slugify("api-docs")}`);
}

{
  // Two documents whose names collapse to the same slug, published in the same second.
  const keys = [addTimestamp("报告"), addTimestamp("测试文档"), addTimestamp("Report"), addTimestamp("Report")];
  if (new Set(keys).size === keys.length) pass("every publish lands on its own object key");
  else fail(`two publishes produced the same key: ${keys.join(", ")}`);
}

{
  const key = addTimestamp("api-docs");
  if (/^\d{8}-\d{6}-api-docs-[0-9a-f]{4}\.md$/.test(key)) pass("the key keeps its timestamp-slug shape");
  else fail(`unexpected key shape: ${key}`);
}

// ---- CLI guards (these run before any config is loaded) ----
{
  const argsDir = fs.mkdtempSync(join(tmpdir(), "md-web-args-"));
  const empty = join(argsDir, "empty.md");
  fs.writeFileSync(empty, "");
  try {
    const cases = [
      { args: [], expect: /expected exactly two arguments/ },
      { args: ["a", "b", "c"], expect: /expected exactly two arguments/ },
      { args: [join(argsDir, "missing.md"), "x"], expect: /not a readable file/ },
      { args: [empty, "x"], expect: /file is empty/ },
    ];
    for (const c of cases) {
      const r = spawnSync(process.execPath, [UPLOAD_JS, ...c.args], { encoding: "utf8" });
      if (r.status === 1 && c.expect.test(r.stderr)) pass(`CLI guard: ${c.expect.source}`);
      else fail(`CLI guard ${c.expect.source} did not fire: status ${r.status}, stderr ${JSON.stringify(r.stderr)}`);
    }
  } finally {
    fs.rmSync(argsDir, { recursive: true, force: true });
  }
}

// ---- config validation (these run once the config is loaded) ----
{
  const home = fs.mkdtempSync(join(tmpdir(), "md-web-cfg-"));
  try {
    fs.mkdirSync(join(home, ".md-web"), { recursive: true });
    const doc = join(home, "doc.md");
    fs.writeFileSync(doc, "# Title\n\nbody\n");
    const base = {
      access_key: "a",
      secret_key: "b",
      bucket: "md-web",
      public_url: "https://pub-x.r2.dev",
      endpoint: "acct.r2.cloudflarestorage.com",
    };
    const cases = [
      [{ ...base, endpoint: "acct.r2.cloudflarestorage.com/bucket" }, /CONFIG_INVALID: endpoint must be a bare hostname/],
      [{ ...base, public_url: "pub-x.r2.dev" }, /CONFIG_INVALID: public_url must start with https:\/\//],
    ];
    for (const [config, expect] of cases) {
      fs.writeFileSync(join(home, ".md-web", "config.json"), JSON.stringify(config));
      const r = spawnSync(process.execPath, [UPLOAD_JS, doc, "key"], {
        encoding: "utf8",
        env: { ...process.env, HOME: home, USERPROFILE: home },
      });
      if (r.status !== 1) fail(`a bad config was accepted (status ${r.status}): ${r.stderr}`);
      else if (!expect.test(r.stderr)) fail(`expected ${expect.source}, got: ${r.stderr.trim()}`);
      else pass(`config guard: ${expect.source}`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// ---- publish refuses before provisioning when the viewer is not deployed ----
{
  const home = fs.mkdtempSync(join(tmpdir(), "md-web-setup-"));
  try {
    fs.mkdirSync(join(home, ".md-web"), { recursive: true });
    fs.writeFileSync(join(home, ".md-web", "config.json"), JSON.stringify({
      access_key: "a", secret_key: "b", bucket: "md-web",
      public_url: "https://pub-x.r2.dev", endpoint: "acct.r2.cloudflarestorage.com",
    }));
    const doc = join(home, "doc.md");
    fs.writeFileSync(doc, "# Title\n\nbody\n");
    const r = spawnSync(process.execPath, [UPLOAD_JS, doc, "key"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    if (r.status !== 1) fail(`publish without a deployed viewer exited ${r.status}: ${r.stderr.trim()}`);
    else if (!/^UPLOAD_FAILED: SETUP_REQUIRED:/m.test(r.stderr))
      fail(`publish did not name SETUP_REQUIRED: ${r.stderr.trim()}`);
    else if (fs.existsSync(join(home, ".md-web", ".deployed")))
      fail("publish wrote .deployed instead of refusing");
    else pass("publish refuses with SETUP_REQUIRED and does not provision the viewer");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// ---- server file listing / deploy fingerprint ----
{
  const skillDir = fs.mkdtempSync(join(tmpdir(), "md-web-srv-"));
  try {
    const server = join(skillDir, "docsify-server");
    fs.mkdirSync(join(server, "assets"), { recursive: true });
    fs.writeFileSync(join(server, "index.html"), "<html>");
    fs.writeFileSync(join(server, ".nojekyll"), "");
    fs.writeFileSync(join(server, "Thumbs.db"), "junk");
    fs.writeFileSync(join(server, "assets", "config.js"), "a");
    const keys = loadHelpers(skillDir).listServerFiles().map((f) => f.key).sort();
    if (keys.join(",") === "assets/config.js,index.html") pass("dot-files and OS junk are not uploaded");
    else fail(`listServerFiles returned ${keys.join(", ")}`);
    const h1 = loadHelpers(skillDir).serverDirHash();
    fs.rmSync(join(server, ".nojekyll"));
    fs.rmSync(join(server, "Thumbs.db"));
    const h2 = loadHelpers(skillDir).serverDirHash();
    if (h1 === h2) pass("the fingerprint ignores dot-files and OS junk");
    else fail("removing non-uploaded files changed the deploy fingerprint");
    fs.writeFileSync(join(server, "assets", "config.js"), "b");
    const h3 = loadHelpers(skillDir).serverDirHash();
    if (h1 !== h3) pass("the fingerprint changes when an uploaded asset changes");
    else fail("an uploaded asset change did not change the deploy fingerprint");
  } finally {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
}

console.log(`\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
