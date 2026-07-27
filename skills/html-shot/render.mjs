#!/usr/bin/env node
/**
 * html-shot — shoot a pixel-perfect still (PNG/JPEG/WebP) of an HTML file or URL.
 * Engine = Playwright (headless Chromium): full CSS fidelity, CJK/emoji straight from
 * system fonts, nothing to bundle.
 *
 * An .svg input is rendered too: it is wrapped in a minimal HTML page (margin:0, the svg
 * pinned to the viewport) and sized from its own width/height or viewBox. Chromium rather
 * than sharp's SVG rasteriser is the point — filters such as feTurbulence/feDisplacementMap
 * come out visibly different in the two engines.
 *
 * A local HTML file (a path, or a file:// URL) is served over a throwaway 127.0.0.1 HTTP
 * server rather than pasted into the page, so Chromium resolves every reference itself —
 * relative paths, "/xxx" site-absolute paths, @import, srcset, fonts named inside a
 * stylesheet, assets injected by scripts. Requests are answered from the input's directory
 * first, then --base (the nearest public/). Paths are canonicalised before the containment
 * check, so neither "/../" nor a symlink can reach outside those roots, and every request
 * must carry this run's random token — other local processes get 403.
 *
 * Size is automatic by default: the actual rendered box of <body> is measured (including
 * the offset from the default margin), so the card is as big as you made it in CSS — no
 * flag to remember. Override with --width/--height. If the card needs a larger viewport the
 * viewport grows and the box is re-measured; a layout whose size depends on the viewport
 * (vh/vw units, auto margins) cannot settle, so that is reported and the initial viewport
 * is used rather than letting the iteration count decide the output size.
 * Output pixels = CSS size x --dpr (1:1 by default); --scale is only the supersampling
 * ratio used while rendering — it buys sharpness, not size.
 *
 * Animations are settled the same way Playwright's screenshots settle them — finite ones
 * are finished, infinite ones cancelled — BEFORE the box is measured, so the measurement
 * and the shot see the same frame and repeated runs are identical.
 *
 * A referenced asset that 404s (or is refused) prints a note AND makes the exit code
 * non-zero; the image is still written, for inspection.
 *
 * Usage:
 *   node render.mjs <input.html|input.svg|url> <output.(png|jpg|webp)> [options]
 * Options:
 *   --width  N     viewport width in CSS px; in the default mode it also fixes the output
 *                  width (integer; default: measured from body)
 *   --height N     viewport height in CSS px; likewise (integer; default: measured from body)
 *   --dpr    N     output pixel density (default 1); --dpr 2 gives a 2400x1260 retina og
 *   --scale  N     render supersampling ratio (default 2); affects sharpness, not size
 *   --format F     png | jpeg (alias jpg) | webp (default: inferred from the output
 *                  extension, which must then be one of those)
 *   --quality N    jpeg/webp quality, integer 1-100 (default 90; png ignores it)
 *   --palette      quantise the png to a 256-colour palette (flat artwork: same to the eye,
 *                  a fraction of the bytes). png only
 *   --colors N     palette size: 2 | 4 | 16 | 256 (implies --palette). A palette png is a
 *                  bit depth, so those four are the only sizes the format can store
 *   --style CSS    extra CSS injected after load, before measuring — strip a preview
 *                  sheet's own framing when shooting one element out of it with --selector
 *   --channel C    launch an installed browser instead of the bundled Chromium:
 *                  chrome | msedge (+ -beta/-dev). Skips the browser download, but the
 *                  output then depends on whatever version is installed
 *   --transparent  transparent background (png/webp keep alpha; jpeg has none, so it is
 *                  flattened onto white. The page itself must not paint an opaque background)
 *   --scheme S     emulate a color scheme, dark | light (for prefers-color-scheme cards)
 *   --base   DIR   root for resolving site-absolute assets ("/xxx") referenced by the HTML;
 *                  defaults to the nearest public/ walking up, stopping at the project root
 *   --wait   MS    extra wait before the shot, for late content (default 150; 0 = none)
 *   --selector S   shoot a single element (size follows the element)
 *   --full         shoot the full page
 *
 * Examples:
 *   node render.mjs card.html og.png                     # as big as body says
 *   node render.mjs card.html og@2x.png --dpr 2          # same card at 2x
 *   node render.mjs card.html og.webp --quality 82       # smaller webp
 *   node render.mjs badge.html badge.png --transparent
 *   node render.mjs card.html og-dark.png --scheme dark
 *   node render.mjs https://example.com shot.png --full
 *   node render.mjs card.html og.png --palette             # flat artwork, a third the bytes
 *   node render.mjs logo.svg logo.png --width 1024 --transparent
 *   node render.mjs sheet.html mark.png --selector "#mark1" --transparent \
 *     --style "body,.cell{background:transparent!important;padding:0!important}"
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync, realpathSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve, extname, basename, sep, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const PW_CLI = resolve(SKILL_DIR, "node_modules/playwright/cli.js");
const INSTALL_HINT = `npm --prefix "${SKILL_DIR}" install && node "${PW_CLI}" install chromium`;

// Check the engine before importing: on an old Node the imports below fail with a syntax
// or module error that reads like a broken install rather than "your Node is too old".
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 9)) {
  console.error(`html-shot: needs Node >= 20.9 (sharp and playwright do); this is ${process.versions.node}.`);
  process.exit(1);
}

// Dynamic imports so a missing install produces one actionable line, not a module stack.
let chromium, sharp;
try {
  ({ chromium } = await import("playwright"));
  ({ default: sharp } = await import("sharp"));
} catch (e) {
  console.error(`html-shot: dependencies are not installed (${e.code || e.message}).`);
  console.error(`Run once:\n  ${INSTALL_HINT}`);
  process.exit(1);
}

function fail(msg) {
  console.error(`html-shot: ${msg}`);
  console.error('usage: node render.mjs <input.html|input.svg|url> <output.(png|jpg|webp)> [--width N --height N --dpr N --scale N --format png|jpeg|webp --quality N --palette --colors 2|4|16|256 --transparent --scheme dark|light --base DIR --wait MS --selector S --full --style CSS --channel chrome|msedge]');
  process.exit(1);
}
const warn = (msg) => console.error(`html-shot: note — ${msg}`);

const [inputArg, output, ...rest] = process.argv.slice(2);
if (!inputArg || !output) fail("missing <input> or <output>");

// Parse options: unknown flags and missing values are errors, never silently swallowed.
const VALUE_FLAGS = new Set(["width", "height", "dpr", "scale", "format", "quality", "scheme", "base", "wait", "selector", "colors", "channel", "style"]);
const BOOL_FLAGS = new Set(["transparent", "full", "palette"]);
const opts = {};
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith("--")) fail(`unexpected argument "${rest[i]}"`);
  const name = rest[i].slice(2);
  if (BOOL_FLAGS.has(name)) opts[name] = true;
  else if (VALUE_FLAGS.has(name)) {
    opts[name] = rest[++i];
    if (opts[name] === undefined || opts[name].startsWith("--")) fail(`--${name} needs a value`);
  } else fail(`unknown option --${name}`);
}
// Pixel counts and millisecond counts must be whole numbers; a fractional one is a mistake
// that would otherwise be rounded away silently or crash the encoder after the render.
const int = (name, def, min = 1) => {
  if (opts[name] === undefined) return def;
  const n = Number(opts[name]);
  if (!Number.isInteger(n) || n < min) fail(`--${name} needs a whole number >= ${min}, got "${opts[name]}"`);
  return n;
};
// Ratios may be fractional, but must stay in a range that yields a renderable image.
const ratio = (name, def, min, max) => {
  if (opts[name] === undefined) return def;
  const n = Number(opts[name]);
  if (!Number.isFinite(n) || n < min || n > max) fail(`--${name} needs a number between ${min} and ${max}, got "${opts[name]}"`);
  return n;
};

let width = int("width", null);
let height = int("height", null);
const dpr = ratio("dpr", 1, 0.05, 10);
const scale = ratio("scale", 2, 0.1, 10);
const quality = int("quality", 90);
const wait = int("wait", 150, 0);
const scheme = opts.scheme ?? null;
if (scheme && !["dark", "light"].includes(scheme)) fail(`--scheme accepts dark | light, got "${scheme}"`);
const transparent = !!opts.transparent;
const selector = opts.selector ?? null;
const full = !!opts.full;

// Palette quantisation. Flat artwork (cards, marks, diagrams) is visually identical at 256
// colours and a fraction of the size; dithering is off because on flat fills it only adds
// noise for the PNG compressor to carry.
// A palette png stores an index per pixel, so the palette size IS the bit depth: 1, 2, 4 or
// 8 bits, i.e. 2, 4, 16 or 256 entries. sharp accepts any number and quietly rounds it to one
// of those — ask for 64 and you get 16 — so anything else is refused here rather than
// silently delivering a quarter of what was asked for.
const PALETTE_STEPS = [2, 4, 16, 256];
const colors = int("colors", null, 2);
if (colors !== null && !PALETTE_STEPS.includes(colors))
  fail(`--colors accepts ${PALETTE_STEPS.join(" | ")} — a png palette is a bit depth (1/2/4/8 bits), so those are the only sizes the format can store; got "${opts.colors}"`);
const palette = !!opts.palette || colors !== null;

// A browser already on the machine, instead of Playwright's bundled Chromium.
// CSS injected after load, before anything is measured. Lets one preview sheet act as the
// source for several assets: shoot each element with --selector and strip the sheet's own
// framing (padding, backgrounds) so the asset comes out clean.
const style = opts.style ?? null;

const CHANNELS = ["chrome", "chrome-beta", "chrome-dev", "msedge", "msedge-beta", "msedge-dev"];
const channel = opts.channel ?? null;
if (channel && !CHANNELS.includes(channel)) fail(`--channel accepts ${CHANNELS.join(" | ")}, got "${channel}"`);

// A file:// URL is a local file: it must go through the same server, containment check,
// charset and missing-asset accounting as a plain path, not be treated as a remote page.
let input = inputArg;
const isUrl = /^https?:\/\//i.test(input);
if (/^file:\/\//i.test(input)) {
  try { input = fileURLToPath(input); } catch (e) { fail(`could not read the file:// URL: ${e.message}`); }
}
if (!isUrl) {
  if (!existsSync(resolve(input))) fail(`input file not found: ${input}`);
  if (statSync(resolve(input)).isDirectory()) fail(`input is a directory, expected an HTML file: ${input}`);
  // Anything that is not an SVG is served as text/html, so handing over a JPEG renders its
  // bytes as a page of mojibake and reports success. It is already an image; say so.
  const RASTER_IN = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".tif", ".tiff", ".bmp", ".ico"];
  const ext = extname(resolve(input)).toLowerCase();
  if (RASTER_IN.includes(ext))
    fail(`${basename(input)} is already a raster image — this renders HTML/SVG, and a ${ext.slice(1)} handed to it would be served as HTML and come out as mojibake. Convert it first (sharp reads png/jpeg/webp/gif/avif/tiff — not bmp or ico), or reference it from an HTML file and shoot that.`);
}
if (opts.base && !isUrl) {
  const b = resolve(opts.base);
  if (!existsSync(b)) fail(`--base directory not found: ${opts.base}`);
  if (!statSync(b).isDirectory()) fail(`--base is not a directory: ${opts.base}`);
}
const outDir = dirname(resolve(output));
if (!existsSync(outDir)) fail(`output directory does not exist: ${outDir}`);

// An .svg input is a document Chromium renders natively, but on its own it would be laid
// out inside body's default margin and default to a replaced element's 300x150. Wrap it in
// a minimal page that pins it to the viewport, and take the default size from the file's
// own width/height (else its viewBox) so an icon comes out at the size it declares.
function svgRootInfo(src) {
  const tag = src.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  // The attribute name must start the attribute, not merely end one: "-" is a word boundary,
  // so a plain \b would let stroke-width answer a query for width — and a Heroicons-style
  // root tag would be measured from its stroke.
  const attr = (n) => tag.match(new RegExp(`(?:^|[\\s"'])${n}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  const px = (v) => {
    const m = v?.trim().match(/^([0-9.]+)(px)?$/i); // %, em, vh etc. are not intrinsic
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
  };
  // "present" and "usable" are two different questions, and the repair below needs both:
  // a viewBox that exists but does not parse has to be REPLACED, not have a second one
  // appended next to it. Presence is asked with its own pattern because attr() only returns
  // NON-EMPTY values — viewBox="" would otherwise read as absent, take the append path, and
  // have its repair silently dropped by the parser, which keeps the first occurrence.
  const hasViewBoxAttr = /(?:^|[\s"'])viewBox\s*=\s*["'][^"']*["']/i.test(tag);
  const vb = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const hasViewBox = vb?.length === 4 && vb.every(Number.isFinite) && vb[2] >= 1 && vb[3] >= 1;
  const w = px(attr("width")), h = px(attr("height"));
  const size = w && h ? { w, h } : hasViewBox ? { w: Math.round(vb[2]), h: Math.round(vb[3]) } : null;
  return { tag, size, hasViewBox, hasViewBoxAttr };
}
let svgBody = null;
if (!isUrl && extname(resolve(input)).toLowerCase() === ".svg") {
  let src;
  try { src = readFileSync(resolve(input), "utf8"); }
  catch (e) { fail(`could not read ${input}: ${e.message.split("\n")[0]}`); }
  const { tag, size, hasViewBox, hasViewBoxAttr } = svgRootInfo(src);

  // The wrapper stretches the svg to the frame with width/height:100%, but an SVG with no
  // viewBox has no user-unit coordinate system to stretch: its contents stay at their
  // authored size in the top-left corner, and asking for a bigger frame just adds empty
  // space. When the root declares a size we know the coordinate system it meant, so give it
  // the viewBox it omitted; when it declares neither, nothing can be inferred — say so
  // rather than writing a mark stranded in the corner.
  let markup = src;
  if (!hasViewBox) {
    if (size) {
      let withVB;
      if (hasViewBoxAttr) {
        // The attribute is there but unusable (wrong arity, units, a sub-1 extent). Appending
        // a second viewBox does nothing: the HTML parser keeps the FIRST occurrence, so the
        // broken one still wins and the render comes out as a magnified sliver of the artwork
        // — silently, at exit 0. Overwrite the value in place instead.
        withVB = tag.replace(/((?:^|[\s"'])viewBox\s*=\s*)["'][^"']*["']/i, `$1"0 0 ${size.w} ${size.h}"`);
        warn(`${basename(input)} has a viewBox that cannot be read; using "0 0 ${size.w} ${size.h}" from its width/height instead. Fix the viewBox on the <svg> root.`);
      } else {
        const closed = /\/>$/.test(tag);
        withVB = tag.replace(/\s*\/?>$/, ` viewBox="0 0 ${size.w} ${size.h}"${closed ? "/>" : ">"}`);
      }
      markup = src.replace(tag, () => withVB);
    } else {
      warn(`${basename(input)} has ${hasViewBoxAttr ? "no usable viewBox" : "no viewBox"}, so its artwork cannot scale to the frame — it will sit at its authored size in the top-left corner. Add viewBox="0 0 W H" to the <svg> root.`);
    }
  }

  svgBody =
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    "html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}" +
    "svg{display:block;width:100%;height:100%}</style></head><body>" + markup + "</body></html>";

  if (!size) {
    // No intrinsic size at all: there is no aspect ratio to complete a single --width from,
    // so the other axis falls back to the default viewport. Say it in both cases — silently
    // shipping a 1024×630 icon is the failure this warning exists to prevent. When BOTH axes
    // were given there is no fallback to report: the output is exactly what was asked for,
    // and the artwork-cannot-scale warning above already covers what is still wrong.
    if (!(width && height))
      warn(`${basename(input)} declares neither width/height nor a usable viewBox, so its size is unknown; ${
        width || height
          ? `the axis you did not give falls back to the default (${width ? "height 630" : "width 1200"}) — pass both --width and --height`
          : "shooting the default 1200×630 viewport — pass --width/--height"}`);
  } else if (!width && !height) { width = size.w; height = size.h; }
  // One dimension given: keep the SVG's own aspect ratio rather than stretching it.
  else if (width && !height) height = Math.max(1, Math.round(width * size.h / size.w));
  else if (height && !width) width = Math.max(1, Math.round(height * size.w / size.h));
}
if (svgBody && selector === null && full) warn("--full on an SVG input is the same as the default; the wrapper is exactly one viewport");

// Render at least as dense as the requested dpr, otherwise the last step upscales (blurry).
const renderScale = Math.max(scale, dpr);

if (isUrl && opts.base) warn("--base only applies to local HTML; ignored for URL input");
if (selector && full) warn("--selector and --full were both given; using --selector");

// Output format: --format wins (case-insensitive, jpg = jpeg). Otherwise the extension
// decides — and an extension we cannot honour is an error, not a silent PNG.
const extOut = extname(output).toLowerCase().replace(".", "");
let fmtIn = opts.format?.toLowerCase();
if (fmtIn === "jpg") fmtIn = "jpeg";
const byExt = { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp" }[extOut];
const format = fmtIn ?? byExt;
if (fmtIn && !["png", "jpeg", "webp"].includes(fmtIn)) fail(`--format accepts png | jpeg | webp, got "${opts.format}"`);
if (!format) fail(`cannot tell the output format from "${output}" — use a .png/.jpg/.webp extension, or pass --format`);
if (quality > 100) fail(`--quality is an integer 1-100, got "${opts.quality}"`);
if (opts.quality !== undefined && format === "png") warn("--quality only applies to jpeg/webp; png ignores it");
if (palette && format !== "png") warn(`--palette/--colors only apply to png; ${format} ignores them (use --quality)`);

// Content types Chromium is picky about (a stylesheet served as octet-stream is ignored in
// standards mode, a module script is blocked). Images and fonts are sniffed, but being
// explicit costs nothing.
// Text types MUST carry charset=utf-8: without it Chromium falls back to a legacy encoding
// and every non-ASCII character in a page that omits <meta charset> turns into mojibake.
const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml; charset=utf-8", ".webp": "image/webp", ".avif": "image/avif",
  ".ico": "image/x-icon",
};

// Windows paths are case-insensitive; fold before comparing containment prefixes.
const fold = process.platform === "win32" ? (p) => p.toLowerCase() : (p) => p;

// Canonical path: resolves symlinks/junctions AND, unlike the JS realpathSync, reports the
// on-disk spelling of each segment (the JS one echoes back the case you asked for).
const canonical = (p) => {
  try { return realpathSync.native(p); } catch { return realpathSync(p); }
};

// Find the project's public/ to resolve "/xxx" against. Two things keep this from wandering
// into somebody else's directory: the match must be spelled exactly "public" on disk
// (existsSync is case-insensitive on Windows/macOS, where C:\Users\Public and ~/Public — an
// OS-shared folder — would otherwise match), and the walk stops at the project root.
function findPublic(startDir) {
  let d = startDir;
  for (let i = 0; i < 6; i++) {
    const cand = resolve(d, "public");
    if (existsSync(cand)) {
      try {
        const real = canonical(cand);
        if (basename(real) === "public" && statSync(real).isDirectory()) return real;
      } catch { /* unreadable; keep walking */ }
    }
    if (existsSync(resolve(d, "package.json")) || existsSync(resolve(d, ".git"))) break;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return startDir;
}

// Serve the input's directory and --base over 127.0.0.1 on an ephemeral port, so Chromium
// resolves references natively instead of us rewriting the HTML.
// Boundaries: a request is answered by the first root that holds the file. Candidates are
// canonicalised BEFORE the containment check, so neither "/../" nor a symlink inside a root
// can reach a file outside the roots. Every request must carry this run's random token
// (injected into Chromium's own requests via route interception); anything else on the
// machine that finds the port gets 403 — and a refused request is reported, so it can never
// silently become a hole in the image.
function serveRoots(roots, indexFile, token, indexBody = null) {
  const problems = new Set();
  const report = (key, msg) => {
    if (problems.has(key)) return;
    problems.add(key);
    warn(msg);
  };
  const server = createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (req.headers["x-html-shot"] !== token) {
      report("403:" + urlPath, `${urlPath} was refused: the request did not come from this render (no token)`);
      res.writeHead(403).end();
      return;
    }
    let file = null;
    let type = null;
    if (urlPath === "/") {
      // indexBody is the generated wrapper for an .svg input; the file's own directory is
      // still a root, so anything the SVG references keeps resolving.
      if (indexBody !== null) {
        res.writeHead(200, { "content-type": MIME[".html"] }).end(indexBody);
        return;
      }
      file = indexFile;
      type = MIME[".html"]; // the input is HTML whatever its extension (.htm, none, ...)
    } else {
      for (const root of roots) {
        const prefix = fold(root.endsWith(sep) ? root : root + sep);
        let real;
        try {
          real = canonical(resolve(root, "." + urlPath));
        } catch {
          continue; // does not exist under this root
        }
        if (!fold(real + sep).startsWith(prefix)) continue; // escapes via /../ or a symlink
        if (!statSync(real).isFile()) continue;
        // Windows and macOS match filenames case-insensitively, Linux does not. realpath
        // gives the on-disk spelling, so a mismatch here is a reference that works on this
        // machine and 404s in Linux CI — worth saying now rather than at deploy time.
        const onDisk = "/" + relative(root, real).split(sep).join("/");
        if (onDisk !== urlPath && onDisk.toLowerCase() === urlPath.toLowerCase())
          warn(`${urlPath} is spelled ${onDisk} on disk — it resolves here but will 404 on a case-sensitive filesystem (Linux/CI)`);
        file = real;
        type = MIME[extname(real).toLowerCase()] || "application/octet-stream";
        break;
      }
    }
    if (!file) {
      // Report each missing path once, immediately — waiting for the end would lose the
      // note when a later failure exits the process. Chromium always probes /favicon.ico;
      // never report that as a missing asset.
      if (urlPath !== "/favicon.ico")
        report("404:" + urlPath, `${urlPath} was requested but not found under the input's directory or --base`);
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": type });
    createReadStream(file).on("error", () => res.destroy()).pipe(res);
  });
  const started = new Promise((ok, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${server.address().port}/`));
  });
  return { server, started, problems };
}

// Settle animations exactly the way Playwright's screenshot does (finite ones finished,
// infinite ones cancelled) so the box we measure and the frame we shoot agree.
const settleAnimations = (page) => page.evaluate(() => {
  for (const a of document.getAnimations()) {
    try {
      const end = a.effect?.getComputedTiming?.().endTime;
      if (typeof end === "number" && Number.isFinite(end)) a.finish();
      else a.cancel();
    } catch { /* an animation that refuses to settle is left alone */ }
  }
}).catch(() => {});

const browser = await chromium.launch(channel ? { channel } : {}).catch((e) => {
  // Playwright words the two cases differently, and neither says the word "channel": a
  // missing bundled build is "Executable doesn't exist at <path>", a missing --channel is
  // "Chromium distribution 'msedge-dev' is not found at <path>". Match what it actually
  // prints — a guard that matches nothing leaves the user with a raw stack.
  if (/Executable doesn't exist|distribution .* is not found|Please run the following command|playwright install/i.test(e.message)) {
    if (channel) {
      console.error(`html-shot: --channel ${channel} was asked for, but that browser is not installed here.`);
      console.error("Drop --channel to use the bundled Chromium, or install the browser.");
    } else {
      console.error("html-shot: the Chromium build for this Playwright version is missing.");
      console.error(`Run once:\n  node "${PW_CLI}" install chromium`);
    }
    process.exit(1);
  }
  // Anything else is unexpected, but this is still a CLI: one line beats re-throwing into a
  // top-level await, where it surfaces as an uncaught exception with a Playwright stack.
  console.error(`html-shot: could not launch the browser: ${e.message.split("\n")[0]}`);
  process.exit(1);
});
let site = null;
let shot;
try {
  const initialViewport = { width: width || 1200, height: height || 630 };
  const page = await browser.newPage({ viewport: initialViewport, deviceScaleFactor: renderScale });
  await page.emulateMedia({ reducedMotion: "reduce", ...(scheme ? { colorScheme: scheme } : {}) });

  let target = input;
  if (!isUrl) {
    const file = resolve(input);
    const inputDir = dirname(file);
    const baseDir = opts.base ? resolve(opts.base) : findPublic(inputDir);
    const roots = (baseDir === inputDir ? [inputDir] : [inputDir, baseDir]).map((r) => {
      try { return canonical(r); } catch { return r; }
    });
    const token = randomBytes(16).toString("hex");
    site = serveRoots(roots, file, token, svgBody);
    target = await site.started.catch((e) => fail(`could not start the local server: ${e.message}`));
    // Stamp this run's token onto Chromium's own requests to our server; anything without
    // it (another local process probing the port) is refused.
    await page.route("**/*", (route) => {
      const req = route.request();
      if (req.url().startsWith(target)) route.continue({ headers: { ...req.headers(), "x-html-shot": token } });
      else route.continue();
    });
  }
  await page.goto(target, { waitUntil: "load" }).catch((e) => {
    fail(`could not load ${inputArg}${isUrl ? "" : " (served locally)"}\n  ${e.message.split("\n")[0]}`);
  });
  // Injected before the settle/measure below, so its effect on layout is what gets measured.
  if (style) await page.addStyleTag({ content: style })
    .catch((e) => fail(`could not inject --style: ${e.message.split("\n")[0]}`));
  // Best-effort settle: live pages with polling/websockets never reach networkidle, so
  // wait a bounded 10s and capture the loaded page as-is instead of crashing.
  await page.waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => warn("network did not go idle within 10s; capturing the page as-is"));
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  if (wait) await page.waitForTimeout(wait); // let content settle before measuring
  await settleAnimations(page);

  // Capture region
  let clip = null;
  if (!selector && !full) {
    const measure = async () => {
      await settleAnimations(page); // a viewport change can start new animations
      return page.evaluate(() => {
        const r = document.body.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }).catch(() => ({ x: 0, y: 0, w: 0, h: 0 }));
    };
    const clipOf = (b) => {
      const x = width ? 0 : Math.max(0, Math.round(b.x));
      const y = height ? 0 : Math.max(0, Math.round(b.y));
      return { x, y, width: Math.round(width || b.w) || 1200, height: Math.round(height || b.h) || 630 };
    };

    // Measure body's real rect (including the default-margin offset, so a page without
    // margin:0 is not cropped off-center). The viewport only ever GROWS to contain the
    // clip — shrinking would reflow viewport-relative layouts and move the box after it
    // was measured — and after each grow the box is re-measured and the clip re-derived.
    clip = clipOf(await measure());
    let settled = false;
    for (let i = 0; i < 4; i++) {
      const vp = page.viewportSize();
      const need = { width: Math.max(vp.width, clip.x + clip.width), height: Math.max(vp.height, clip.y + clip.height) };
      if (need.width === vp.width && need.height === vp.height) { settled = true; break; }
      await page.setViewportSize(need);
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      clip = clipOf(await measure());
    }
    if (!settled) {
      // The body's size or position tracks the viewport (vh/vw units, auto margins, a
      // default margin under min-height:100vh), so growing never converges. Letting the
      // loop bound decide the output would make the size an artifact of this constant, so
      // go back to the viewport we started with and say what happened.
      await page.setViewportSize(initialViewport);
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      clip = clipOf(await measure());
      warn(`this layout's size follows the viewport (vh/vw units or auto margins), so the automatic size cannot settle; shooting the ${initialViewport.width}×${initialViewport.height} viewport instead. Pass --width/--height for a predictable size.`);
    }
    // Keep the clip inside the viewport. A body positioned entirely off-screen leaves
    // nothing to shoot — say so rather than handing Playwright an empty rect.
    const vp = page.viewportSize();
    const x = Math.max(0, Math.min(clip.x, vp.width));
    const y = Math.max(0, Math.min(clip.y, vp.height));
    const w = Math.min(clip.width, vp.width - x);
    const h = Math.min(clip.height, vp.height - y);
    if (w < 1 || h < 1)
      fail(`body's box (${clip.width}×${clip.height} at ${clip.x},${clip.y}) falls outside the ${vp.width}×${vp.height} viewport, so there is nothing to capture — the layout positions it off-screen. Pass --width/--height, or use --full.`);
    clip = { x, y, width: w, height: h };
    width = w;
    height = h;
  }

  // animations:"disabled" re-applies the same settling at shot time, covering anything
  // that started after the measurement above.
  if (selector) shot = await page.locator(selector).screenshot({ omitBackground: transparent, animations: "disabled", timeout: 10_000 })
    .catch((e) => fail(/timeout|waiting for/i.test(e.message)
      ? `no visible element matches --selector "${selector}"`
      : `could not shoot --selector "${selector}"\n  ${e.message.split("\n")[0]}`));
  else if (full) shot = await page.screenshot({ fullPage: true, omitBackground: transparent, animations: "disabled" });
  else shot = await page.screenshot({ clip, omitBackground: transparent, animations: "disabled" });
} finally {
  await browser.close();
  if (site) site.server.close();
}

// Settle everything on "output pixels = CSS size x dpr": a fixed-size card scales to the
// exact target; element/full-page shots have no pre-measured CSS size, so they scale by
// dpr/renderScale. Then encode.
let pipe = sharp(shot);
const meta = await sharp(shot).metadata();
const target = !selector && !full
  ? { w: Math.round(width * dpr), h: Math.round(height * dpr) }
  : { w: Math.round(meta.width * dpr / renderScale), h: Math.round(meta.height * dpr / renderScale) };
if (target.w < 1 || target.h < 1)
  fail(`--dpr ${dpr} shrinks the image below one pixel (${target.w}×${target.h}); raise it`);
if (target.w !== meta.width || target.h !== meta.height) pipe = pipe.resize(target.w, target.h);
if (format === "jpeg") pipe = pipe.flatten({ background: "#ffffff" }).jpeg({ quality }); // jpeg has no alpha
else if (format === "webp") pipe = pipe.webp({ quality });
else pipe = pipe.png(palette
  ? { palette: true, colours: colors ?? 256, dither: 0, compressionLevel: 9 }
  : { compressionLevel: 9 });
const info = await pipe.toFile(resolve(output))
  .catch((e) => fail(`could not write ${output}: ${e.message.split("\n")[0]}`));

// A missing or refused asset means the image is not what the HTML asked for — write it
// anyway (useful for eyeballing what went wrong) but exit non-zero so CI cannot ship it.
if (site?.problems.size) {
  console.log(`⚠ ${output}  ${info.width}×${info.height}  ${format} — written, but ${site.problems.size} referenced asset(s) did not load (notes above)`);
  process.exitCode = 1;
} else {
  console.log(`✔ ${output}  ${info.width}×${info.height}  ${format}`);
}
