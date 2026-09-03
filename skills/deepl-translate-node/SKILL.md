---
name: deepl-translate-node
version: 1.1.6
description: Use when a translation must be right and you are not sure — proper nouns, legal/medical/technical terms, idioms, distant language pairs. Also 用 DeepL 翻译.
tags: [deepl, translate, translation, i18n, localization, terminology, machine-translation]
homepage: https://github.com/rockbenben/aishort-skills/tree/main/skills/deepl-translate-node

metadata:
  openclaw:
    emoji: "🔤"
    requires:
      bins: ["node"]
      env: ["DEEPL_API_KEY"]
    primaryEnv: DEEPL_API_KEY
    envVars:
      - name: DEEPL_API_HOST
        required: false
        description: Point at api.deepl.com for a Pro key; the Free host is the default.
    files:
      - translate.mjs
---

# DeepL Translate (confidence-gated fallback)

A thin wrapper around the DeepL API. The point of this skill is the
**trigger logic**, not the API call: translate with DeepL when your own translation
might be wrong and being wrong matters.

## When to reach for DeepL instead of translating yourself

Translate it yourself when the text is everyday prose and you are confident. Call
DeepL when **any** of these is true:

- **Proper nouns / brand / product names** that have official localized forms
- **Domain terminology** — legal, medical, financial, technical specs, patents
- **Ambiguous source** where one word maps to several target words and context
  doesn't disambiguate
- **Idioms / fixed expressions** that don't translate literally
- **Low-resource or distant language pairs** where your training signal is thin
- **High-stakes output** — anything the user will publish, sign, or send to a
  third party, where a subtle error is costly
- The user **explicitly asks** for DeepL.

If you're confident and the cost of a minor error is low, just translate directly —
don't burn an API call.

## Prerequisite: API key

The key is read from the `DEEPL_API_KEY` environment variable (never hardcode it).
Default endpoint is the **Free** tier host `api-free.deepl.com`; for Pro, set
`DEEPL_API_HOST=api.deepl.com`.

Set it once:

```bash
# macOS / Linux — add to ~/.bashrc or ~/.zshrc to persist
export DEEPL_API_KEY="your-deepl-auth-key-here"
```

```powershell
# Windows (persistent, user scope) — then open a NEW shell
setx DEEPL_API_KEY "your-deepl-auth-key-here"
```

Verify in a fresh shell: `echo $DEEPL_API_KEY` (bash) / `$env:DEEPL_API_KEY` (PowerShell).

If `DEEPL_API_KEY` is unset, stop and tell the user to set it — do not invent a key.

## How to call it

Use the bundled Node helper (cross-platform, Node 18+). `--source` is optional;
omit it to let DeepL auto-detect. `--text` also answers to `-t`, and `--target`/`--source`
to `--target-lang`/`--source-lang`.

```bash
node "{SKILL_DIR}/translate.mjs" --target ZH \
    --text "The plaintiff filed a motion to compel discovery."
```

With an explicit source language:

```bash
node "{SKILL_DIR}/translate.mjs" --source JA --target EN-US --text "持分会社"
```

The script prints **only the translated text** on stdout, so `$(...)` around it
captures the translation and nothing else. Failures go to **stderr** as one `ERROR:` line
plus a non-zero exit code. Multiple lines /
paragraphs are preserved. The request is capped at 60 s, so a stalled endpoint
(throttled, blackholed, captive portal, dead proxy) prints an `ERROR:` naming the
timeout instead of hanging — never impose your own deadline on top.

## Language codes

DeepL's next-gen model covers far more than the classic ~30 languages. Don't assume a
language is unsupported — check before falling back to a self-translation.

- **Core (source + target):** `AR BG CS DA DE EL EN ES ET FI FR HU ID IT JA KO LT
  LV NB NL PL PT RO RU SK SL SV TR UK ZH`
- **Extended (~100 languages, incl. many low-resource ones):** `AF BN FA HE HI HR
  HY KA ML MR MS MY NE PA SW TA TE TH UR VI YUE ZU` … and many more.
- **Target-only regional variants — prefer these when precision matters:**
  - Chinese: `ZH-HANS` (Simplified), `ZH-HANT` (Traditional) — better than bare `ZH`
  - English: `EN-US`, `EN-GB`
  - Portuguese: `PT-BR`, `PT-PT`
  - Spanish: `ES-419` (Latin American)
  - `FR-CA` (Canadian French), `DE-CH` (Swiss German)

For the authoritative, always-current list, query the **v3** languages endpoint
(`/v2/languages` is superseded). The `resource` query parameter is **required** —
omitting it returns 400:
`GET https://api-free.deepl.com/v3/languages?resource=translate_text` with the
`Authorization: DeepL-Auth-Key <key>` header (other `resource` values:
`translate_document`, `translation_memory`, `voice`, `write`, `glossary`, `style_rules`). It returns one entry
per language with source/target support flags. Or see
https://developers.deepl.com/docs/getting-started/supported-languages

**Endpoint note:** `/v3/languages` returns **BCP 47** codes (`en-US`, `pt-BR`,
`zh-Hant`) while this skill writes them uppercase, but you can feed either straight into a
translate call — `/v2/translate` matches `target_lang` case-insensitively and honours the
regional variant both ways (`zh-Hant` and `ZH-HANT` both return Traditional). Text
translation stays on **`/v2/translate`**: current, not deprecated, and with no v3
equivalent.

## Workflow inside a task

1. You're translating something and hit a passage you're unsure about.
2. Confirm `DEEPL_API_KEY` is set (the script checks and errors clearly if not).
3. Run `translate.mjs` for the uncertain passage (or the whole text).
4. Use DeepL's output. If it conflicts with your own read, surface both to the
   user and explain the discrepancy rather than silently picking one.

## Glossary / terminology consistency (optional)

For repeated terminology, pass `--glossary` as a `term=translation;term=translation`
list and the script will post-process exact matches after DeepL returns. For real
glossary support DeepL has a Glossary API; ask the user if they need it and we can
extend the script.

## Notes

- Free tier: 500,000 chars/month. The script does not track quota; a `456` response
  means quota exhausted.
- `403` means a bad/missing key.
- A timeout means the host accepted the connection but never replied — a
  network/reachability problem, not a bad key or bad input. Retrying immediately
  usually reproduces it.
- For DeepL **Pro**, set `DEEPL_API_HOST=api.deepl.com` (default is `api-free.deepl.com`).
