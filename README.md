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
clawhub install nextjs-to-tauri

# skills.sh — add the whole repo (Claude Code, Cursor, and more)
npx skills add rockbenben/aishort-skills
```

Or clone this repo and copy (or symlink) a skill directory into your agent's skills
folder, e.g. `~/.claude/skills/md-web`.

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

### [nextjs-to-tauri](skills/nextjs-to-tauri/) — Next.js 16 → Tauri 2 desktop app

Wrap a client-side Next.js 16 (App Router) app in a thin Tauri 2 native shell — ship a
~3–10 MB desktop/portable `.exe` (vs ~120 MB Electron) with auto-update, system tray,
single-instance, and window-state, built entirely in GitHub Actions (no local Rust). The
value is the hard-won gotchas: the `trailingSlash` white-screen on static export, next-intl
i18n routing, updater signing keys, and cross-platform CI.

```bash
clawhub install nextjs-to-tauri
```

- **Needs:** A static-exportable Next.js 16 app; GitHub Actions for the builds.
- **Reference:** [`SKILL.md`](skills/nextjs-to-tauri/SKILL.md)

## Repository layout

```
skills/
├── md-web/                # Markdown → shareable web page (S3 + Docsify)
├── deepl-translate-node/  # Confidence-gated DeepL translation fallback
└── nextjs-to-tauri/       # Next.js 16 → Tauri 2 desktop app migration
.github/workflows/    # CI: auto-publishes changed skills to ClawHub on push
```

## License

[MIT](LICENSE) © rockbenben
