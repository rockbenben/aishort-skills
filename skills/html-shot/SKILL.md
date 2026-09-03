---
name: html-shot
version: 1.1.5
description: Use when turning HTML, a URL or SVG into images — og:image, social card, screenshot, favicon or app-icon set. Triggers on 生成 og 图 / 网页截图 / favicon / 应用图标.
tags: [og-image, social-card, html-to-image, svg-to-png, favicon, app-icon, screenshot, playwright, chromium]
homepage: https://github.com/rockbenben/aishort-skills/tree/main/skills/html-shot

metadata:
  openclaw:
    emoji: "📸"
    requires:
      bins: ["node"]
    files:
      - render.mjs
      - icons.mjs
      - package.json
      - package-lock.json
      - template.example.html
      - icon.example.html
---

# html-shot — a design in, the image assets out

Render an HTML file, a URL, or an SVG into a **pixel-perfect** static image with **Playwright**
(headless Chromium): any CSS renders faithfully, and **CJK text and emoji come from system
fonts with nothing to bundle**. A local file is served over a throwaway `127.0.0.1` server, so
Chromium resolves every reference itself — relative paths, site-absolute `/xxx`, `@import`,
`srcset`, fonts named inside a stylesheet — and a card renders correctly with the project's dev
server down.

You never have to leave CSS. The skill handles **what to shoot** (the whole body, one element,
the full page), **how sharp** (supersampling, `--dpr`), and **what ships** (format, palette
size, and for an icon set, the per-platform files).

Two entry points, one engine:

| | |
|---|---|
| `render.mjs` | one design → **one image** (og card, badge, element, page, SVG) |
| `icons.mjs` | one design → **a favicon or app-icon set** (`.ico`/`.icns`/apple-touch/PWA) |

## When to use

- Generating or refreshing an **og:image / social preview card** (1200×630) for a site or repo.
- Turning a **design written in HTML/CSS** — badge, banner, diagram, certificate — into a PNG.
- **Screenshotting a page or one element** of it, from a URL or a local file.
- **Rasterising an SVG** — a logo or app-icon master at an exact size, with transparency —
  when the mark leans on filters that only a browser renders faithfully.
- Anything where the copy is **CJK, emoji, or mixed-script**: system fonts do the work, so
  there is no font to subset or bundle.

**When not to use**

- The copy is all-English *and* you cannot install a browser (CI container, tiny lambda) —
  **Satori / @vercel/og** renders a CSS subset with no Chromium, at the cost of supplying
  fonts yourself.
- You need a chart or a diagram from data — reach for a plotting/diagram tool and shoot the
  result only if you also need it as an image.
- The HTML comes from somewhere you do not trust: it really executes here (see
  [How local files are served](#how-local-files-are-served-and-the-boundaries)).

## Procedure

1. **First run only** — install the engine (below). If it is already installed, `render.mjs`
   just works; if it is not, the script exits with the exact install command to run.
2. **Write or copy the HTML.** Two starters, and they size themselves differently on purpose:
   - `template.example.html` — a card. `body` gets an explicit `width`/`height` in px and the
     output size flows from there.
   - `icon.example.html` — a transparent mark or app icon. The shape sits on a **child**
     element (a background on `body` propagates to the root canvas and ignores its
     `border-radius`), and every size is in `vmin`, so the mark fills whatever size it is
     rendered at. `icons.mjs` renders it once at 1024 and downsamples from there.
3. **Render** with `render.mjs` (see Usage).
4. **Look at the output image before reporting success.** Read the PNG back — clipped text,
   a missing glyph, or a font that silently fell back are all visible in one glance. A
   referenced asset that 404s prints a `note —` line naming the path and makes the exit
   code non-zero (the image is still written, marked `⚠`).
5. **With `--transparent`, the eye cannot check it** — every viewer paints transparent pixels
   white. Ask the file instead (`sharp` ships with this skill):

   ```bash
   node -e "require(process.argv[1])(process.argv[2]).stats().then(s=>console.log(s.isOpaque?'NO alpha — the page paints its own background':'transparent'))" {SKILL_DIR}/node_modules/sharp badge.png
   ```

   Both paths go in as arguments, not spliced into the quoted JS: inside a JS string a Windows
   path is a run of escape sequences (`\node_modules` begins with a newline), and the spliced
   form throws `Cannot find module` on every backslash path.

## First run (install the engine, once)

```bash
cd {SKILL_DIR} && npm install && node node_modules/playwright/cli.js install chromium
```

Run `npm install` **inside** the skill directory as shown, not `npm --prefix {SKILL_DIR} install`:
when the directory is reached through a symlink (a checkout linked into the agent's skills
directory), `--prefix` rewrites `package-lock.json` with absolute paths. The Chromium step is instant if
the browser is already in Playwright's shared global cache.

**Playwright's supported platforms** (its own system-requirements list; older releases are
untested and the browser may not launch): Windows 11+ / Windows Server 2019+ / WSL,
macOS 14+, and Debian 12–13 / Ubuntu 22.04–26.04 on x86-64 or arm64. There is **no musl
build**, so Alpine images (`node:*-alpine`) cannot run this — use a glibc base such as
`node:22-slim` in CI. (`sharp` does have musl builds, so the install succeeds and only the
browser launch fails, which reads like a mystery.)

**On Linux** (servers, containers, WSL, CI) two extra things are needed — macOS and Windows
have both already:

```bash
# 1. Chromium's shared libraries (needs sudo; skip if the browser already launches)
node {SKILL_DIR}/node_modules/playwright/cli.js install --with-deps chromium

# 2. CJK + emoji system fonts, or non-Latin text renders as tofu boxes (□□□)
sudo apt install fonts-noto-cjk fonts-noto-color-emoji   # Debian/Ubuntu
```

`{SKILL_DIR}` is this skill's own directory — whatever path the agent reports when it loads
the skill (`~/.claude/skills/html-shot`, `~/.agents/skills/html-shot`, a project-local
`.skills/`, …). Footprint: ~47 MB of dependencies, plus **~700 MB of browser on disk** — Playwright
installs both `chromium` (~430 MB) and `chromium_headless_shell` (~270 MB); the ~150 MB
figure quoted elsewhere is the compressed download. Both are cached globally and shared
across projects, so it is paid once per Playwright version. The first install takes a few
minutes. There is no need to probe
whether it is installed — run `render.mjs` and it will tell you, with the command to run.

## Usage

```bash
node {SKILL_DIR}/render.mjs <input.html|input.svg|url> <output.(png|jpg|webp)> [options]
```

**Size is automatic**: with no `--width/--height`, the actual rendered box of `body` is
measured — including the default-margin offset, so a page without `margin:0` is not cropped
off-center. The card comes out as big as you made it in CSS, and resizing later means editing
one place in the template. (A `body` with no `width` is still a block element, so it fills the
default 1200px viewport width.) Animations are settled before the box is measured **and**
at shot time — finite ones jump to their end state, infinite ones are cancelled — so the
measurement and the frame agree and repeated runs are identical.

| Option | Meaning |
|---|---|
| `--width N` | Viewport width in whole CSS px; in the default mode it also fixes the output width (default: measured from body) |
| `--height N` | Viewport height, likewise (default: measured from body) |
| `--dpr N` | Output pixel density, 0.05–10 (default 1); `--dpr 2` turns a 1200×630 card into 2400×1260 |
| `--scale N` | Render supersampling ratio (default 2); **affects sharpness, not output size** |
| `--format F` | `png` \| `jpeg` (alias `jpg`) \| `webp` (default: inferred from the output extension, which must be one of those — any other extension is an error unless `--format` says otherwise) |
| `--quality N` | jpeg/webp quality, integer 1–100 (default 90; png ignores it) |
| `--palette` | Quantise the png to a 256-colour palette — for flat artwork, the same image at a fraction of the bytes (png only) |
| `--colors N` | Palette size: `2` \| `4` \| `16` \| `256` (implies `--palette`). A palette png stores an index per pixel, so the palette size *is* the bit depth (1/2/4/8 bits) — those four are the only sizes the format has. Anything else is refused rather than silently rounded |
| `--transparent` | Transparent background (png/webp keep alpha, jpeg is flattened onto white; the page itself must not paint an opaque background) |
| `--scheme S` | Emulate a color scheme, `dark` \| `light` (for prefers-color-scheme cards) |
| `--base DIR` | Root for resolving site-absolute assets (`/xxx`); defaults to the nearest `public/` walking up, stopping at the project root |
| `--wait MS` | Extra wait before the shot, for late content, whole ms (default 150; `0` = none) |
| `--selector S` | Shoot one element (the output size follows the element; `--width/--height` still set the viewport it lays out in) |
| `--style CSS` | Extra CSS injected after load, before measuring — pairs with `--selector` to strip a preview sheet's own framing off the element you are shooting |
| `--full` | Shoot the full page (same: `--width/--height` set the viewport, not the output size) |
| `--channel C` | Launch an installed browser instead of the bundled Chromium: `chrome` \| `msedge` (+ `-beta`/`-dev`). Skips the browser download entirely (~700 MB on disk), at the cost of output that tracks whatever version is installed |

Sizing follows one rule everywhere — **output pixels = CSS size × `--dpr`** — in all three
modes (fixed size, `--selector`, `--full`). `--scale` only decides how far to supersample
before scaling back down. Option combinations that get ignored (passing `--base` alongside a
URL, say) print a note rather than being silently dropped.

**Making the file smaller.** A card is flat artwork, and a truecolour PNG stores it as if it
were a photograph. `--palette` roughly halves it and `--colors 16` cuts it to a sixth, with no
visible change (the bundled `template.example.html`, a 1200×630 CJK card: 85 KB truecolour
→ 37 KB at 256 → 15 KB at 16 → 6 KB at 4, i.e. roughly a half, a sixth and a twelfth);
dithering is off
because on flat fills it only adds noise. Use it on cards, marks and diagrams; leave it off for
photographs and long smooth gradients, where too few colours band — there
`--format webp --quality 82` is the better trade. Alpha survives quantisation.

Examples:

```bash
# Social card: as big as body says
node {SKILL_DIR}/render.mjs card.html public/og.png

# 2x / smaller webp / transparent badge / dark-scheme card
node {SKILL_DIR}/render.mjs card.html public/og@2x.png --dpr 2
node {SKILL_DIR}/render.mjs card.html public/og.webp --quality 82
node {SKILL_DIR}/render.mjs badge.html badge.png --transparent
node {SKILL_DIR}/render.mjs card.html og-dark.png --scheme dark

# Custom size / full page / single element / URL
node {SKILL_DIR}/render.mjs card.html cover.png --width 1600 --height 900
node {SKILL_DIR}/render.mjs https://example.com shot.png --full
node {SKILL_DIR}/render.mjs page.html hero.png --selector ".hero"

# Flat artwork at a third / a tenth of the bytes
node {SKILL_DIR}/render.mjs card.html public/og.png --palette
node {SKILL_DIR}/render.mjs mark.html favicon.png --colors 16

# An SVG rasterised by Chromium, at the size you ask for
node {SKILL_DIR}/render.mjs logo.svg logo-1024.png --width 1024 --transparent

# One element out of a preview sheet, with the sheet's own framing stripped
node {SKILL_DIR}/render.mjs brand.html favicon.png --selector "#mark" --transparent --dpr 2 \
  --style "body,.cell{background:transparent!important;padding:0!important}"
```

## Icon sets

```bash
node {SKILL_DIR}/icons.mjs <source.svg|.html|.png|url> <outdir> [--preset P] [--only LIST] [--pwa] [--bg C] [--small SRC]
```

Same engine — it shells out to `render.mjs` for a 1024×1024 transparent master (`--scale`,
`--wait`, `--base`, `--style` and `--channel` pass through to that render), then fans the
master out into the handful of files the target actually reads, under the names it expects.

| `--preset` | Writes |
|---|---|
| `web` (default), `docusaurus` | `favicon.ico` · `favicon.svg` · `apple-touch-icon.png` |
| `next` | `favicon.ico` · `icon.svg` · `apple-icon.png` (App Router picks these up by filename; with a raster source the `icon.svg` slot becomes `icon.png`, which App Router reads just the same) |
| `electron` | `icon.ico` · `icon.icns` · `icon.png` (1024) |
| `tauri` | `icon.ico` · `icon.icns` · `icon.png` · `32x32.png` · `128x128.png` · `128x128@2x.png` |

**How many files you need is a different question from which target you are building for.**
The preset picks the *names*; `--only` picks *how many*. Most icons in the wild are just a page
icon, and for those one file is the whole job:

| What you are icon-ing | Command | Files |
|---|---|---|
| A page: docs, internal tool, demo | `--only ico` | **1** — browsers fetch `/favicon.ico` themselves, nothing to wire up |
| A public site people bookmark | *(default)* | **3** from an SVG source — `.ico` + SVG + apple-touch; **2** from HTML or a raster, which have no vector to pass through |
| An installable PWA | `--pwa` | **5** from an SVG source (**4** otherwise) — the above, plus 192/512 |
| A desktop app | `--preset electron` | **3** — `.ico` + `.icns` + 1024 png |
| A Next app, no legacy audience | `--preset next --only svg,apple` | **2** — `icon.*` + `apple-icon.png`, both auto-wired |

`--only` takes `ico,svg,apple,pwa` on the web presets and `ico,icns,png` on the app ones, so any
subset works. `--pwa` stays opt-in because a site that is not installable never reads those two
files — and they cannot share an output directory with `--preset next` (the manifest fetches
`/icon-192.png` from the site root, i.e. `public/`, while the next preset writes into `app/`), so
build them in two passes: `--preset next` into `app/`, then `--only pwa` into `public/`.

Of the default three, apple-touch is the one to drop when nobody will add the page to an iOS
home screen. Keep the SVG — it is what modern browsers display, and with an SVG source it costs
a file copy. Keep the `.ico` — browsers and crawlers request `/favicon.ico` whether or not you
ship one, so leaving it out trades tens of KB (60 KB from the bundled `icon.example.html`)
for a 404 on every cold visit.

**The run ends by printing the exact `<link>` lines to paste into `<head>`**, only for the
files it actually wrote (`favicon.ico` needs no line; Next's App Router wires its files up by
filename). Copy them from the output rather than writing them by hand.

**Four rules are baked in, because each one is a silent failure otherwise:**

- **`apple-touch-icon` is written opaque, always.** iOS composites alpha onto black, so a
  rounded mark would ship with black corners. It is flattened onto `--bg` (default `#ffffff`)
  and the alpha channel removed; for a rounded mark pass the mark's own fill, so the corners
  disappear under iOS's own mask. A see-through `--bg` is refused rather than baking the icon
  solid black behind a ✔.
- **No single image is upscaled past the master.** apple-touch, the PWA pair, the desktop size
  ladder and the `icon.png` fallback are each clamped to what the source has to give, and the
  clamp is announced — including in the printed manifest snippet, which quotes the sizes on
  disk. The `.ico`/`.icns` containers are the exception (`png2icons` fills their ladders from
  whatever it is handed), so give it a 1024 px square master and the question does not arise.
- **An SVG is passed through, never synthesised.** A vector source is copied to
  `favicon.svg`/`icon.svg` as-is — the file modern browsers display, and the only one that can
  carry a `prefers-color-scheme` dark variant. A raster source simply gets no SVG.
- **`--small` takes a second drawing for the 16 and 32 px `.ico` entries.** A logo with real
  detail turns to mush at 16 px no matter how good the downsampling; the fix is a simpler
  drawing, not a better filter.

Deliberately not emitted, because nothing reads them any more: the apple-touch size ladder
(iOS scales 180 down itself), `browserconfig.xml` / `mstile-*.png`, `mask-icon.svg`, and
`*-precomposed.png`.

## One sheet, many assets

A brand sheet — every mark, logo lockup and card variant on one page — is the comfortable way
to design them, and `--selector` shoots any one of them. The sheet's own framing gets in the
way: the swatch cell behind a rounded mark paints its own white, and an element shot keeps
whatever shows through the corners, so `--transparent` alone comes back opaque. `--style`
removes the framing for the duration of the shot; it is injected before anything is measured,
so a rule that changes layout is reflected in the output size rather than fighting it.

```bash
for m in mark1 mark2 logo; do
  node {SKILL_DIR}/render.mjs brand.html "$m.png" --selector "#$m" --transparent --dpr 2 \
    --style "body,.cell{background:transparent!important;padding:0!important}"
done
```

## Rasterising an SVG

Hand `render.mjs` an `.svg` and it is wrapped in a minimal page (`margin:0`, the svg pinned to
the viewport). The default size comes from the SVG's own `width`/`height`, else its `viewBox`
— so a `viewBox="0 0 100 100"` icon comes out 100×100 unless you say otherwise. Give one of
`--width`/`--height` and the other follows the SVG's aspect ratio.

**The `viewBox` is what makes it scale.** Without one the artwork sits at its authored size
in the top-left corner of whatever frame you asked for. When the root declares a
`width`/`height`, the missing `viewBox` is synthesised from them; a `viewBox` that is present
but unreadable (malformed, or `viewBox=""`) is overwritten in place and noted, never appended
alongside (the parser keeps the first occurrence). When the root declares neither, nothing can
be inferred and the render says so. A raster input (`.png`, `.jpg`, …) is refused outright — it
would otherwise be served as HTML and come out as mojibake.

Go through the browser rather than `sharp`'s own SVG rasteriser when the mark leans on filters
(`feTurbulence`, `feDisplacementMap`): the two engines disagree there, and if that texture is
the design only the browser gives you the design. Plain shapes look the same either way, and
for those `sharp` alone is lighter. For filter-heavy marks `--scale 1` stays closest to a 1×
browser screenshot, since supersampling resamples the generated grain. An SVG's own `<text>`
is drawn with system fonts and the wrapper carries no `lang`, so CJK fallback follows the
rendering machine's locale — convert text to paths for the same bytes on every machine.

## Making an og card

Write the design as an HTML file whose `body` has a fixed size (e.g.
`width:1200px; height:630px`), and reference fonts however is natural — site-absolute
`url("/fonts/x.woff2")` resolves against `public/`, relative `url("fonts/x.woff2")` against
the HTML's own directory. Copy `template.example.html` to your own `og.html`, edit it, then

```bash
node {SKILL_DIR}/render.mjs og.html public/og.png
```

Add `<meta property="og:image">` to the page yourself afterwards. A GitHub repo's Social
preview has to be uploaded by hand in Settings (the `gh` CLI cannot set it).

For a **transparent** mark — an app icon, a favicon master, a badge — start from
`icon.example.html` instead and add `--transparent`. It is built around the trap: the shape
lives on a child element, because a background on `body` is propagated to the root canvas and
the canvas ignores `body`'s `border-radius`.

## How local files are served (and the boundaries)

A local HTML input is not pasted into the page — it is served from a throwaway HTTP server
bound to `127.0.0.1` on a random port, shut down as soon as the shot is taken. Chromium then
resolves references the same way it would on a real site, which is why `@import`, `srcset`,
fonts named inside a stylesheet, and assets injected by scripts all just work.

- **Two directories answer requests**: the input HTML's own directory (so `img/logo.png`
  next to the card resolves), then `--base` — the nearest `public/` by default — so
  site-absolute `/fonts/x.woff2` finds `public/fonts/x.woff2`. Nothing outside those two is
  served: paths are fully resolved first, so neither `/../` nor a symlink inside a root can
  reach outside it.
- **The `public/` search is deliberately narrow**: the directory must be spelled exactly
  `public` on disk, and the walk stops at the project root (the first directory holding
  `package.json` or `.git`) — otherwise a case-insensitive match on Windows/macOS would adopt
  the OS's own shared folder (`C:\Users\Public`, `~/Public`) as a served root. Pass `--base`
  to be explicit.
- **A `file://` URL is treated as a local file**, not a remote page: same roots, charset and
  missing-asset accounting as a plain path.
- **A missing asset is loud**: the request prints a `note —` line naming the path, and the
  run exits non-zero (the image is still written, for inspection) — CI cannot silently ship
  a card with a hole in it.
- **Only this render's Chromium can talk to the server**: every request must carry a
  per-run random token; any other local process that finds the port gets 403.
- **Everything in those two directories is reachable by the page.** Point `--base` at the
  asset directory rather than a project root if that matters.
- The HTML genuinely executes in local Chromium, JavaScript and outbound requests included.
  **Do not point this at HTML you do not trust.**
- A page that omits `<meta charset>` is still read as UTF-8 — the server sends the charset.

## Common mistakes

| Symptom | Cause and fix |
|---|---|
| `--transparent` still gives an opaque image | The page paints its own background. Drop `background` from `body` (and any full-bleed wrapper) — `omitBackground` only removes the *browser's* white. |
| A rounded badge is transparent nowhere, even with `background` only on `body` | A background on `body` is **propagated to the root canvas**, and the canvas is not clipped by `body`'s `border-radius` — so the corners come back filled. Move the radius and the fill onto a child element and leave `body` bare, as `icon.example.html` does. |
| Output is 1200px wide when the card should be narrower | `body` has no `width`, so as a block element it fills the default viewport. Set an explicit `width` on `body`, or pass `--width`. |
| Custom font silently falls back to a system face | The font file was not found — check stderr for a `note —` line naming the path it asked for. It must sit inside `--base` (the nearest `public/`) or the HTML's own directory. |
| The card looks right in a browser but is cropped in the PNG | Content overflows `body`. The clip follows `body`'s box, not its children — give `body` the real size, or shoot the wrapper with `--selector`. |
| `note — this layout's size follows the viewport` | The card sizes itself from the viewport (`vh`/`vw`, auto margins, `min-height:100vh` with a default margin), so measuring and growing chase each other. The initial viewport is used instead; pass `--width/--height` to pin it, or set `margin:0`. |
| An absolutely-positioned element drifts off the card | `position:absolute` resolves against the viewport unless an ancestor is positioned. Put `position:relative` on `body` (the starter template does). |
| Works locally, 404s in Linux CI | A reference whose case does not match the file on disk. Windows/macOS match case-insensitively, Linux does not — the render prints `note — /IMG/A.PNG is spelled /img/a.png on disk` when it spots one. |
| `browserType.launch` fails on Alpine / `node:*-alpine` | Playwright has no musl Chromium build. Switch the image to a glibc base (`node:22-slim`, `node:22-bookworm`). |
| CJK/emoji come out as tofu boxes (□□□) — Linux only | The machine has no CJK/emoji font. `sudo apt install fonts-noto-cjk fonts-noto-color-emoji`, or reference a bundled webfont so the card no longer depends on the host. |
| `browserType.launch` fails with "Host system is missing dependencies" — Linux only | Chromium's shared libs are absent: `node {SKILL_DIR}/node_modules/playwright/cli.js install --with-deps chromium`. |
| Han characters look subtly wrong — Japanese text drawn with Chinese shapes, or vice versa | `<html lang="…">` selects the CJK fallback font. Set it to the content's language (`zh-CN`, `zh-TW`, `ja`, `ko`); with no `lang` the result follows the rendering machine's locale. |
| The same HTML looks different on another machine | System fonts differ across Windows/macOS/Linux, and `lang` steers CJK fallback. For byte-comparable output in CI, set `lang` and bundle a webfont via `@font-face` instead of relying on `system-ui`. |
| Text renders but late content (JS charts, remote images) is missing | Raise `--wait`, e.g. `--wait 1000`. |
| A URL screenshot prints `network did not go idle` | Expected on pages with polling or websockets; the page is captured as-is after 10s. Add `--wait` if something specific is still loading. |
| The png is huge | Flat artwork stored as truecolour. `--palette` (or `--colors 16`) usually cuts it to a third or a tenth, invisibly. For photographic cards use `--format webp --quality 82`, or `jpeg`. |
| `--palette` leaves visible banding | Too few colours for a smooth gradient or a photograph. Raise `--colors`, or drop the flag — quantisation is for flat artwork. |
| An SVG's filter texture looks smoother than in the browser | Supersampling resampled the generated grain. Pass `--scale 1` to match a 1× browser screenshot. |
| `package-lock.json` suddenly full of absolute paths | The engine was installed with `npm --prefix <dir>` through a symlinked skill directory. `git checkout` the lockfile and install with `cd {SKILL_DIR} && npm install` instead. |
<!-- The engine comparison (Satori, hosted APIs, wkhtmltoimage) lives in README.md — it is
     background for a human choosing a tool, not something to carry in agent context. The
     actionable half is in "When not to use" above. -->
