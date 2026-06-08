# Skills

A collection of agent skills, installable via [ClawHub](https://clawhub.ai), [skills.sh](https://www.skills.sh), or manual clone.

## Skills

| Skill                                      | Description                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [md-web](skills/md-web/)                   | Render a markdown file as a beautiful, shareable web page in the browser (S3-compatible storage + Docsify). |
| [deepl-translate](skills/deepl-translate/) | Confidence-gated DeepL translation fallback for high-stakes or ambiguous text (key via `DEEPL_API_KEY`).    |

## Install

```bash
# ClawHub / OpenClaw
clawhub install md-web
clawhub install deepl-translate

# skills.sh (Vercel skills CLI — Claude Code, Cursor, and more)
npx skills add rockbenben/aishort-skills
```

See each skill's `README.md` / `SKILL.md` for setup and usage details.
