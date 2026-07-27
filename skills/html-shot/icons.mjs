#!/usr/bin/env node
/**
 * html-shot/icons.mjs — one design, one icon set.
 *
 * Same engine as render.mjs (it literally shells out to it for the master), but the output
 * is the handful of files a given target actually reads, under the names it expects.
 *
 * The pipeline is short: normalise whatever you hand it into ONE 1024x1024 transparent PNG
 * master, then fan that master out. SVG and HTML go through Chromium rather than a
 * lightweight SVG rasteriser on purpose — filters (feTurbulence, feDisplacementMap) come out
 * visibly different in the two engines, and a mark whose texture IS the design would ship
 * silently altered.
 *
 * What it deliberately does NOT emit, because nothing reads them any more: the apple-touch
 * size ladder (57/60/72/76/114/120/144/152 — iOS scales 180 down itself), browserconfig.xml
 * and mstile-*.png (Windows tiles are gone), mask-icon.svg (Safari stopped using it for
 * pinned tabs), and *-precomposed.png. It also never SYNTHESISES an SVG from a raster: a
 * base64 <image> wrapped in <svg> is bigger than the PNG and gives up the only two things
 * favicon.svg is for — crisp arbitrary scaling and prefers-color-scheme inside the file.
 * An SVG source is passed through as-is; a raster source simply gets no SVG.
 *
 * Usage:
 *   node icons.mjs <source.svg|.html|.png|url> <outdir> [options]
 * Options:
 *   --preset P     web (default) | docusaurus | next | electron | tauri
 *   --only LIST   emit only these, comma separated. web presets: ico,svg,apple,pwa;
 *                  app presets: ico,icns,png. A docs page or an internal tool usually
 *                  wants just "ico"; a public site wants the default three.
 *   --pwa          also emit icon-192.png + icon-512.png and print the manifest entry
 *                  (web presets only; skip it unless the site is actually installable)
 *   --bg COLOR     background for apple-touch-icon, which MUST be opaque — iOS composites
 *                  alpha onto black. Default #ffffff. For a rounded mark, pass the mark's
 *                  own fill so the corners vanish under iOS's mask.
 *   --small SRC    a simplified mark to use for the 16 and 32 px .ico entries. A logo with
 *                  real detail turns to mush at 16 px however well it is downsampled; the
 *                  fix is a different drawing, not a better filter.
 *   --scale/--wait/--base/--style/--channel   passed through to render.mjs for the master
 *
 * Examples:
 *   node icons.mjs logo.svg static/img --preset docusaurus
 *   node icons.mjs logo.svg public --only ico            # just the page icon, one file
 *   node icons.mjs logo.svg src/app --preset next --bg "#161A22"
 *   node icons.mjs brand/logo.svg build --preset electron
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { dirname, resolve, extname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const RENDER = resolve(SKILL_DIR, "render.mjs");

let sharp, png2icons;
try {
  ({ default: sharp } = await import("sharp"));
  png2icons = await import("png2icons");
} catch (e) {
  console.error(`html-shot/icons: dependencies are not installed (${e.code || e.message}).`);
  console.error(`Run once:\n  npm --prefix "${SKILL_DIR}" install`);
  process.exit(1);
}

function fail(msg) {
  console.error(`html-shot/icons: ${msg}`);
  console.error("usage: node icons.mjs <source.svg|.html|.png|url> <outdir> [--preset web|docusaurus|next|electron|tauri] [--only ico,svg,apple,pwa] [--pwa] [--bg COLOR] [--small SRC]");
  process.exit(1);
}
const warn = (msg) => console.error(`html-shot/icons: note — ${msg}`);

const [source, outDirArg, ...rest] = process.argv.slice(2);
if (!source || !outDirArg) fail("missing <source> or <outdir>");

const VALUE_FLAGS = new Set(["preset", "only", "bg", "small", "scale", "wait", "base", "style", "channel"]);
const BOOL_FLAGS = new Set(["pwa"]);
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

// Each target reads the same three concepts under different names, so the preset picks the
// names — it is not a different pipeline. Sizes are the ones anything still consumes.
const PRESETS = {
  web:        { kind: "web", ico: "favicon.ico", svg: "favicon.svg", apple: "apple-touch-icon.png" },
  docusaurus: { kind: "web", ico: "favicon.ico", svg: "favicon.svg", apple: "apple-touch-icon.png" },
  // Next's App Router wires up app/icon.* by filename, and it does not have to be a vector —
  // with a raster source `icon.png` is the file that gets picked up, so the svg slot falls
  // back to it rather than leaving the project with no icon.* at all.
  next:       { kind: "web", ico: "favicon.ico", svg: "icon.svg", svgFallback: ["icon.png", 512], apple: "apple-icon.png" },
  electron:   { kind: "app", ico: "icon.ico", icns: "icon.icns", png: [["icon.png", 1024]] },
  tauri:      { kind: "app", ico: "icon.ico", icns: "icon.icns",
                png: [["icon.png", 1024], ["32x32.png", 32], ["128x128.png", 128], ["128x128@2x.png", 256]] },
};
const presetName = opts.preset ?? "web";
const preset = PRESETS[presetName];
if (!preset) fail(`--preset accepts ${Object.keys(PRESETS).join(" | ")}, got "${presetName}"`);
if (opts.pwa && preset.kind !== "web") fail(`--pwa applies to the web presets; --preset ${presetName} builds desktop app icons`);

// How many files you actually need is not the same question as which target you are building
// for. A documentation page or an internal tool wants one favicon and nothing else; a public
// site wants the three; only an installable app wants the PWA pair. --only picks by hand.
const CAPS = preset.kind === "web" ? ["ico", "svg", "apple", "pwa"] : ["ico", "icns", "png"];
let want;
if (opts.only !== undefined) {
  want = new Set(opts.only.split(",").map((s) => s.trim()).filter(Boolean));
  if (!want.size) fail("--only needs at least one of " + CAPS.join(","));
  for (const k of want)
    if (!CAPS.includes(k)) fail(`--only accepts ${CAPS.join(",")} for --preset ${presetName}, got "${k}"`);
} else {
  want = new Set(CAPS.filter((k) => k !== "pwa")); // pwa is always opt-in
}
if (opts.pwa) want.add("pwa");

// The next preset writes into app/, where the App Router picks files up by CONVENTION name.
// icon-192.png is not one of those names, and app/ is not served at the site root either, so
// the pair would land where nothing can fetch it — under a manifest entry pointing at "/".
if (want.has("pwa") && presetName === "next")
  fail(`the PWA pair cannot share an output directory with --preset next: these two files belong in public/, but the next preset writes App Router convention names into app/. Build them separately:\n  node icons.mjs ${source} public --only pwa`);

// The default needs no checking, so all of this is about a --bg the user actually passed.
const bg = opts.bg ?? "#ffffff";
if (opts.bg) {
  // Same rule as --small: what decides whether --bg does anything is whether THIS run writes
  // the apple-touch icon, not whether the preset could. Without these two the flag is
  // silently ignored on the desktop presets — and the see-through check below would refuse
  // the run while blaming a file that was never going to be written.
  if (!preset.apple) fail(`--bg only affects the apple-touch icon, which --preset ${presetName} does not build`);
  if (!want.has("apple")) fail(`--bg only affects the apple-touch icon, which --only ${opts.only} leaves out`);
  // Hex is 3, 4, 6 or 8 digits — not "3 to 8", which would wave through #12345 for sharp to
  // choke on later, after files have already been written.
  if (!/^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]+)$/i.test(bg))
    fail(`--bg should be a CSS colour name or #rgb / #rgba / #rrggbb / #rrggbbaa, got "${bg}"`);
  // A see-through --bg defeats the entire point of the flag: flatten() composites onto
  // rgba(0,0,0,0) and removeAlpha() then bakes it to solid black — the black-cornered iOS icon
  // this option exists to avoid, reported as a success. "transparent" parses fine in sharp, so
  // nothing downstream catches it.
  const bgAlpha = /^transparent$/i.test(bg) ? 0
    : /^#[0-9a-f]{4}$/i.test(bg) ? parseInt(bg[4] + bg[4], 16)
    : /^#[0-9a-f]{8}$/i.test(bg) ? parseInt(bg.slice(7), 16)
    : 255;
  if (bgAlpha < 255)
    fail(`--bg ${bg} is see-through, but the apple-touch icon has to be opaque — iOS composites alpha onto black, so this would ship a black icon. Pass an opaque colour.`);
  // A misspelt colour name ("wihte") otherwise reaches sharp mid-fan-out and throws after
  // other files have already landed in the user's directory. Parse it once, here, where the
  // only cost of being wrong is exiting.
  try { await sharp({ create: { width: 1, height: 1, channels: 4, background: bg } }).png().toBuffer(); }
  catch { fail(`--bg "${bg}" is not a colour sharp can parse — use a CSS colour name or a hex value`); }
}

const outDir = resolve(outDirArg);
if (!existsSync(outDir)) fail(`output directory does not exist: ${outDir}`);
if (!statSync(outDir).isDirectory()) fail(`output path is not a directory: ${outDir}`);

const isUrl = /^https?:\/\//i.test(source);
if (!isUrl && !existsSync(resolve(source))) fail(`source not found: ${source}`);
const srcExt = isUrl ? "" : extname(resolve(source)).toLowerCase();
if (opts.small) {
  if (!existsSync(resolve(opts.small))) fail(`--small source not found: ${opts.small}`);
  // Every preset defines an ico name, so testing preset.ico alone never fires. What decides
  // whether --small does anything is whether THIS run emits the .ico — and if it does not,
  // the flag costs a second full Chromium render whose output is then discarded in silence.
  if (!preset.ico) fail(`--small only affects the .ico, which --preset ${presetName} does not build`);
  if (!want.has("ico")) fail(`--small only affects the .ico, which --only ${opts.only} leaves out`);
}

// ---- Step 1: one 1024x1024 transparent master ------------------------------------------
const MASTER = 1024;
const tmp = join(tmpdir(), `html-shot-icons-${randomBytes(6).toString("hex")}`);
mkdirSync(tmp, { recursive: true });
// Registered on exit rather than in a finally: every failure path here goes through fail(),
// and process.exit() skips finally — which would leave a master PNG behind in temp on every
// failed run, and a run that fails is the common case while iterating.
process.on("exit", () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* nothing left to do */ } });
const written = [];
// What the PWA pair actually came out at, so the manifest snippet printed at the end quotes
// the sizes on disk rather than the ones that were asked for.
const pwaWritten = [];

// Anything sharp can decode is a raster source; anything else (svg, html, a URL, no
// extension) is a document for the browser. Without this split a .jpg would be handed to
// render.mjs, served as text/html, and its bytes rendered as a page of mojibake — which
// looks exactly like a successful run.
const RASTER = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".tif", ".tiff"]);

// These two are raster as well, but sharp decodes neither, so they cannot join RASTER above.
// Left out entirely they fall into the browser branch and hit render.mjs's raster guard —
// four lines of error written for a different caller, ending in advice ("convert it with
// sharp") that does not work for exactly these formats. Say the true thing here instead.
const UNDECODABLE = new Set([".bmp", ".ico"]);

// The aspect ratio of an SVG, so a wordmark can be rejected the same way a wordmark PNG is.
// A small duplicate of render.mjs's parser: render.mjs is a CLI that runs on import, so it
// cannot be imported for this.
function svgAspect(file) {
  let src;
  try { src = readFileSync(file, "utf8"); } catch { return null; }
  const tag = src.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const attr = (n) => tag.match(new RegExp(`(?:^|[\\s"'])${n}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  const px = (v) => {
    const m = v?.trim().match(/^([0-9.]+)(px)?$/i);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n >= 1 ? n : null;
  };
  const w = px(attr("width")), h = px(attr("height"));
  if (w && h) return { w, h };
  const vb = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (vb?.length === 4 && vb.every(Number.isFinite) && vb[2] >= 1 && vb[3] >= 1) return { w: vb[2], h: vb[3] };
  return null;
}

// Everything downstream works off a master, so both the main source and --small go through
// exactly the same normalisation.
async function makeMaster(src, outPath) {
  const ext = /^https?:\/\//i.test(src) ? "" : extname(resolve(src)).toLowerCase();
  if (UNDECODABLE.has(ext))
    fail(`${basename(src)} is a ${ext} file, which nothing in this pipeline can decode — export the artwork as SVG (best, it stays crisp at every size) or as a PNG at 1024×1024, and pass that`);
  if (RASTER.has(ext)) {
    // A raster source is used at its own resolution: upscaling it would look worse than
    // whatever the author already has, and doing it silently hides that it is too small.
    const m = await sharp(resolve(src)).metadata();
    if (m.width !== m.height) fail(`${basename(src)} is ${m.width}×${m.height}; an icon master must be square`);
    if (m.width < MASTER) warn(`${basename(src)} is ${m.width}×${m.width}; ${MASTER}×${MASTER} or larger keeps the big icons sharp`);
    // .png is copied byte-for-byte; every other format is decoded into one.
    if (ext === ".png") copyFileSync(resolve(src), outPath);
    else await sharp(resolve(src)).png({ compressionLevel: 9 }).toFile(outPath);
  } else {
    // A non-square vector is letterboxed into the square frame by preserveAspectRatio and
    // comes out as a band floating in empty space — the same defect the raster branch above
    // refuses, so refuse it here too instead of shipping an illegible 16 px wordmark.
    if (ext === ".svg") {
      const a = svgAspect(resolve(src));
      // A null aspect is not "probably square". It means the file declares no usable
      // width/height and no viewBox, so render.mjs has no coordinate system to stretch to the
      // 1024 frame: the mark lands at its authored size in the top-left and render.mjs only
      // WARNS, exiting 0 — which would ship a favicon that is blank at 16 px behind a ✔.
      if (!a)
        fail(`${basename(src)} declares no usable width/height and no viewBox, so it cannot be scaled to a square icon frame — add viewBox="0 0 W H" to the <svg> root`);
      if (Math.abs(a.w - a.h) > 0.01)
        fail(`${basename(src)} is ${a.w}×${a.h}; an icon master must be square — pad the artwork to a square viewBox`);
    }
    const args = [RENDER, src, outPath, "--width", String(MASTER), "--height", String(MASTER), "--transparent"];
    for (const f of ["scale", "wait", "base", "style", "channel"]) if (opts[f] !== undefined) args.push(`--${f}`, opts[f]);
    const r = spawnSync(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
    if (r.error) fail(`could not run render.mjs: ${r.error.message}`);
    // render.mjs exits non-zero when a referenced asset 404s. The master is still written,
    // but an icon built from a page with a hole in it is not something to ship quietly.
    if (r.status !== 0 || !existsSync(outPath))
      fail(`rendering ${basename(src)} failed (render.mjs exited ${r.status}) — see the notes above`);
  }
  return readFileSync(outPath);
}

// A minimal ICO container, needed only for the --small case: png2icons builds every entry
// from a single input, so mixing two drawings means packing the directory here. Entries are
// PNG-compressed, which every browser reads; the png2icons path below stores the sub-64
// sizes as BMP instead, which is what a Windows executable icon wants.
function packIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach(({ size, buf }, i) => {
    const e = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, e + 0);  // 0 means 256
    dir.writeUInt8(size >= 256 ? 0 : size, e + 1);
    dir.writeUInt8(0, e + 2);            // palette entries
    dir.writeUInt8(0, e + 3);            // reserved
    dir.writeUInt16LE(1, e + 4);         // colour planes
    dir.writeUInt16LE(32, e + 6);        // bits per pixel
    dir.writeUInt32LE(buf.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
}

// Every output is cut from the master except one: favicon.svg is a byte-for-byte copy of an
// SVG source. Building the master anyway costs a full Chromium launch and a 1024x1024 render
// for what is a one-line copy — and worse, it applies the square-master check to a source
// that was only ever going to be passed through, so a wordmark is rejected outright.
const needsMaster =
  want.has("ico") || want.has("icns") || want.has("png") || want.has("apple") || want.has("pwa") ||
  (want.has("svg") && srcExt !== ".svg" && !!preset.svgFallback);

try {
  const masterBuf = needsMaster ? await makeMaster(source, join(tmp, "master.png")) : null;
  const smallBuf = opts.small ? await makeMaster(opts.small, join(tmp, "small.png")) : null;
  const masterMeta = masterBuf ? await sharp(masterBuf).metadata() : null;

  const out = (name) => join(outDir, name);
  const note = (name, extra = "") => written.push(`  ${name}${extra ? "  " + extra : ""}`);
  // Nothing downstream may invent pixels the master does not have: a soft interpolation
  // reported at its nominal size is worse than an honest smaller file, because nothing can
  // tell the difference until someone looks at the icon on a home screen. This applies to the
  // single images; the .ico and .icns are containers png2icons fills with its own ladder, so
  // a master below their top size still yields upscaled entries there — give it 1024.
  const clamp = (size, name) => {
    const target = Math.min(size, masterMeta.width);
    if (target !== size)
      warn(`${name} written at ${target}×${target}, not ${size}: the source only has ${masterMeta.width}px to give, and upscaling it would just be soft`);
    return target;
  };

  // ---- Step 2: fan out ------------------------------------------------------------------

  // .ico — png2icons picks the standard size ladder itself. forWinExe stores the sizes below
  // 64 as BMP, which is what older Windows needs to draw them at all.
  if (preset.ico && want.has("ico")) {
    let ico, how;
    if (smallBuf) {
      const png = (buf, size) => sharp(buf).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
      const entries = [
        { size: 16, buf: await png(smallBuf, 16) },
        { size: 32, buf: await png(smallBuf, 32) },
        { size: 48, buf: await png(masterBuf, 48) },
        { size: 64, buf: await png(masterBuf, 64) },
        { size: 128, buf: await png(masterBuf, 128) },
        { size: 256, buf: await png(masterBuf, 256) },
      ];
      ico = packIco(entries);
      how = `16/32 from ${basename(opts.small)}, 48+ from the main mark`;
      if (preset.kind === "app")
        warn(`--small packs the .ico with PNG entries; for an icon embedded in a Windows executable, the BMP entries the default path writes render more reliably on Windows before 10`);
    } else {
      ico = png2icons.createICO(masterBuf, png2icons.BICUBIC2, 0, false, true);
      how = "";
    }
    if (!ico) fail("could not build the .ico");
    writeFileSync(out(preset.ico), ico);
    note(preset.ico, `${(ico.length / 1024).toFixed(1)} KB${how ? " — " + how : ""}`);
  }

  // .icns — pure JS, so this works on Linux and Windows too (no macOS iconutil needed).
  if (preset.icns && want.has("icns")) {
    const icns = png2icons.createICNS(masterBuf, png2icons.BICUBIC2, 0);
    if (!icns) fail("png2icons could not build the .icns");
    writeFileSync(out(preset.icns), icns);
    note(preset.icns, `${(icns.length / 1024).toFixed(1)} KB`);
  }

  // Plain PNG sizes (desktop presets): alpha is kept — every one of these targets wants it.
  // A size larger than the master is clamped rather than upscaled: a soft 2x interpolation
  // reported as "1024×1024" is worse than an honest 512, because nothing downstream can tell
  // the difference until someone looks at the dock icon.
  for (const [name, size] of want.has("png") ? preset.png ?? [] : []) {
    const target = clamp(size, name);
    const buf = target === masterMeta.width
      ? masterBuf
      : await sharp(masterBuf).resize(target, target).png({ compressionLevel: 9 }).toBuffer();
    writeFileSync(out(name), buf);
    note(name, `${target}×${target}`);
  }

  // apple-touch-icon — the one file that must NOT have an alpha channel. iOS composites
  // transparency onto black, so a rounded mark ships with black corners. Flatten, then
  // drop the channel entirely so the mistake cannot come back.
  if (preset.apple && want.has("apple")) {
    const target = clamp(180, preset.apple);
    const buf = await sharp(masterBuf)
      .resize(target, target)
      .flatten({ background: bg })
      .removeAlpha()
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(out(preset.apple), buf);
    note(preset.apple, `${target}×${target} opaque on ${bg}`);
    // A full-pixel scan, unlike the header-only metadata() above — so it is paid for only on
    // the one branch that reads it, and only when it can change what is printed.
    if (!opts.bg && !(await sharp(masterBuf).stats()).isOpaque)
      warn(`${preset.apple} was flattened onto the default #ffffff — if the mark has rounded corners, pass --bg with its own fill so the corners disappear under iOS's mask`);
  }

  // favicon.svg — passed through only when the source really is a vector.
  if (preset.svg && want.has("svg")) {
    if (srcExt === ".svg") {
      copyFileSync(resolve(source), out(preset.svg));
      note(preset.svg, "passed through from the source");
    } else if (preset.svgFallback) {
      const [name, size] = preset.svgFallback;
      const target = clamp(size, name);
      writeFileSync(out(name), await sharp(masterBuf).resize(target, target).png({ compressionLevel: 9 }).toBuffer());
      note(name, `${target}×${target} — the source is not a vector, so this stands in for ${preset.svg}`);
    } else {
      warn(`no ${preset.svg} written: the source is not an SVG, and wrapping a raster in one would be larger than the PNG and still not scale`);
    }
  }

  // PWA pair — opt-in, because a site that is not installable never reads them.
  if (want.has("pwa")) {
    for (const size of [192, 512]) {
      const name = `icon-${size}.png`;
      const target = clamp(size, name);
      writeFileSync(out(name), await sharp(masterBuf).resize(target, target).png({ compressionLevel: 9 }).toBuffer());
      note(name, `${target}×${target}`);
      pwaWritten.push({ name, target });
    }
  }
} catch (e) {
  // An encoder that throws halfway leaves real files in the user's directory. Name them
  // before exiting, so it is clear what landed and what did not, and keep the failure in the
  // same one-line shape as every other error here instead of a raw stack.
  if (written.length) {
    console.error(`html-shot/icons: failed partway through — these were already written to ${outDir}:`);
    console.error(written.join("\n"));
  }
  fail(e?.message?.split("\n")[0] ?? String(e));
}

// An empty set is a failure however the request got there: --only naming something this
// source cannot produce still exits 0 otherwise, and a build step gating on the exit code
// would deploy a site with no icons at all.
if (!written.length) {
  console.error(`html-shot/icons: nothing was written to ${outDir} — the selected outputs produced no files for this source (see the notes above).`);
  process.exit(1);
}

console.log(`✔ ${presetName} icon set → ${outDir}`);
console.log(written.join("\n"));

// The markup is part of the deliverable: the files do nothing until something points at them.
// Only the files that were actually written get a line.
if (preset.kind === "web" && presetName !== "next") {
  const links = [];
  if (want.has("svg") && srcExt === ".svg") links.push(`  <link rel="icon" href="/${preset.svg}" type="image/svg+xml">`);
  if (want.has("apple")) links.push(`  <link rel="apple-touch-icon" href="/${preset.apple}">`);
  if (links.length) {
    console.log(`\nAdd to <head> (${preset.ico} is found at the site root on its own):`);
    console.log(links.join("\n"));
  } else if (want.has("ico")) {
    console.log(`\nNothing to wire up: browsers fetch /${preset.ico} from the site root by themselves.`);
  }
}
if (presetName === "next") console.log(`\nNothing to wire up: Next's App Router picks these up by filename.`);
if (pwaWritten.length) {
  const entry = ({ name, target }) => `{"src":"/${name}","sizes":"${target}x${target}","type":"image/png"}`;
  console.log(`\nIn the web manifest (these two must sit at the site root — in public/, not app/):`);
  console.log(`  "icons": [` + pwaWritten.map(entry).join(",\n            ") + `]`);
}
