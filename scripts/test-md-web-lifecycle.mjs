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
function runSetup(config, s3) {
  const home = mkdtempSync(join(tmpdir(), "md-web-test-"));
  try {
    mkdirSync(join(home, ".md-web"));
    writeFileSync(join(home, ".md-web", "config.json"), JSON.stringify(config));
    const calls = [];
    const out = [];

    const fakeHttps = {
      Agent: class { destroy() {} },
      request(options, callback) {
        const call = { method: options.method, path: options.path, body: null };
        calls.push(call);
        const listeners = {};
        const req = {
          on(event, fn) { listeners[event] = fn; return req; },
          end(payload) {
            if (payload) call.body = Buffer.from(payload).toString("utf-8");
            const res = s3(call);
            const rs = { statusCode: res.status };
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
    sandbox.globalThis = sandbox;
    createContext(sandbox);
    runInContext(readFileSync(UPLOAD_JS, "utf8"), sandbox, { filename: UPLOAD_JS });
    // The script is promise-driven; let the microtask/timer chain drain before the
    // temp config dir disappears under it.
    return new Promise((resolveRun) => setTimeout(() => resolveRun({ calls, out }), 250));
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
  if (lc.map((c) => c.method).join(",") !== "GET,PUT")
    fail(`expected exactly a GET then a PUT, got ${lc.map((c) => c.method).join(",") || "nothing"}${why(run)}`);
  else if (!put.body.includes("<ID>md-web-auto-expire</ID>") || !put.body.includes("<Days>30</Days>"))
    fail(`the written rule is missing our ID or days:\n${put.body}`);
  else if (!put.body.includes("<Prefix>md-web/</Prefix>"))
    fail("the written rule is not scoped to the md-web/ prefix");
  else pass("expire_days 30 on an empty bucket → GET then PUT, one rule scoped to md-web/");
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
  if (lc.map((c) => c.method).join(",") !== "GET,DELETE")
    fail(`expected GET then DELETE, got ${lc.map((c) => c.method).join(",") || "nothing"}`);
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

// ── A nonsense expire_days must not be coerced into a bucket-wide change ──
{
  const { calls } = await runSetup({ ...baseConfig, expire_days: "forever" }, (call) =>
    call.path.includes("?lifecycle") ? { status: 200, body: xml([USER_RULE]) } : okPut(call));
  if (lifecycleOf(calls).length) fail("expire_days: \"forever\" still sent lifecycle requests");
  else pass('expire_days: "forever" → warned about, bucket left alone');
}

console.error(`\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
