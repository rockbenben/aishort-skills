# aishort-skills

A small collection of agent skills for AI coding assistants — works with
[Claude Code](https://claude.com/claude-code), [Cursor](https://cursor.com),
[OpenClaw](https://clawhub.ai), and any agent that reads the `SKILL.md` format.
Each skill is a self-contained directory under [`skills/`](skills/).

## Install

```bash
# ClawHub / OpenClaw — install a single skill by name
clawhub install md-web
clawhub install deepl-translate-node
clawhub install html-shot
clawhub install wpf-desktop
clawhub install nextjs-to-tauri
clawhub install nextjs-to-electron

# skills.sh — add the whole repo (Claude Code, Cursor, and more)
npx skills add rockbenben/aishort-skills
```

Or clone this repo and copy (or symlink) a skill directory into your agent's skills folder —
`~/.claude/skills/` for Claude Code, `~/.agents/skills/` for the cross-runtime convention
Codex and Gemini CLI also read, or wherever your agent keeps them.

## Skills

### [md-web](skills/md-web/) — Markdown → shareable web page

Render a Markdown file as a polished, shareable web page instead of dumping long text
into the chat. The `.md` is uploaded to **your own** S3-compatible bucket (Cloudflare R2,
AWS S3, Backblaze B2, …), a bundled zero-CDN Docsify server renders it, and you get back
a clickable link.

```bash
clawhub install md-web
```

- **Needs:** Node.js + an S3-compatible bucket with public access.
- **Setup:** [English](skills/md-web/README.md) · [中文](skills/md-web/README.zh.md)
- Zero runtime dependencies; credentials stay local in `~/.md-web/config.json`.

### [deepl-translate-node](skills/deepl-translate-node/) — confidence-gated DeepL fallback

Translate with [DeepL](https://www.deepl.com/) **only when your own translation might be
wrong and being wrong matters** — proper nouns, legal/medical terms, idioms, low-resource
languages, anything high-stakes. The value is the trigger logic, not the API call.

```bash
clawhub install deepl-translate-node
```

- **Needs:** Node.js 18+ and a `DEEPL_API_KEY` (Free tier works; Pro via `DEEPL_API_HOST`).
- **Usage & language codes:** [`SKILL.md`](skills/deepl-translate-node/SKILL.md)

### [html-shot](skills/html-shot/) — a design in, the image assets out

Turn an HTML file, a URL or an SVG into a still image: og:images and social cards, app icons
and logo masters, a design exported as a PNG, a full-page screenshot. Headless Chromium
(Playwright) means **full CSS fidelity and CJK/emoji straight from system fonts** — no font
bundling, no CSS subset, no third-party rendering service. Local files are served over a
throwaway `127.0.0.1` server, so fonts, images, `@import` and `srcset` all resolve exactly as
they would on the real site — a card renders fine with the project's dev server down. The
output size is read from `body`, so you resize the card by editing the CSS, not the command,
and `--palette` cuts a flat card to a third of its bytes on the way out. A second entry
point, `icons.mjs`, turns one source into a favicon or app-icon set
(`.ico`/`.icns`/apple-touch/PWA) under the filenames Docusaurus, Next, Electron or Tauri each
expect — as many or as few as the target needs, from one `favicon.ico` for a docs page to the
full five for an installable PWA. It will not fake one either: a non-square source is
rejected, and an image larger than the source has to give is clamped and said so, rather than
letterboxed or upscaled behind a ✔.

```bash
clawhub install html-shot
```

- **Needs:** Node.js ≥ 20.9 on glibc Linux, macOS, or Windows (no Alpine/musl). First install pulls ~47 MB of deps plus a Chromium that is ~150 MB to download and ~700 MB on disk, cached once per Playwright version.
- **Setup:** [English](skills/html-shot/README.md) · [中文](skills/html-shot/README.zh.md)
- **Reference:** [`SKILL.md`](skills/html-shot/SKILL.md) · starters: [`template.example.html`](skills/html-shot/template.example.html) (og card) · [`icon.example.html`](skills/html-shot/icon.example.html) (transparent icon / mark)

### [wpf-desktop](skills/wpf-desktop/) — WPF desktop apps on .NET

Build, debug and ship a **native** Windows desktop tool (tray utility, portable single-file
`.exe`) in WPF — no web stack involved. Covers which dependencies are worth adding (most are
not), why publish settings belong in a `pubxml` and never the `csproj`, the window behaviour
WPF gets wrong by default (DPI awareness, dark title bar, the white flash on open), and a
tag-triggered GitHub Actions release with SHA256 sums, artifact attestation and winget
submission. The value is the pitfall list written symptom-first, each one field-tested rather
than quoted: layout containers that silently drop controls under long translations, a first
library call that costs ~770 ms of startup, and the probes that turn "sometimes it doesn't
work" into a score you can act on — offscreen screenshot sweeps across languages and DPI,
phase timers, pixel sampling, and driving the UI from outside the process.

```bash
clawhub install wpf-desktop
```

- **Needs:** .NET 10 SDK on Windows; GitHub Actions for the release pipeline.
- **Language:** `SKILL.md` is English; the four reference files behind it are **Chinese**.
  Agents route by the symptom headings either way, but a human who does not read Chinese
  gets the index rather than the write-ups.
- **Reference:** [`SKILL.md`](skills/wpf-desktop/SKILL.md)

### [nextjs-to-tauri](skills/nextjs-to-tauri/) — Next.js 16 → Tauri 2 desktop app

Wrap a client-side Next.js 16 (App Router) app in a thin Tauri 2 native shell — ship a
~3–10 MB desktop/portable `.exe` (vs ~150 MB Electron) with auto-update, system tray,
single-instance, and window-state, built entirely in GitHub Actions (no local Rust). The
value is the hard-won gotchas: the `trailingSlash` white-screen on static export, next-intl
i18n routing, updater signing keys, and cross-platform CI.

```bash
clawhub install nextjs-to-tauri
```

- **Needs:** A static-exportable Next.js 16 app; GitHub Actions for the builds.
- **Reference:** [`SKILL.md`](skills/nextjs-to-tauri/SKILL.md)

### [nextjs-to-electron](skills/nextjs-to-electron/) — Next.js → Electron desktop app

Wrap a client-side Next.js (App Router) static export in a thin Electron shell — for
**fully-offline / intranet** Windows machines that lack the WebView2 runtime, where Tauri
won't launch. Electron ships its own Chromium (~150 MB), so it just runs. `src/` stays
untouched; all desktop behavior (language persistence, window-state, single-instance, system
tray) lives in a passively-wired `electron/` main-process layer. The value is the gotchas:
the `file://` white-screen trap, the custom `app://` protocol, next-intl static-export i18n,
and electron-builder packaging.

```bash
clawhub install nextjs-to-electron
```

- **Needs:** A static-exportable Next.js app; GitHub Actions for the Windows builds.
- **Reference:** [`SKILL.md`](skills/nextjs-to-electron/SKILL.md)

## Repository layout

```
skills/
├── md-web/                # Markdown → shareable web page (S3 + Docsify)
├── deepl-translate-node/  # Confidence-gated DeepL translation fallback
├── html-shot/             # HTML/SVG/URL → og:image, social card, screenshot, favicon/app-icon set
├── wpf-desktop/           # WPF desktop apps on .NET — setup, pitfalls, dev switches, release CI
├── nextjs-to-tauri/       # Next.js 16 → Tauri 2 desktop app migration
└── nextjs-to-electron/    # Next.js → Electron desktop app (offline / no-WebView2)
assets/               # README images — kept out of skills/ so they aren't installed
scripts/              # validate-skills.mjs — the frontmatter and limit checks CI gates publishing on
.github/workflows/    # CI: validates, then auto-publishes changed skills to ClawHub on push
```

## License

[MIT](LICENSE) © rockbenben
