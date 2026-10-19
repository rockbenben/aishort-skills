#!/usr/bin/env node
/** Upload files to S3-compatible storage for md-web skill. Zero dependencies (Node.js built-in only). */

var crypto = require("node:crypto");
var https = require("node:https");
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");

var SCRIPT_DIR = __dirname;

// Two modes, deliberately separate. Publishing one document only ever writes
// that one object; provisioning the viewer writes the site's root files and may
// touch the bucket's lifecycle, so it is an explicit command of its own rather
// than something an upload does on the side.
//
// Argument checks stay at the top for two reasons: loading the config exits when it is
// missing, so a check below it is unreachable for anyone who has not configured yet; and a
// run's first act in setup mode is deploying the server files, so validating late meant a
// typo in the local path cost a full round of uploads before failing with an ENOENT about
// the file alone.
var args = process.argv.slice(2);
var SCRIPT_NAME = path.basename(process.argv[1]);
var SETUP_FLAG = "--setup";
var usage = [
  "Usage:",
  "  node " + SCRIPT_NAME + " <local-file> <remote-key>   publish one markdown document",
  "  node " + SCRIPT_NAME + " " + SETUP_FLAG + "                 provision the viewer (first run, and after an upgrade)",
].join("\n");

var isSetup = args[0] === SETUP_FLAG;
if (isSetup && args.length > 1) {
  console.log(usage);
  console.error('UPLOAD_FAILED: ' + SETUP_FLAG + ' takes no other arguments, got: ' + args.slice(1).join(" "));
  process.exit(1);
}
if (!isSetup) {
  if (args.length < 2) {
    console.log(usage);
    process.exit(1);
  }
  if (args[0].charAt(0) === "-") {
    console.log(usage);
    console.error('UPLOAD_FAILED: "' + args[0] + '" looks like an option; this script takes two positional arguments, plus the single flag ' + SETUP_FLAG + '.');
    process.exit(1);
  }
}
var localPath = isSetup ? null : args[0];
if (!isSetup) {
  var localStat = null;
  try { localStat = fs.statSync(localPath); } catch (e) { /* reported below */ }
  if (!localStat || !localStat.isFile()) {
    console.error("UPLOAD_FAILED: not a readable file: " + localPath);
    process.exit(1);
  }
}

// ── User data dir: upgrade-safe location in home dir ──
var USER_CONFIG_DIR = path.join(os.homedir(), ".md-web");
var USER_CONFIG_PATH = path.join(USER_CONFIG_DIR, "config.json");
var LOCAL_CONFIG_PATH = path.join(SCRIPT_DIR, "config.json");
var LOCAL_DEPLOYED_FLAG = path.join(SCRIPT_DIR, ".deployed");

var CONFIG_PATH;
if (fs.existsSync(USER_CONFIG_PATH)) {
  CONFIG_PATH = USER_CONFIG_PATH;
} else if (fs.existsSync(LOCAL_CONFIG_PATH)) {
  // Migrate: copy old files to new location so future upgrades are safe
  try {
    fs.mkdirSync(USER_CONFIG_DIR, { recursive: true });
    fs.copyFileSync(LOCAL_CONFIG_PATH, USER_CONFIG_PATH);
    if (fs.existsSync(LOCAL_DEPLOYED_FLAG)) {
      fs.copyFileSync(LOCAL_DEPLOYED_FLAG, path.join(USER_CONFIG_DIR, ".deployed"));
    }
    CONFIG_PATH = USER_CONFIG_PATH;
    console.log("Config migrated to: " + USER_CONFIG_PATH);
  } catch (_) {
    CONFIG_PATH = LOCAL_CONFIG_PATH;
  }
} else {
  CONFIG_PATH = USER_CONFIG_PATH;
}

// .deployed follows the same directory as config — if migration failed and we
// fell back to skill dir, .deployed stays in skill dir too.
var DEPLOYED_FLAG = path.join(path.dirname(CONFIG_PATH), ".deployed");

// ── Load Configuration ──
var CONFIG;
try {
  CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
} catch (e) {
  console.error("CONFIG_MISSING: " + CONFIG_PATH);
  console.error("Run this skill once to configure, or create: " + USER_CONFIG_PATH);
  process.exit(1);
}

var REQUIRED = ["access_key", "secret_key", "endpoint", "bucket", "public_url"];
// Credentials may come from the environment instead of the config file, so a user
// who does not want a long-lived secret at rest never has to write one there.
// The file wins when both are set, so an existing setup keeps working unchanged.
if (!CONFIG.access_key && process.env.MD_WEB_ACCESS_KEY) CONFIG.access_key = process.env.MD_WEB_ACCESS_KEY;
if (!CONFIG.secret_key && process.env.MD_WEB_SECRET_KEY) CONFIG.secret_key = process.env.MD_WEB_SECRET_KEY;
// config.json holds the bucket secret. Written with the default umask it lands at
// 0644, i.e. readable by every account on the machine; 0600 is the difference
// between "only me" and "everyone", and it costs one call. Windows ACLs are not
// chmod, so this is POSIX-only — the env vars above are the portable answer.
if (process.platform !== "win32") {
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch (_) {}
}
var missing = REQUIRED.filter(function (k) { return !CONFIG[k]; });
if (missing.length) {
  console.error("Missing config fields: " + missing.join(", "));
  console.error("Edit: " + CONFIG_PATH);
  process.exit(1);
}
CONFIG.public_url = CONFIG.public_url.replace(/\/+$/, "");

var CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

// ── HTTPS Agent (connection reuse) ──
var agent = new https.Agent({ keepAlive: true, maxSockets: 6 });

// ── S3 Signature V4 ──
function hmacSha256(key, msg) {
  return crypto.createHmac("sha256", key).update(msg, "utf-8").digest();
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

var _skCache = {};
function signingKey(dateStamp) {
  if (_skCache.ds === dateStamp) return _skCache.key;
  var region = CONFIG.region || "auto";
  var k = hmacSha256("AWS4" + CONFIG.secret_key, dateStamp);
  k = hmacSha256(k, region);
  k = hmacSha256(k, "s3");
  k = hmacSha256(k, "aws4_request");
  _skCache = { ds: dateStamp, key: k };
  return k;
}

// S3 SigV4 URI encoding: encode all except A-Z a-z 0-9 - . _ ~
function uriEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function (c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

function uriEncodePath(p) {
  return p.split("/").map(uriEncode).join("/");
}

// Build the SigV4 canonical query string (also reused as the request's ?search).
// Accepts a string ("lifecycle" → valueless param) or an object ({k: v, ...}).
// Keys/values are URI-encoded and sorted by encoded key, per the SigV4 spec.
function canonicalizeQuery(query) {
  if (!query) return "";
  var params = query;
  if (typeof query === "string") { params = {}; params[query] = ""; }
  return Object.keys(params)
    .map(function (k) { return [uriEncode(k), uriEncode(String(params[k]))]; })
    .sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; })
    .map(function (p) { return p[0] + "=" + p[1]; })
    .join("&");
}

function parseR2Error(xml) {
  var code = (xml.match(/<Code>(.*?)<\/Code>/) || [])[1];
  var msg = (xml.match(/<Message>(.*?)<\/Message>/) || [])[1];
  if (code && msg) return code + ": " + msg;
  if (code) return code;
  return xml.length > 200 ? xml.slice(0, 200) + "..." : xml;
}

// ── General S3 Request ──
// All S3 operations go through this single signing path.
// extraHeaders: signed AND sent. Content-Length + auth added automatically.
function s3Fetch(method, resourcePath, query, payload, extraHeaders) {
  var region = CONFIG.region || "auto";
  if (typeof payload === "string") payload = Buffer.from(payload, "utf-8");
  if (!payload) payload = Buffer.alloc(0);

  var encodedPath = uriEncodePath(resourcePath);
  var canonicalQS = canonicalizeQuery(query);

  return new Promise(function (resolve, reject) {
    var now = new Date();
    var amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
    var dateStamp = amzDate.slice(0, 8);
    var payloadHash = sha256Hex(payload);

    // Canonical headers (lowercase keys, sorted)
    var signHdrs = {
      "host": CONFIG.endpoint,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (extraHeaders) {
      Object.keys(extraHeaders).forEach(function (k) {
        signHdrs[k.toLowerCase()] = extraHeaders[k];
      });
    }

    var sortedKeys = Object.keys(signHdrs).sort();
    var canonicalHeaders = sortedKeys.map(function (k) { return k + ":" + signHdrs[k]; }).join("\n") + "\n";
    var signedHeaders = sortedKeys.join(";");
    var canonicalRequest = method + "\n" + encodedPath + "\n" + canonicalQS + "\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash;

    var scope = dateStamp + "/" + region + "/s3/aws4_request";
    var stringToSign = "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + sha256Hex(canonicalRequest);
    var sig = hmacSha256(signingKey(dateStamp), stringToSign).toString("hex");
    var auth = "AWS4-HMAC-SHA256 Credential=" + CONFIG.access_key + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + sig;

    // HTTP request headers (unsigned Content-Length + auth added here)
    var reqHeaders = {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: auth,
    };
    if (payload.length > 0) reqHeaders["Content-Length"] = payload.length;
    if (extraHeaders) {
      Object.keys(extraHeaders).forEach(function (k) {
        reqHeaders[k] = extraHeaders[k];
      });
    }

    var req = https.request(
      {
        hostname: CONFIG.endpoint,
        path: encodedPath + (canonicalQS ? "?" + canonicalQS : ""),
        method: method,
        timeout: 30000,
        agent: agent,
        headers: reqHeaders,
      },
      function (res) {
        // Collect the chunks and decode once. Appending a Buffer to a string decodes each
        // chunk separately, so a multibyte character straddling a chunk boundary turns into
        // mojibake — and R2 echoes the key back in its error XML, where keys are not ASCII.
        var chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
          var body = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, body: body });
          else reject(new Error("HTTP " + res.statusCode + " — " + parseR2Error(body)));
        });
      }
    );
    req.on("timeout", function () { req.destroy(new Error("Request timed out")); });
    req.on("error", reject);
    req.end(payload.length > 0 ? payload : undefined);
  });
}

// ── File Upload ──
function getContentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

var CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
var CACHE_SHORT = "public, max-age=300";

function cacheControlFor(remoteKey) {
  var ext = path.extname(remoteKey).toLowerCase();
  if (ext === ".js" || ext === ".css") return CACHE_IMMUTABLE;
  return CACHE_SHORT;
}

function putObject(payload, remoteKey, contentType) {
  var ct = contentType || getContentType(remoteKey);
  return s3Fetch("PUT", "/" + CONFIG.bucket + "/" + remoteKey, null, payload, {
    "Content-Type": ct,
    "Cache-Control": cacheControlFor(remoteKey),
  }).then(function () { console.log("  OK  " + remoteKey); });
}

function uploadFile(localPath, remoteKey, contentType) {
  return putObject(fs.readFileSync(localPath), remoteKey, contentType);
}

// Bundled assets use fixed filenames + immutable caching, so a docsify upgrade
// (same filename, new content) would otherwise be masked by browser cache.
// Stamp each asset URL in index.html with the server bundle hash; when the
// bundle changes, the hash changes, the short-cached index.html re-propagates,
// and browsers refetch the assets under their new ?v= URL.
function versionIndexHtml(html, version) {
  return html.replace(/(href|src)="(assets\/[^"?]+)"/g, function (_m, attr, asset) {
    return attr + '="' + asset + "?v=" + version + '"';
  });
}

// ── Server Deployment ──
function serverDirHash() {
  var serverDir = path.join(SCRIPT_DIR, "docsify-server");
  var hash = crypto.createHash("sha256");
  function walk(dir, prefix) {
    fs.readdirSync(dir).sort().forEach(function (name) {
      var full = path.join(dir, name);
      var rel = prefix ? prefix + "/" + name : name;
      if (fs.statSync(full).isDirectory()) { walk(full, rel); }
      else { hash.update(rel); hash.update(fs.readFileSync(full)); }
    });
  }
  walk(serverDir, "");
  return hash.digest("hex").slice(0, 12);
}

// Lifecycle administration is opt-in. It is a bucket-level request and needs an
// Admin token, while publishing one document only ever needs object writes — so an
// absent expire_days means this tool never sends one at all, and an object-scoped
// token is enough. null ("do not touch the bucket") is not the same as
// expire_days: 0 ("remove this skill's rule, leave every other rule alone").
function expireDays() {
  var d = CONFIG.expire_days;
  if (d == null || d === "") return null;
  d = Number(d);
  if (!isFinite(d) || d < 0) {
    console.error('  Warning: expire_days "' + CONFIG.expire_days + '" is not a number of days; leaving the bucket lifecycle alone.');
    return null;
  }
  return Math.floor(d);
}

// Fingerprints the viewer, not the retention setting: whether the site files in the
// bucket are the ones in this skill. Leaving expire_days out means editing the
// expiry does not make a current deployment look unprovisioned.
function deployFingerprint() {
  return CONFIG.endpoint + "/" + CONFIG.bucket + "@" + serverDirHash();
}

// ── S3 Lifecycle Rule ──
var LIFECYCLE_RULE_ID = "md-web-auto-expire";

// S3 has no per-rule lifecycle API: PUT ?lifecycle replaces the whole
// configuration. Every write below is therefore a read-modify-write — read what the
// bucket has, keep the rules that are not ours, then write. Blanking the config and
// PUTting one rule erased the user's own retention rules, and expire_days: 0 used to
// DELETE the entire configuration outright; both destroyed policy this skill never
// owned.
function readLifecycle() {
  return s3Fetch("GET", "/" + CONFIG.bucket, "lifecycle")
    .then(function (r) { return r.body; })
    .catch(function (e) {
      // NoSuchLifecycleConfiguration is the only "there is nothing there" answer.
      // AccessDenied and transport failures must abort instead: writing back a
      // config we failed to read would delete rules we never saw.
      if (/NoSuchLifecycle/i.test(e.message || "")) return "";
      throw e;
    });
}

// Rule elements cannot nest, so a non-greedy match is exact rather than a guess.
function rulesFrom(xml) {
  var out = [];
  var re = /<Rule(?:\s[^>]*)?>[\s\S]*?<\/Rule>/g;
  var m;
  while ((m = re.exec(xml))) {
    if (m[0].indexOf("<ID>" + LIFECYCLE_RULE_ID + "</ID>") === -1) out.push(m[0]);
  }
  return out;
}

// Scoped to md-web's own uploads (the "md-web/" key prefix) — never the viewer
// files at the bucket root, nor any unrelated object sharing the bucket.
function expiryRule(days) {
  return '<Rule><ID>' + LIFECYCLE_RULE_ID + '</ID>' +
    '<Filter><Prefix>' + UPLOAD_PREFIX + '</Prefix></Filter>' +
    '<Status>Enabled</Status>' +
    '<Expiration><Days>' + days + '</Days></Expiration>' +
    '</Rule>';
}

function putLifecycle(rules) {
  var xml = '<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
    rules.join("") + '</LifecycleConfiguration>';
  var payload = Buffer.from(xml, "utf-8");
  var md5 = crypto.createHash("md5").update(payload).digest("base64");
  return s3Fetch("PUT", "/" + CONFIG.bucket, "lifecycle", payload, {
    "Content-Type": "application/xml",
    "Content-MD5": md5,
  });
}

function setLifecycleRule() {
  var days = expireDays();
  if (days === null) {
    console.log("  Lifecycle: untouched (set expire_days to let this skill manage it)");
    return Promise.resolve();
  }

  return readLifecycle()
    .then(function (existing) {
      var others = rulesFrom(existing);
      var wanted = days > 0 ? [expiryRule(days)] : [];

      if (!wanted.length && !others.length) {
        // Ours is gone and there is nothing of anyone else's left, so the honest end
        // state is an empty configuration — and getting there needs DELETE. Safe
        // precisely because the read above proved there is nothing left to lose.
        if (!/<Rule[\s>]/.test(existing)) {
          console.log("  Lifecycle: nothing to remove");
          return null;
        }
        return s3Fetch("DELETE", "/" + CONFIG.bucket, "lifecycle")
          .then(function () { console.log("  Lifecycle: no expiry"); });
      }

      return putLifecycle(wanted.concat(others)).then(function () {
        console.log("  Lifecycle: " + (days > 0 ? days + " days (md-web/ only)" : "no expiry (only the md-web rule was removed)"));
      });
    })
    // Report the failure either way: swallowing it meant a token without lifecycle
    // permission produced no output at all, so the bucket kept whatever rule it had
    // while the config said otherwise.
    .catch(function (e) {
      var msg = e.message || "";
      console.error("  Warning: lifecycle — " + msg +
        (msg.indexOf("AccessDenied") !== -1
          ? " (token needs Admin Read & Write, or set the rule in the Cloudflare Dashboard)"
          : ""));
    });
}

function serverDeployed() {
  // Local flag matches this bucket + the bundled viewer files → skip setup
  try {
    if (fs.readFileSync(DEPLOYED_FLAG, "utf-8") === deployFingerprint()) {
      return Promise.resolve(true);
    }
  } catch (_) {}
  return Promise.resolve(false);
}

function deployServer() {
  var serverDir = path.join(SCRIPT_DIR, "docsify-server");
  var files = [];
  var indexFile = null;

  function walk(dir, prefix) {
    fs.readdirSync(dir).forEach(function (name) {
      var full = path.join(dir, name);
      var key = prefix ? prefix + "/" + name : name;
      if (fs.statSync(full).isDirectory()) {
        walk(full, key);
      } else if (key === "index.html") {
        indexFile = { full: full, key: key };
      } else {
        files.push({ full: full, key: key });
      }
    });
  }
  walk(serverDir, "");

  // Parallel upload (work-stealing, 4 concurrent)
  var concurrency = 4;
  var idx = 0;
  function next() {
    if (idx >= files.length) return Promise.resolve();
    var file = files[idx++];
    return uploadFile(file.full, file.key).then(next);
  }

  var workers = [];
  for (var i = 0; i < Math.min(concurrency, files.length); i++) {
    workers.push(next());
  }

  return Promise.all(workers)
    .then(function () {
      // index.html last → atomicity. Stamp asset URLs with the bundle hash.
      if (indexFile) {
        var html = versionIndexHtml(fs.readFileSync(indexFile.full, "utf-8"), serverDirHash());
        return putObject(Buffer.from(html, "utf-8"), indexFile.key);
      }
    })
    .then(function () { return setLifecycleRule(); })
    .then(function () {
      try { fs.writeFileSync(DEPLOYED_FLAG, deployFingerprint()); } catch (_) {}
      console.log("Docsify server deployed.\n");
    });
}

// ── Timestamp ──
function timestamp() {
  var d = new Date();
  var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
    + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

// All uploaded markdown lives under this key prefix, so the auto-expiry lifecycle
// rule (and any future cleanup) only ever touches md-web's own files.
var UPLOAD_PREFIX = "md-web/";

var DOC_EXTS = [".md", ".markdown", ".txt"];

function addTimestamp(key) {
  var ext = path.extname(key);
  var base = key.slice(0, key.length - ext.length);
  // Strip only an extension we recognise. path.extname() calls everything after the last
  // dot an extension, so "v1.2-release-notes" reported ".2-release-notes" and dropping it
  // shipped the document as "v1.md" — silently truncated, with a 200 on the URL to hide it.
  if (DOC_EXTS.indexOf(ext.toLowerCase()) === -1) base = key;
  return timestamp() + "-" + base + ".md";
}

// ── Main ──
// Provisioning and publishing are separate commands on purpose. Publishing used to
// deploy the whole viewer whenever the fingerprint did not match, so an ordinary
// publish could rewrite index.html and every asset at the bucket root — shared state
// every published document depends on — as a side effect of publishing one document.
// It now refuses and names the one command that provisions it.
function setup() {
  console.log("Provisioning viewer: index.html + assets at the bucket root, then the lifecycle rule.");
  return deployServer().then(function () {
    console.log("Viewer ready: " + CONFIG.public_url + "/index.html");
  });
}

function publish() {
  return serverDeployed().then(function (deployed) {
    if (!deployed) {
      throw new Error("the viewer is not provisioned for this bucket yet. Run once: node " + SCRIPT_NAME + " " + SETUP_FLAG);
    }
    var key = UPLOAD_PREFIX + addTimestamp(args[1]);
    return uploadFile(localPath, key).then(function () {
      var name = key.replace(/\.md$/i, "");
      // The key is percent-encoded on the way in (uriEncodePath in s3Fetch), so it has to be
      // encoded on the way out too: a raw space ends the link the moment anything parses it.
      console.log("\n" + CONFIG.public_url + "/index.html#/" + name.split("/").map(encodeURIComponent).join("/"));
    });
  });
}

(isSetup ? setup() : publish())
  .then(function () {
    agent.destroy();
  })
  .catch(function (e) {
    console.error("UPLOAD_FAILED: " + e.message);
    agent.destroy();
    // Set exitCode instead of process.exit() so the URL/error line is flushed
    // to a piped stdout/stderr before the process exits (process.exit can
    // truncate async pipe writes on Linux/macOS — the skill captures this output).
    process.exitCode = 1;
  });
