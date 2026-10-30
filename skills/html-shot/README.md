# html-shot

> Turn HTML, SVG or a URL into PNG/JPEG/WebP, and build favicon and app-icon sets.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/rockbenben/aishort-skills/blob/main/LICENSE) [![365 Open Source Plan #030](https://img.shields.io/badge/365%20Open%20Source%20Plan-%23030-1f6feb)](https://github.com/rockbenben/365opensource)

`clawhub install html-shot` · `npx skills add rockbenben/aishort-skills` · [中文文档](README.zh.md)

![html-shot renders an HTML design into an image](https://raw.githubusercontent.com/rockbenben/aishort-skills/main/assets/html-shot/hero.png)

> [!TIP]
> A local file is served from a throwaway `127.0.0.1` server and rendered by a local headless Chromium, so your markup never leaves the machine. The page's JavaScript does run — render only input you trust.

## Support

| Dimension | Supported |
| --- | --- |
| Runtime | Node.js ≥ 20.9 on Windows, macOS and glibc Linux. No Alpine/musl: Playwright publishes no musl Chromium build, so `node:*-alpine` images fail at browser launch. |
| Browser | The Chromium Playwright downloads, or one you already have via `--executable` / `--channel chrome` |
| Input | Local HTML and SVG, `file://` URLs, `http(s)` URLs |
| Output | PNG, JPEG, WebP — plus `.ico`, `.icns`, apple-touch and PWA icon sets |
| Fonts | Not bundled — system fonts plus any web fonts the page loads; CJK and emoji need host fonts |
| Dependencies | `sharp` ≥ 0.35.5, `png2icons`, Playwright — `npm ci` installs them |

## Features

- Render an HTML design, an SVG or a live page to PNG, JPEG or WebP — an og card, a badge, one element or the full scroll.
- `--transparent` drops the browser's white backdrop, and `inspect.mjs` reports whether real pixels are transparent rather than merely whether an alpha channel exists.
- `--dpr` sets the output density, `--scale` sets render supersampling; output pixels are the CSS size times `--dpr`.
- Icon sets for favicon, PWA, Next, Electron and Tauri, with the `.ico`, `.icns`, apple-touch and manifest snippets each one expects.
- SVG rasterisation that repairs a missing or invalid `viewBox` from the root's width/height instead of rendering an empty frame.
- A failed asset or a page error exits non-zero, so a written image is never mistaken for a successful capture.

## Quick start

The skill installs into any agent that reads `SKILL.md` — ClawHub, OpenClaw, Claude Code, Cursor — and then asks for the asset itself:

```text
Render this og card as a 1200×630 PNG: card.html
Set this logo as the favicon and the PWA icon set: logo.svg
```

To drive the CLI yourself, install its dependencies once inside the skill directory:

```bash
npm ci
node node_modules/playwright/cli.js install chromium
node render.mjs template.example.html card.png
```

```
✔ card.png  1200×630  png
```

## Usage

| Flag | What it does |
| --- | --- |
| `--selector CSS` | Capture one element instead of the body |
| `--full` | Capture the whole scrollable page |
| `--dpr N` | Output density, default 1; output pixels = CSS size × dpr |
| `--scale N` | Render supersampling, default 2; does not change the output size |
| `--transparent` | Drop the browser's white backdrop |
| `--palette`, `--colors N` | Indexed PNG up to 256 colours; `--colors` selects 2/4/16/256 (implies palette) — lossy |
| `--wait-for CSS` | Wait for a readiness marker instead of a fixed sleep |
| `--offline` | Refuse every request except those to the render's own local server |
| `--timeout MS`, `--max-pixels N` | Stop a runaway capture; 60 s and 64 MP by default |
| `--executable PATH`, `--channel NAME` | Use a browser that is already installed |

Full flag list in [references/cli.md](references/cli.md) · icon presets in [references/icons.md](references/icons.md) · trust model in [references/security.md](references/security.md)

## Limits

- The renderer executes the page's JavaScript — treat the input as code you trust, not as data that needs sandboxing.
- Fonts are not bundled, so CJK or emoji glyphs the host does not have come out as empty boxes.
- An icon whose source is smaller than the platform asks for is refused, not quietly written small under a platform-sized name; `--allow-upscale` keeps the size and loses the detail.
- Identical pixels on another machine are not promised: fonts and rasterisers differ.
- `--offline` blocks requests inside the browser context; it is not a firewall and not a sandbox.

## Tests

```bash
npm test
npm run test:integration
```

Set `HTML_SHOT_EXECUTABLE` to use a browser you already have. Cases that need symlink creation are skipped where the OS forbids it, so a green run does not cover those paths.

## About the 365 Open Source Plan

Project **#030** of the [365 Open Source Plan](https://github.com/rockbenben/365opensource) — one person + AI, 300+ open-source projects in a year.

[Submit your idea →](https://365.aishort.top/) · [Discord](https://discord.gg/PZTQfJ4GjX) · [Telegram](https://t.me/aishort_top)
