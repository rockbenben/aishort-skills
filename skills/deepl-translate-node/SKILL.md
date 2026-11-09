---
name: deepl-translate-node
version: 1.1.10
description: Use when translating text and the result has to be right — proper nouns, legal/medical/technical terms, idioms, distant language pairs. 用 DeepL 翻译 / 翻译这段.

metadata:
  openclaw:
    homepage: https://github.com/rockbenben/aishort-skills/tree/main/skills/deepl-translate-node
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

**The text leaves your machine.** Whatever you pass to `translate.mjs` is sent over
HTTPS to DeepL's servers and handled under their terms — nothing is translated
locally. Do not paste secrets, credentials, private keys, or text that is covered by
an NDA, a medical/financial duty, or a data-processing agreement without the user's
explicit go-ahead.

**What this touches:** runs `node` locally, reads `DEEPL_API_KEY` (and optionally
`DEEPL_API_HOST`) from the environment, makes one HTTPS request to the configured
DeepL host, and prints the translation to stdout. It writes no files, spawns no
other process, keeps no state between runs, reads nothing outside this skill
directory, and contacts no host other than that DeepL endpoint.

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

Both blocks edit your own shell profile, and you run them, not the skill. The
skill writes nothing to disk, installs no startup entry, and remembers nothing
between runs — a key that is not in the environment is simply missing.

Verify in a fresh shell: `echo $DEEPL_API_KEY` (bash) / `$env:DEEPL_API_KEY` (PowerShell).

If `DEEPL_API_KEY` is unset, stop and tell the user to set it — do not invent a key.

## How to call it

Use the bundled Node helper (cross-platform, Node 18+). `--source` is optional;
omit it to let DeepL auto-detect. `--text` also answers to `-t`, and `--target`/`--source`
to `--target-lang`/`--source-lang`. Every flag takes its value either as the next argument
or after an `=` — the `=` form is the one that can carry text beginning with `--`.

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

These cover the usual work without a round trip. They are a starting list, not a gate: a
language missing here is still probably supported, so query the endpoint below rather than
deciding it cannot be done and translating it yourself.

- **Core (source + target):** `AR BG CS DA DE EL EN ES ET FI FR HU ID IT JA KO LT
  LV NB NL PL PT RO RU SK SL SV TR UK ZH`
- **Extended (among ~100, incl. many low-resource ones):** `AF BN FA HE HI HR
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
`Authorization: DeepL-Auth-Key <key>` header (the other `resource` values:
`translate_document`, `voice`, `write`, `glossary`, `style_rules`, plus `translation_memory` —
the API reference lists that seventh value, the getting-started guide's table does not). Each
entry carries `usable_as_source` and `usable_as_target` separately, so one call tells you both
directions. Or see
https://developers.deepl.com/docs/resources/supported-languages

**Do not treat any listing as the gate.** `/v2/languages?type=target` does not list `EN`, `PT`
or `YUE` as targets, yet `/v2/translate` accepts all three and translates into them; v3 lists
more languages than v2 and reports `en`/`pt` as usable targets, agreeing with the behaviour. So
a code missing from a listing is not evidence of no support — if it matters, make the call and
read the error. A code DeepL really rejects comes back as
`ERROR: DeepL request failed: HTTP 400 — {"message":"Bad request. Reason: Value for 'target_lang' not supported."}`
(the script prints DeepL's error body verbatim, trimmed to 300 characters). The message names
the field rather than echoing the code, so it tells you the language was the problem and
clears the text.

Two traps in the official docs, both hit while checking this text against the live API: the
example response in the v3 API reference shows `en` as `usable_as_target: false`, while the
live endpoint returns `true` — the example is illustrative, the flags are not; and the error
guide says not to match on message strings, so branch on the HTTP status, not on the wording.

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
list. It is a literal find-and-replace run over **DeepL's output**, case-sensitively and
substring-wide — `API=接口` also rewrites `APIs` — so keep terms unambiguous and long enough
not to collide, and a term cannot contain `;`. Whitespace around a term is trimmed. A pair
with no `=` is skipped with a `WARNING:` line on stderr rather than quietly doing nothing —
the translation still arrives on stdout, so a caller capturing it is unaffected.
For real glossary support DeepL has a Glossary
API; ask the user if they need it and we can extend the script.

## Notes

- The script does not track quota; a `456` response means a usage limit was hit — the
  character quota for the billing period, a Cost Control or key-level limit, or the number of
  glossaries the plan allows. Which one it is depends on the account, so read it from the
  DeepL console rather than from here.
- `403` means a bad/missing key, or a key without the permission scope for this endpoint.
- A timeout means the host accepted the connection but never replied — a
  network/reachability problem, not a bad key or bad input. Retrying immediately
  usually reproduces it.
- For DeepL **Pro**, set `DEEPL_API_HOST=api.deepl.com` (default is `api-free.deepl.com`).
