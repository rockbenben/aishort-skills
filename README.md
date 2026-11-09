# aishort-skills

> Turn what you have into something you can ship — each one a self-contained agent skill.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A small collection of skills for AI coding assistants — works with [Claude Code](https://claude.com/claude-code), [Cursor](https://cursor.com), [OpenClaw](https://clawhub.ai), and any agent that reads the `SKILL.md` format. Each skill is one directory under [`skills/`](skills/).

[中文](README.zh.md)

## Install

```bash
# ClawHub / OpenClaw — install a single skill by name
clawhub install md-web
clawhub install deepl-translate-node
clawhub install html-shot
clawhub install wpf-desktop
clawhub install nextjs-to-tauri
clawhub install nextjs-to-electron
clawhub install desktop-app-standard

# skills.sh — add the whole repo (Claude Code, Cursor, and more)
npx skills add rockbenben/aishort-skills
```

Or clone this repo and copy (or symlink) a skill directory into your agent's skills folder — `~/.claude/skills/` for Claude Code, `~/.agents/skills/` for the cross-runtime convention Codex and Gemini CLI also read, or wherever your agent keeps them.

## Skills

### [md-web](skills/md-web/) — Markdown → shareable web page

Render a Markdown file as a polished, shareable web page instead of dumping long text into the chat. The `.md` is uploaded to **your own** S3-compatible bucket (Cloudflare R2, AWS S3, Backblaze B2, …), a bundled zero-CDN Docsify server renders it, and you get back a clickable link.

```bash
clawhub install md-web
```

- **Needs:** Node.js + an S3-compatible bucket with public access.
- **Setup:** [English](skills/md-web/README.md) · [中文](skills/md-web/README.zh.md)
- Zero runtime dependencies; credentials stay local in `~/.md-web/config.json`.

### [deepl-translate-node](skills/deepl-translate-node/) — confidence-gated DeepL fallback

Translate with [DeepL](https://www.deepl.com/) **only when your own translation might be wrong and being wrong matters** — proper nouns, legal/medical terms, idioms, low-resource languages, anything high-stakes. The value is the trigger logic, not the API call.

```bash
clawhub install deepl-translate-node
```

- **Needs:** Node.js 18+ and a `DEEPL_API_KEY` (Free tier works; Pro via `DEEPL_API_HOST`).
- **Usage & language codes:** [`SKILL.md`](skills/deepl-translate-node/SKILL.md)

### [html-shot](skills/html-shot/) — a design in, the image assets out

Turn an HTML file, a URL or an SVG into a still image: og:images and social cards, app icons and logo masters, a design exported as a PNG, a full-page screenshot. Headless Chromium (Playwright) means **full CSS fidelity and CJK/emoji straight from system fonts** — no font bundling, no CSS subset, no third-party rendering service. Local files are served over a throwaway `127.0.0.1` server, so fonts, images, `@import` and `srcset` all resolve exactly as they would on the real site — a card renders fine with the project's dev server down. The output size is read from `body`, so you resize the card by editing the CSS, not the command, and `--palette` roughly halves a flat card on the way out. A second entry point, `icons.mjs`, turns one source into a favicon or app-icon set (`.ico`/`.icns`/apple-touch/PWA) under the filenames Docusaurus, Next, Electron or Tauri each expect — as many or as few as the target needs, from one `favicon.ico` for a docs page to the full five for an installable PWA. It will not fake one either: a non-square source is rejected for raster icons (pure SVG passthrough is the exception), and a source smaller than the size the platform asks for is refused with both sizes named — never letterboxed, and never upscaled behind a ✔ unless you ask for it with `--allow-upscale`.

```bash
clawhub install html-shot
```

- **Needs:** Node.js ≥ 20.9 on glibc Linux, macOS, or Windows (no Alpine/musl). First install pulls ~50 MB of deps plus a Chromium that is ~190 MB to download (~300 MB with the headless shell Playwright installs beside it) and ~700 MB on disk, cached once per Playwright version.
- **Setup:** [English](skills/html-shot/README.md) · [中文](skills/html-shot/README.zh.md)
- **Reference:** [`SKILL.md`](skills/html-shot/SKILL.md) · starters: [`template.example.html`](skills/html-shot/template.example.html) (og card) · [`icon.example.html`](skills/html-shot/icon.example.html) (transparent icon / mark)

### [wpf-desktop](skills/wpf-desktop/) — WPF desktop apps on .NET

Review a WPF repository's SDK, packages, startup, windows, DPI, tray behavior and publish profiles, then fix verified issues. New apps and whole-project upgrades target **.NET 10**. For a specific fault, check the affected path and upgrade the dependencies needed to fix it. A read-only assessment reports findings and evidence.

```bash
clawhub install wpf-desktop
```

- **Needs:** .NET 10 SDK on Windows; GitHub Actions for the release pipeline.
- **Language:** English entry point with Chinese setup, dependency upgrade, troubleshooting and release guides.
- **Reference:** [`SKILL.md`](skills/wpf-desktop/SKILL.md)

### [nextjs-to-tauri](skills/nextjs-to-tauri/) — Next.js 16 → Tauri 2 desktop app

Wrap a client-side Next.js 16 (App Router) app in a thin Tauri 2 native shell — ship a ~3–10 MB desktop/portable `.exe` (vs ~150 MB Electron) with auto-update, system tray, single-instance, and window-state, built entirely in GitHub Actions (no local Rust). The value is the hard-won gotchas: the `trailingSlash` white-screen on static export, next-intl i18n routing, updater signing keys, and cross-platform CI.

```bash
clawhub install nextjs-to-tauri
```

- **Needs:** A static-exportable Next.js 16 app; GitHub Actions for the builds.
- **Reference:** [`SKILL.md`](skills/nextjs-to-tauri/SKILL.md)

### [nextjs-to-electron](skills/nextjs-to-electron/) — Next.js → Electron desktop app

Wrap a client-side Next.js (App Router) static export in a thin Electron shell — for **fully-offline / intranet** Windows machines that lack the WebView2 runtime, where Tauri won't launch. Electron ships its own Chromium (~150 MB), so it just runs. `src/` stays untouched; all desktop behavior (language persistence, window-state, single-instance, system tray) lives in a passively-wired `electron/` main-process layer. The value is the gotchas: the `file://` white-screen trap, the custom `app://` protocol, next-intl static-export i18n, and electron-builder packaging.

```bash
clawhub install nextjs-to-electron
```

- **Needs:** A static-exportable Next.js app; GitHub Actions for the Windows builds.
- **Reference:** [`SKILL.md`](skills/nextjs-to-electron/SKILL.md)

### [desktop-app-standard](skills/desktop-app-standard/) — build or upgrade a Tauri/Electron app to our house style, and audit .NET runtime/SDK

**Building:** the skill ships that house style as ten short sections plus the workflow templates it implies. The ones that bite: six targets (Windows/macOS/Linux × x64/arm64), npm with the lockfile as the only source of truth, Actions pinned by major tag (an exact version when you need to be tighter, never a full SHA), no Dependabot, the git tag as the single version, draft → verify → approve → publish, an updater built in, signing once the release is public, and the winget manifest owned by `winget-manifests` rather than by your repo.

A repository-wide review checks versions, security settings, performance, packaging and updates, then addresses demonstrated issues. New apps and whole-project upgrades follow the skill’s [declared major versions](skills/desktop-app-standard/references/version-targets.json). Focused fixes change the dependencies they require. Read-only assessments report gaps and evidence.

Findings that match the house style come back as `notice` rather than as P0/P1/P2, and a decision you have already made goes into `.desktop-policy.json` as a `deviation` with a reason and a revisit condition — after which that finding counts as accepted instead of nagging you every week.

The .NET runtime/SDK lifecycle is **automated** with `audit.mjs --dotnet`: it reads the target frameworks and `global.json`, checks support phase/EOL against the official release metadata, and reports whether the SDK pin's `rollForward` policy can reach the latest. The WPF build/release implementation (XAML, DPI, tray, single-file publish) stays in `wpf-desktop`.

```bash
clawhub install desktop-app-standard
```

- **Needs:** Node.js 22+ (the scripts' own floor; desktop projects should build on the current Active LTS line), network access to the GitHub API (`GITHUB_TOKEN` optional — it only raises the rate limit), and the .NET release-metadata endpoint for `--dotnet` (or `--offline` for local facts only).
- **Reference:** [`SKILL.md`](skills/desktop-app-standard/SKILL.md) · [`references/house-style.md`](skills/desktop-app-standard/references/house-style.md) (the landscape + our stance) · [`references/release-flow.md`](skills/desktop-app-standard/references/release-flow.md) · [`references/adopt-checklist.md`](skills/desktop-app-standard/references/adopt-checklist.md)

## Repository layout

```
skills/
├── md-web/                # Markdown → shareable web page (S3 + Docsify)
├── deepl-translate-node/  # Confidence-gated DeepL translation fallback
├── html-shot/             # HTML/SVG/URL → og:image, social card, screenshot, favicon/app-icon set
├── wpf-desktop/           # WPF desktop apps on .NET — setup, pitfalls, dev switches, release CI
├── nextjs-to-tauri/       # Next.js 16 → Tauri 2 desktop app migration
├── nextjs-to-electron/    # Next.js → Electron desktop app (offline / no-WebView2)
└── desktop-app-standard/ # Tauri/Electron house style — scaffold, audit, and .NET runtime/SDK audit
assets/               # Repo social preview + the html-shot hero (HTML source and rendered PNG), kept outside skills/ so an install never carries them
scripts/              # validate-skills.mjs — the frontmatter, bundle membership and size checks CI gates publishing on
.github/workflows/    # CI: validates, tests md-web, html-shot and desktop-app-standard, then auto-publishes changed skills to ClawHub on push
```

## Experience feedback and maintenance

Keep experience that changes a decision or action in a later project. Before adding it, identify the trigger, the concrete gap in existing guidance, and the template, check, test or reference to update. A review may produce no skill changes when there is no reusable addition.

- Update the existing resource first. Keep guidance for the same decision in one place, and avoid repeating project history already addressed by a template or test.
- Keep project execution logs, test totals, individual timings and successive version snapshots in the source project. Retain only the project name and evidence path when provenance is needed.
- Maintain `VALIDATION.md` by capability, with the verification method, evidence location and environment limits. Update the existing row and distinguish simulation, device testing and pending validation.
- Keep general task routing in `SKILL.md`. Put protocol, platform and fault-specific methods in the relevant reference section for use when the task calls for them.
