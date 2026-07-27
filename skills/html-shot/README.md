# html-shot

> A design in, the image assets out — HTML, a URL or an SVG, pixel-perfect, CJK and emoji
> included.

[![365 Open Source Plan #030](https://img.shields.io/badge/365%20Open%20Source%20Plan-%23030-1f6feb)](https://github.com/rockbenben/365opensource)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/rockbenben/aishort-skills/blob/main/LICENSE)

**English** · [简体中文](README.zh.md)

![html-shot — any HTML, shot as a pixel-perfect image](https://raw.githubusercontent.com/rockbenben/aishort-skills/main/assets/html-shot/hero.png)

<sub>That card is not a mockup. It was rendered by this skill from
<a href="https://github.com/rockbenben/aishort-skills/blob/main/assets/html-shot/hero.html">assets/html-shot/hero.html</a>
— one command, no font bundled.</sub>

An **agent skill** (works with Claude Code, Cursor, OpenClaw, or any agent that reads the
`SKILL.md` format) that turns a design into an image through headless Chromium. The browser
does the rendering; the skill handles everything around it — paths, sizing, sharpness, file
size — so you never have to leave CSS.

## What it's for

- **og:image / social preview cards** — the 1200×630 card for a site or a repo.
- **A design written in HTML/CSS** — badge, banner, diagram, certificate — exported as a PNG.
- **App icons and logo masters** — from HTML *or* from an SVG, at an exact size, transparent.
  (An SVG needs a `viewBox` to scale to the frame; one is synthesised when the root declares a
  size instead, and a `viewBox` that is present but unreadable is rewritten rather than left
  in charge.)
- **Screenshots** — a whole page, or one element of it, from a URL or a local file.
- **One sheet, many assets** — lay every mark out on a single page, then shoot them one at a
  time with `--selector`, stripping the sheet's own framing with `--style`.
- **A favicon or app-icon set** — `icons.mjs` turns one source into the handful of files a
  site, an Electron app or a Tauri app actually reads, under the names each expects. How many
  is your call: `--only ico` for a docs page or an internal tool (one file, nothing to wire
  up), the default three for a public site, `--pwa` for an installable one. Give it a
  **square** source with real resolution — 1024 px, or a vector with a `viewBox`. A wordmark
  is rejected outright, and a 64 px logo gets honest 64 px PNGs with a note, not a soft 512.
  With `--preset next`, run the PWA pair as a second pass into `public/`: the manifest fetches
  those two from the site root, which `app/` is not.

## Why headless Chromium

There is no option that is both featherweight and able to render arbitrary HTML with CJK
text. It's a real trade-off, and this skill picks a side:

| Approach | Trade-off |
|---|---|
| **This skill** — local Playwright | Full CSS fidelity, CJK from system fonts, no third-party rendering service. Costs a Chromium install — or `--channel chrome` borrows one already on the machine. |
| **Satori / @vercel/og** | No browser, lightest — but a CSS subset only, and **you supply the CJK fonts**. |
| **Hosted APIs** (html2png, hcti, …) | Nothing to install, but rate-limited and **your content leaves the machine**. |
| **wkhtmltoimage** | The veteran CLI, no longer maintained. |

## Install

```bash
# ClawHub / OpenClaw
clawhub install html-shot

# skills.sh (Claude Code, Cursor, and more) — adds the whole repo
npx skills add rockbenben/aishort-skills
```

Or clone this repo and copy (or symlink) `skills/html-shot/` into your agent's skills
folder, e.g. `~/.claude/skills/html-shot`.

**First run only** — install the engine:

```bash
npm --prefix ~/.claude/skills/html-shot install
node ~/.claude/skills/html-shot/node_modules/playwright/cli.js install chromium
```

- **Needs:** Node.js ≥ 20.9 on glibc Linux, macOS, or Windows. **No Alpine/musl** — Playwright
  ships no musl Chromium build.
- **Footprint:** ~50 MB of dependencies plus a ~150 MB Chromium, globally cached and shared
  across projects. The first install takes a few minutes.
- **On Linux**, two extra steps (Chromium's shared libraries, and CJK/emoji system fonts) —
  see [`SKILL.md`](SKILL.md#first-run-install-the-engine-once).

There's no need to probe whether it's installed. Run it; it tells you, with the command.

## Quickstart

`template.example.html` is a ready-made 1200×630 card that uses system fonts only:

```bash
cp ~/.claude/skills/html-shot/template.example.html og.html
node ~/.claude/skills/html-shot/render.mjs og.html og.png
```

That's the whole loop. Edit `og.html`, re-run, look at the PNG.

For a transparent mark or app icon, start from `icon.example.html` and add `--transparent`.
It is built around the trap that catches everyone once: a background on `body` propagates to
the root canvas, and the canvas ignores `body`'s `border-radius`, so a rounded badge styled
that way comes back with opaque corners no matter which flags you pass. The shape has to sit
on a child element.

Or, in an agent, just say what you want — *"turn this design into a 2x og image"*,
*"screenshot the hero section of that page"*, *"生成 og 图"* — and the skill triggers.

## What it handles for you

- **Size comes from the CSS.** With no `--width/--height`, the rendered box of `body` is
  measured, default-margin offset included. You resize the card by editing one line of CSS,
  not the command.
- **CJK and emoji from system fonts.** Nothing to subset, nothing to bundle.
- **Local assets resolve like a real site.** The input file is served from a throwaway
  `127.0.0.1` server, so relative paths, site-absolute `/xxx`, `@import`, `srcset`, and fonts
  named inside a stylesheet all work — with the project's dev server down.
- **A missing asset is loud.** It prints the path it asked for and exits non-zero, so CI
  can't silently ship a card with a hole in it.
- **Repeatable output.** Animations are settled before measuring and again before the shot,
  so two runs of the same HTML agree.
- **It will not fake a result.** No single image is upscaled past the source — it is written
  at the size the master can fill, and said so, manifest snippet included. A see-through
  `--bg` is refused (it would flatten the apple-touch icon to solid black), and an icon
  source that cannot be scaled to a square frame fails up front instead of shipping a mark
  stranded in the corner with exit code 0.
- **Ships small.** `--palette` quantises flat artwork to a palette PNG — on a 1200×630 CJK
  card, 338 KB → 134 KB, or 37 KB at `--colors 16`, with no visible change. (A palette png is
  a bit depth, so the sizes are `2`/`4`/`16`/`256` and nothing in between.)
- **A narrow blast radius.** Only two directories are served, paths are fully resolved first
  (neither `/../` nor a symlink escapes), and every request must carry a per-run random
  token — any other local process that finds the port gets a 403.

The HTML genuinely executes in local Chromium, JavaScript and outbound requests included.
**Don't point this at HTML you don't trust.**

## Options

Full option table, security boundaries, and a symptom→cause troubleshooting table live in
[`SKILL.md`](SKILL.md) — that's the document your agent reads. The short version:

```bash
node render.mjs <input.html|input.svg|url> <output.(png|jpg|webp)> [options]
node icons.mjs  <source> <outdir> [--preset web|docusaurus|next|electron|tauri] [--only ico,svg,apple,pwa] [--pwa] [--bg COLOR] [--small SRC]
```

`--dpr` for retina output · `--transparent` for badges · `--palette` / `--colors 2|4|16|256`
to shrink flat artwork · `--only` to pick how many icons · `--bg` for the apple-touch
background (must be opaque) · `--small` for a simplified 16/32 px drawing ·
`--scheme dark` for `prefers-color-scheme` cards · `--selector` for one
element · `--style` to strip a sheet's framing off it · `--full` for the whole page ·
`--channel chrome` to use an installed browser instead of the bundled one.

## Origin

This came out of building the brand assets for
[Idea Hub](https://github.com/rockbenben/idea-hub) (#028 of the same plan), whose logo and
og card are rendered from HTML by a shell script driving bare `chrome --headless
--screenshot`. That script works, and it still ships. But getting there meant hitting the
same walls every time: Git Bash hands you an MSYS path (`/d/…`) that Chrome's `file://`
handler won't open, every size has to be typed twice into `--window-size` and
`--force-device-scale-factor`, and downsampling needs a separate tool.

html-shot is those walls, taken down once: local files go through a throwaway HTTP server so
paths and relative references stop mattering, the output size is measured off `body`, and
supersampling and downsampling are built in.

Later passes over the same kind of code — brand scripts across half a dozen repos — folded
in what those scripts each had to solve alone: the palette quantization that shell script
pipes through Pillow (`--palette`/`--colors`, which now reproduces its output byte-for-byte),
rasterising an SVG through the browser rather than a lighter SVG engine (filters like
`feTurbulence` come out visibly different), borrowing an installed Chrome (`--channel`), and
injecting CSS to lift one mark cleanly off a contact sheet (`--style`).

## About the 365 Open Source Plan

Project **#030** of the [365 Open Source Plan](https://github.com/rockbenben/365opensource)
— one person + AI, 300+ open-source projects in a year.
[Submit your idea →](https://365.aishort.top/) ·
[Discord](https://discord.gg/PZTQfJ4GjX) ·
[Telegram](https://t.me/aishort_top)
