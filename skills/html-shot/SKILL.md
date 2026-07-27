---
name: html-shot
version: 1.0.0
description: Use when turning HTML/CSS into a pixel-perfect static image — generating or updating an og:image or social preview card, or exporting a design, badge, or web page as PNG/JPEG/WebP. Also triggers on "html 转图片", "生成 og 图", "社交卡", "网页截图". Renders through headless Chromium (Playwright); full CSS fidelity, CJK and emoji via system fonts, local fonts and images resolved from disk, output size read from body by default.
tags: [og-image, social-card, html-to-image, screenshot, playwright, chromium, png, webp]
homepage: https://github.com/rockbenben/aishort-skills/tree/main/skills/html-shot

metadata:
  clawdbot:
    emoji: "📸"
    requires:
      bins: ["node"]
    files:
      - render.mjs
      - package.json
      - package-lock.json
      - template.example.html
---

# html-shot — shoot a still of any HTML

Render HTML (a local file or a URL) into a **pixel-perfect** static image. The engine is
**Playwright** (mature headless Chromium): any CSS renders faithfully and **CJK text and
emoji come from system fonts with nothing to bundle**. A local file is served over a
throwaway `127.0.0.1` server, so Chromium resolves every reference itself — relative paths,
site-absolute `/xxx`, `@import`, `srcset`, fonts named inside a stylesheet — and a card
renders correctly with the project's dev server down.

## When to use

- Generating or refreshing an **og:image / social preview card** (1200×630) for a site or repo.
- Turning a **design written in HTML/CSS** — badge, banner, diagram, certificate — into a PNG.
- **Screenshotting a page or one element** of it, from a URL or a local file.
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
2. **Write or copy the HTML.** For a card, start from `template.example.html`; set an
   explicit `width`/`height` on `body` and let the size flow from there.
3. **Render** with `render.mjs` (see Usage).
4. **Look at the output image before reporting success.** Read the PNG back — clipped text,
   a missing glyph, or a font that silently fell back are all visible in one glance. A
   referenced asset that 404s prints a `note —` line naming the path and makes the exit
   code non-zero (the image is still written, marked `⚠`).

## First run (install the engine, once)

```bash
npm --prefix {SKILL_DIR} install
node {SKILL_DIR}/node_modules/playwright/cli.js install chromium   # instant if chromium is already there (shared global cache)
```

**Playwright ships Chromium for** Debian 11–13, Ubuntu 18.04–26.04 (x64 and arm64),
macOS 10.13+ (Intel and Apple silicon), and Windows x64. There is **no musl build**, so
Alpine images (`node:*-alpine`) cannot run this — use a glibc base such as `node:22-slim`
in CI. (`sharp` does have musl builds, so the install succeeds and only the browser launch
fails, which reads like a mystery.)

**On Linux** (servers, containers, WSL, CI) two extra things are needed — macOS and Windows
have both already:

```bash
# 1. Chromium's shared libraries (needs sudo; skip if the browser already launches)
node {SKILL_DIR}/node_modules/playwright/cli.js install --with-deps chromium

# 2. CJK + emoji system fonts, or non-Latin text renders as tofu boxes (□□□)
sudo apt install fonts-noto-cjk fonts-noto-color-emoji   # Debian/Ubuntu
```

`{SKILL_DIR}` is this skill's install directory (`~/.claude/skills/html-shot` by default in
Claude Code). Footprint: ~50 MB of dependencies plus a ~150 MB Chromium (globally cached and
shared across projects); the first install takes a few minutes. There is no need to probe
whether it is installed — run `render.mjs` and it will tell you, with the command to run.

## Usage

```bash
node {SKILL_DIR}/render.mjs <input.html|url> <output.(png|jpg|webp)> [options]
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
| `--transparent` | Transparent background (png/webp keep alpha, jpeg is flattened onto white; the page itself must not paint an opaque background) |
| `--scheme S` | Emulate a color scheme, `dark` \| `light` (for prefers-color-scheme cards) |
| `--base DIR` | Root for resolving site-absolute assets (`/xxx`); defaults to the nearest `public/` walking up, stopping at the project root |
| `--wait MS` | Extra wait before the shot, for late content, whole ms (default 150; `0` = none) |
| `--selector S` | Shoot one element (the output size follows the element; `--width/--height` still set the viewport it lays out in) |
| `--full` | Shoot the full page (same: `--width/--height` set the viewport, not the output size) |

Sizing follows one rule everywhere — **output pixels = CSS size × `--dpr`** — in all three
modes (fixed size, `--selector`, `--full`). `--scale` only decides how far to supersample
before scaling back down. Option combinations that get ignored (passing `--base` alongside a
URL, say) print a note rather than being silently dropped.

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
```

## Making an og card

Write the design as an HTML file whose `body` has a fixed size (e.g.
`width:1200px; height:630px`), and reference fonts however is natural — site-absolute
`url("/fonts/x.woff2")` resolves against `public/`, relative `url("fonts/x.woff2")` against
the HTML's own directory. Start from
`template.example.html`: copy it to your own `og.html`, edit the copy, then

```bash
node {SKILL_DIR}/render.mjs og.html public/og.png
```

Add `<meta property="og:image">` to the page yourself afterwards. A GitHub repo's Social
preview has to be uploaded by hand in Settings (the `gh` CLI cannot set it).

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
  `package.json` or `.git`). Without that, a case-insensitive match on Windows/macOS would
  happily adopt the OS's own shared folder (`C:\Users\Public`, `~/Public`) as a served root.
  Pass `--base` when you want to be explicit.
- **A `file://` URL is treated as a local file**, not a remote page, so it gets the same
  roots, charset and missing-asset accounting as a plain path.
- **A missing asset is loud**: the request prints a `note —` line naming the path, and the
  run exits non-zero (the image is still written, for inspection) — CI cannot silently ship
  a card with a hole in it.
- **Only this render's Chromium can talk to the server**: every request must carry a
  per-run random token, injected into the browser's requests; any other local process that
  finds the port gets 403.
- **Everything in those two directories is reachable by the page.** Point `--base` at the
  asset directory rather than a project root if that matters.
- The HTML genuinely executes in local Chromium, JavaScript and outbound requests included.
  **Do not point this at HTML you do not trust.**
- A page that omits `<meta charset>` is still read as UTF-8 — the server sends the charset.

## Common mistakes

| Symptom | Cause and fix |
|---|---|
| `--transparent` still gives an opaque image | The page paints its own background. Drop `background` from `body` (and any full-bleed wrapper) — `omitBackground` only removes the *browser's* white. |
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
| Colors look washed out or the file is huge | `png` is lossless and large for photos — use `--format webp --quality 82`, or `jpeg` for photographic cards. |

## Choosing an engine (why local Playwright)

There is no option that is both featherweight and able to render arbitrary HTML with CJK
text — it is a real trade-off:

| Approach | Trade-off |
|---|---|
| **This skill** — local Playwright | Full fidelity, CJK from system fonts, no third-party rendering service. Costs a Chromium install. |
| **A route in your own app** (community og-image-skill) | Also local Playwright, but coupled to a framework: good for a site's og images, awkward for one standalone card. |
| **Hosted APIs** (html2png, hcti, …) | Nothing to install, but rate-limited and **your content leaves the machine**. |
| **Satori / @vercel/og** | No browser, lightest, but a CSS subset only and **you supply CJK fonts**. |
| **wkhtmltoimage** | The veteran CLI, no longer maintained. |
