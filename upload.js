#!/usr/bin/env node
/** Upload files to S3-compatible storage for md-web skill. Zero dependencies (Node.js built-in only). */

var crypto = require("node:crypto");
var https = require("node:https");
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");

var SCRIPT_DIR = __dirname;

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
    var canonicalQS = query ? query + "=" : "";
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
        path: encodedPath + (query ? "?" + query : ""),
        method: method,
        timeout: 30000,
        agent: agent,
        headers: reqHeaders,
      },
      function (res) {
        var body = "";
        res.on("data", function (c) { body += c; });
        res.on("end", function () {
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

function uploadFile(localPath, remoteKey, contentType) {
  var ct = contentType || getContentType(localPath);
  var payload = fs.readFileSync(localPath);
  return s3Fetch("PUT", "/" + CONFIG.bucket + "/" + remoteKey, null, payload, {
    "Content-Type": ct,
    "Cache-Control": cacheControlFor(remoteKey),
  }).then(function () { console.log("  OK  " + remoteKey); });
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

function expireDays() {
  var d = CONFIG.expire_days;
  return (d != null && d >= 0) ? d : 30;
}

function deployFingerprint() {
  return CONFIG.endpoint + "/" + CONFIG.bucket + "@" + serverDirHash() + "@" + expireDays();
}

// ── S3 Lifecycle Rule ──
function setLifecycleRule() {
  var days = expireDays();

  if (days === 0) {
    return s3Fetch("DELETE", "/" + CONFIG.bucket, "lifecycle")
      .then(function () { console.log("  Lifecycle: no expiry"); })
      .catch(function () {});
  }

  // Expire objects with prefix "20" (timestamped uploads only, not Docsify server files)
  var xml = '<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
    '<Rule><ID>md-web-auto-expire</ID>' +
    '<Filter><Prefix>20</Prefix></Filter>' +
    '<Status>Enabled</Status>' +
    '<Expiration><Days>' + days + '</Days></Expiration>' +
    '</Rule></LifecycleConfiguration>';

  var payload = Buffer.from(xml, "utf-8");
  var md5 = crypto.createHash("md5").update(payload).digest("base64");

  return s3Fetch("PUT", "/" + CONFIG.bucket, "lifecycle", payload, {
    "Content-Type": "application/xml",
    "Content-MD5": md5,
  })
    .then(function () { console.log("  Lifecycle: " + days + " days"); })
    .catch(function (e) {
      var msg = e.message || "";
      console.error("  Warning: lifecycle — " + msg +
        (msg.indexOf("AccessDenied") !== -1
          ? " (token needs Admin Read & Write, or set in Cloudflare Dashboard)"
          : ""));
    });
}

function serverDeployed() {
  // Local flag matches current config + server hash + expire_days → skip deploy
  try {
    if (fs.readFileSync(DEPLOYED_FLAG, "utf-8") === deployFingerprint()) {
      return Promise.resolve(true);
    }
  } catch (_) {}
  return Promise.resolve(false);
}

function deployServer() {
  console.log("Deploying Docsify server...");
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
      // index.html last → atomicity
      if (indexFile) return uploadFile(indexFile.full, indexFile.key);
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

function addTimestamp(key) {
  var ext = path.extname(key);
  var base = key.slice(0, key.length - ext.length);
  if (ext.toLowerCase() !== ".md") { ext = ".md"; }
  return timestamp() + "-" + base + ext;
}

// ── Main ──
var args = process.argv.slice(2);
if (args.length < 2) {
  console.log("Usage: node " + path.basename(process.argv[1]) + " <local-file> <remote-key>");
  process.exit(1);
}

var localPath = args[0];
var remoteKey = addTimestamp(args[1]);

serverDeployed()
  .then(function (deployed) {
    if (!deployed) return deployServer();
  })
  .then(function () {
    return uploadFile(localPath, remoteKey);
  })
  .then(function () {
    var name = remoteKey.replace(/\.md$/i, "");
    console.log("\n" + CONFIG.public_url + "/index.html#/" + name);
    agent.destroy();
    process.exit(0);
  })
  .catch(function (e) {
    console.error("UPLOAD_FAILED: " + e.message);
    agent.destroy();
    process.exit(1);
  });
