#!/usr/bin/env node
/** Upload files to S3-compatible storage for md-web skill. Zero dependencies (Node.js built-in only). */

var crypto = require("node:crypto");
var https = require("node:https");
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");

function createPublishHelpers(skillDir, console = globalThis.console) {
  var SERVER_DIR = path.join(skillDir, "docsify-server");
  var JUNK = ["Thumbs.db", "desktop.ini"];
  var _serverHash = null;
  var DOC_EXTS = [".md", ".markdown", ".txt"];
  var YAML_KEY_LINE = /^[ \t]*(?:["'][^"']+["']|[A-Za-z_][\w.-]*)[ \t]*:(?:[ \t]|$)/;
  function versionIndexHtml(html, version) {
    return html.replace(/(href|src)="(assets\/[^"?]+)"/g, function (_m, attr, asset) {
      return attr + '="' + asset + "?v=" + version + '"';
    });
  }

  function listServerFiles() {
    var out = [];
    function walk(dir, prefix) {
      var names;
      try {
        names = fs.readdirSync(dir).sort();
      } catch (e) {
        // The viewer files ship with the skill, so a missing directory is a broken
        // install. Say that in the documented error vocabulary instead of letting
        // a raw ENOENT stack escape to the caller.
        throw new Error("the viewer assets are missing from " + dir + " (" + (e.code || e.message) + ") — reinstall the skill");
      }
      names.forEach(function (name) {
        if (name.charAt(0) === "." || JUNK.indexOf(name) !== -1) return;
        var full = path.join(dir, name);
        var key = prefix ? prefix + "/" + name : name;
        if (fs.statSync(full).isDirectory()) walk(full, key);
        else out.push({ full: full, key: key });
      });
    }
    walk(SERVER_DIR, "");
    return out;
  }

  function serverDirHash() {
    if (_serverHash) return _serverHash;
    var hash = crypto.createHash("sha256");
    listServerFiles().forEach(function (f) {
      hash.update(f.key);
      hash.update(fs.readFileSync(f.full));
    });
    _serverHash = hash.digest("hex").slice(0, 12);
    return _serverHash;
  }

  function timestamp() {
    var d = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
      + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function slugify(base) {
    var s = String(base).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "");
    return s.slice(0, 80).replace(/[-.]+$/, "") || "doc";
  }

  function addTimestamp(key) {
    key = path.basename(String(key).replace(/\\/g, "/"));
    var ext = path.extname(key);
    var base = key.slice(0, key.length - ext.length);
    // Strip only an extension we recognise. path.extname() calls everything after the last
    // dot an extension, so "v1.2-release-notes" reported ".2-release-notes" and dropping it
    // shipped the document as "v1.md" — silently truncated, with a 200 on the URL to hide it.
    if (DOC_EXTS.indexOf(ext.toLowerCase()) === -1) base = key;
    var slug = slugify(base);
    if (slug !== base) console.log("  Note: remote key normalized to \"" + slug + "\"");
    // The timestamp only has second resolution and the slug is lossy (every name without
    // ASCII letters or digits collapses to "doc"), so two documents published in the same
    // second could land on the same key: the second PUT would overwrite the first, and the
    // first URL would keep answering 200 with someone else's document. A short random
    // suffix makes every publish land on its own object.
    return timestamp() + "-" + slug + "-" + crypto.randomBytes(2).toString("hex") + ".md";
  }

  function prepareMarkdown(buf) {
    var text = buf.toString("utf-8").replace(/^\uFEFF/, "");
    var m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
    if (m && m[1].split(/\r?\n/).some(function (line) { return YAML_KEY_LINE.test(line); })) {
      text = text.slice(m[0].length).replace(/^\s*\r?\n/, "");
      console.log("  Note: YAML front matter stripped from the published copy");
    }
    if (!text.trim()) throw new Error("document is empty after removing front matter");
    return Buffer.from(text, "utf-8");
  }
  return { versionIndexHtml, listServerFiles, serverDirHash, timestamp, slugify, addTimestamp, prepareMarkdown };
}

module.exports = { createPublishHelpers };

// Importing exposes helpers without reading config or starting an upload.
if (require.main === module) {
  var SCRIPT_DIR = __dirname;
  var { versionIndexHtml, listServerFiles, serverDirHash, addTimestamp, prepareMarkdown } = createPublishHelpers(SCRIPT_DIR, console);

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
  // Quoted absolute path for hints the agent will copy verbatim: the skill is rarely the cwd,
  // and skill directories often live under paths with spaces.
  var SCRIPT_CMD = 'node "' + path.resolve(process.argv[1]) + '"';
  var SETUP_FLAG = "--setup";
  var usage = [
    "Usage:",
    "  node " + SCRIPT_NAME + " <local-file> <remote-key>   publish one markdown document",
    "  node " + SCRIPT_NAME + " " + SETUP_FLAG + "                 provision the viewer (first run, and after an upgrade)",
  ].join("\n");

  if (args[0] === "--help" || args[0] === "-h") {
    console.log(usage);
    process.exit(0);
  }
  var isSetup = args[0] === SETUP_FLAG;
  if (isSetup && args.length > 1) {
    console.log(usage);
    console.error('UPLOAD_FAILED: ' + SETUP_FLAG + ' takes no other arguments, got: ' + args.slice(1).join(" "));
    process.exit(1);
  }
  if (!isSetup) {
    if (args.length !== 2) {
      console.log(usage);
      console.error("UPLOAD_FAILED: expected exactly two arguments (<local-file> <remote-key>), got " + args.length + (args.length ? ": " + args.join(" ") : "."));
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
    if (localStat.size === 0) {
      console.error("UPLOAD_FAILED: file is empty: " + localPath);
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
      fs.mkdirSync(USER_CONFIG_DIR, { recursive: true, mode: 0o700 });
      fs.copyFileSync(LOCAL_CONFIG_PATH, USER_CONFIG_PATH);
      // The copy carries the source's mode bits, so tighten it right away: the
      // secret must never sit world-readable, not even for a moment.
      try { fs.chmodSync(USER_CONFIG_PATH, 0o600); } catch (_) {}
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
  // The two most common hand-typed mistakes: pasting the endpoint with its scheme (R2's
  // dashboard shows it as https://...), and a public_url without one. The endpoint's scheme
  // is stripped below, so a pasted one no longer reaches the Host header; what is left to
  // reject is a real path in it ("host/bucket"), which would break the Host header and the
  // signature with an opaque DNS error. A public_url without a scheme yields a link that
  // is not a link.
  CONFIG.endpoint = String(CONFIG.endpoint).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  CONFIG.public_url = String(CONFIG.public_url).trim().replace(/\/+$/, "");
  if (CONFIG.endpoint.indexOf("/") !== -1) {
    console.error("CONFIG_INVALID: endpoint must be a bare hostname (e.g. ACCOUNT_ID.r2.cloudflarestorage.com), got: " + CONFIG.endpoint);
    process.exit(1);
  }
  // A port is allowed and must be split off: https.request takes the host and the
  // port separately, and handing it "host:port" as the hostname makes Node resolve
  // the literal string (ENOTFOUND host:port). The Host header keeps the port,
  // which is exactly what SigV4 signs.
  var ENDPOINT_HOST = CONFIG.endpoint;
  var ENDPOINT_PORT = null;
  var endpointWithPort = /^([^:]+):(\d{1,5})$/.exec(CONFIG.endpoint);
  if (endpointWithPort) {
    ENDPOINT_HOST = endpointWithPort[1];
    ENDPOINT_PORT = Number(endpointWithPort[2]);
  }
  if (!/^https?:\/\//i.test(CONFIG.public_url)) {
    console.error("CONFIG_INVALID: public_url must start with https:// (e.g. https://pub-XXXX.r2.dev), got: " + CONFIG.public_url);
    process.exit(1);
  }

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
  function s3FetchOnce(method, resourcePath, query, payload, extraHeaders) {
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
        // Node omits the default port (443) from the Host header it generates, while
        // the signature below covers CONFIG.endpoint including an explicit :443.
        // Send the signed value verbatim so the server and the signature agree.
        Host: CONFIG.endpoint,
      };
      if (payload.length > 0) reqHeaders["Content-Length"] = payload.length;
      if (extraHeaders) {
        Object.keys(extraHeaders).forEach(function (k) {
          reqHeaders[k] = extraHeaders[k];
        });
      }

      var req = https.request(
        {
          hostname: ENDPOINT_HOST,
          port: ENDPOINT_PORT || undefined,
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
            if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, body: body, headers: res.headers || {} });
            else {
              var err = new Error("HTTP " + res.statusCode + " — " + parseR2Error(body));
              err.statusCode = res.statusCode;
              reject(err);
            }
          });
        }
      );
      req.on("timeout", function () { req.destroy(new Error("Request timed out")); });
      req.on("error", reject);
      req.end(payload.length > 0 ? payload : undefined);
    });
  }

  // Every request this script makes (PUT object, GET/PUT/DELETE ?lifecycle) is idempotent,
  // so transient failures are retried: throttling (429), server errors (5xx), and network
  // errors — notably ECONNRESET on a keep-alive socket the server already closed, which
  // otherwise failed a whole setup run on one stale connection. 4xx answers are final.
  var MAX_ATTEMPTS = 3;
  function isTransient(e) {
    if (e.statusCode) return e.statusCode === 429 || e.statusCode >= 500;
    return true; // no HTTP status: socket/DNS/timeout
  }
  function s3Fetch(method, resourcePath, query, payload, extraHeaders) {
    var attempt = 0;
    function tryOnce() {
      attempt++;
      return s3FetchOnce(method, resourcePath, query, payload, extraHeaders).catch(function (e) {
        if (attempt >= MAX_ATTEMPTS || !isTransient(e)) throw e;
        var delay = 500 * Math.pow(2, attempt - 1);
        console.error("  retry " + attempt + "/" + (MAX_ATTEMPTS - 1) + " after " + (e.message || e) + "");
        return new Promise(function (r) { setTimeout(r, delay); }).then(tryOnce);
      });
    }
    return tryOnce();
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

  function putObject(payload, remoteKey) {
    var ct = getContentType(remoteKey);
    return s3Fetch("PUT", "/" + CONFIG.bucket + "/" + remoteKey, null, payload, {
      "Content-Type": ct,
      "Cache-Control": cacheControlFor(remoteKey),
    }).then(function () { console.log("  OK  " + remoteKey); });
  }

  function uploadFile(localPath, remoteKey) {
    return putObject(fs.readFileSync(localPath), remoteKey);
  }

  // ── Server Deployment and Lifecycle ──
  // Lifecycle administration is opt-in. It is a bucket-level request and needs an
  // Admin token, while publishing one document only ever needs object writes — so an
  // absent expire_days means this tool never sends one at all, and an object-scoped
  // token is enough. null ("do not touch the bucket") is not the same as
  // expire_days: 0 ("remove this skill's rule, leave every other rule alone").
  function expireDays() {
    var d = CONFIG.expire_days;
    if (d == null || d === "") return null;
    if ((typeof d !== "number" && !(typeof d === "string" && /^\d+$/.test(d))) ||
        !Number.isSafeInteger(Number(d)) || Number(d) < 0) {
      throw new Error("CONFIG_INVALID: expire_days must be a non-negative integer");
    }
    return Number(d);
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
      .then(function (r) { return { xml: r.body, transitionMinimum: r.headers["x-amz-transition-default-minimum-object-size"] }; })
      .catch(function (e) {
        // NoSuchLifecycleConfiguration is the only "there is nothing there" answer.
        // AccessDenied and transport failures must abort instead: writing back a
        // config we failed to read would delete rules we never saw.
        if (/NoSuchLifecycle/i.test(e.message || "")) return { xml: "", transitionMinimum: null };
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

  // Everything directly under <LifecycleConfiguration> that is not a <Rule>: S3 adds
  // bucket-wide settings there (e.g. TransitionDefaultMinimumObjectSize) and a rewrite
  // that re-emits only <Rule> elements deletes them without ever showing them.
  function topLevelExtras(xml) {
    var inner = String(xml || "")
      .replace(/^[\s\S]*?<LifecycleConfiguration(?:\s[^>]*)?>/, "")
      .replace(/<\/LifecycleConfiguration>\s*$/, "");
    return inner.replace(/<Rule(?:\s[^>]*)?>[\s\S]*?<\/Rule>/g, "").trim();
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

  function putLifecycle(rules, extras, transitionMinimum) {
    var xml = '<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
      (extras || "") + rules.join("") + '</LifecycleConfiguration>';
    var payload = Buffer.from(xml, "utf-8");
    var md5 = crypto.createHash("md5").update(payload).digest("base64");
    var headers = { "Content-Type": "application/xml", "Content-MD5": md5 };
    if (transitionMinimum) headers["x-amz-transition-default-minimum-object-size"] = transitionMinimum;
    return s3Fetch("PUT", "/" + CONFIG.bucket, "lifecycle", payload, headers);
  }

  function setLifecycleRule() {
    var days = expireDays();
    if (days === null) {
      console.log("  Lifecycle: untouched (set expire_days to let this skill manage it)");
      return Promise.resolve();
    }

    return readLifecycle()
      .then(function (configuration) {
        var existing = configuration.xml;
        var transitionMinimum = configuration.transitionMinimum;
        // A 200 body we cannot parse is NOT "the bucket has no rules". Writing back
        // only md-web's own rule would delete retention rules we never read, so an
        // unreadable configuration aborts the write instead of overwriting it.
        if (existing.trim() && !/<LifecycleConfiguration[\s>]/i.test(existing))
          throw new Error("the bucket answered with something that is not a LifecycleConfiguration; refusing to rewrite the lifecycle configuration");
        var others = rulesFrom(existing);
        var extras = topLevelExtras(existing);
        var wanted = days > 0 ? [expiryRule(days)] : [];

        if (!wanted.length && !others.length) {
          // Ours is gone and there is nothing of anyone else's left, so the honest end
          // state is an empty configuration — and getting there needs DELETE. Safe
          // precisely because the read above proved there is nothing left to lose.
          if (!/<Rule[\s>]/.test(existing)) {
            console.log("  Lifecycle: nothing to remove");
            return null;
          }
          // DELETE removes the whole document, including top-level settings that are
          // not rules; keep those by rewriting a configuration with only the extras.
          if (extras) {
            return putLifecycle([], extras, transitionMinimum).then(function () {
              console.log("  Lifecycle: no expiry (the md-web rule was removed; other settings preserved)");
            });
          }
          return s3Fetch("DELETE", "/" + CONFIG.bucket, "lifecycle")
            .then(function () { console.log("  Lifecycle: no expiry"); });
        }

        return putLifecycle(wanted.concat(others), extras, transitionMinimum).then(function () {
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
    var all = listServerFiles();
    var indexFile = all.filter(function (f) { return f.key === "index.html"; })[0] || null;
    var files = all.filter(function (f) { return f.key !== "index.html"; });

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

    return Promise.allSettled(workers)
      .then(function (results) {
        var failure = results.find(function (result) { return result.status === "rejected"; });
        if (failure) throw failure.reason;
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

  var UPLOAD_PREFIX = "md-web/";

  // ── Main ──
  // Provisioning and publishing are separate commands on purpose. Publishing used to
  // deploy the whole viewer whenever the fingerprint did not match, so an ordinary
  // publish could rewrite index.html and every asset at the bucket root — shared state
  // every published document depends on — as a side effect of publishing one document.
  // It now refuses and names the one command that provisions it.
  function setup() {
    expireDays(); // Reject malformed retention settings before any writes.
    console.log("Provisioning viewer: index.html + assets at the bucket root, then the lifecycle rule.");
    return deployServer().then(function () {
      console.log("Viewer ready: " + CONFIG.public_url + "/index.html");
    });
  }

  function publish() {
    return serverDeployed().then(function (deployed) {
      if (!deployed) {
        throw new Error("SETUP_REQUIRED: the viewer is not provisioned for this bucket/version yet. Run once: " + SCRIPT_CMD + " " + SETUP_FLAG);
      }
      var key = UPLOAD_PREFIX + addTimestamp(args[1]);
      return putObject(prepareMarkdown(fs.readFileSync(localPath)), key).then(function () {
        var name = key.replace(/\.md$/i, "");
        // The key is percent-encoded on the way in (uriEncodePath in s3Fetch), so it has to be
        // encoded on the way out too: a raw space ends the link the moment anything parses it.
        console.log("\n" + CONFIG.public_url + "/index.html#/" + name.split("/").map(encodeURIComponent).join("/"));
      });
    });
  }

  // setup() reads the viewer directory synchronously, so a missing file throws
  // before any promise exists. Without this wrapper the throw escapes as a raw
  // stack trace and the documented UPLOAD_FAILED contract never appears.
  var completion = Promise.resolve()
    .then(function () {
      return isSetup ? setup() : publish();
    })
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
}
