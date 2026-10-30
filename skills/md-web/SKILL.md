---
name: md-web
version: 1.3.0
description: Publish Markdown as a web page via the user's own S3 bucket, rendered by Docsify; return a shareable link. Use only when the user asks for a web page, online preview, published page or share link (做成网页 / 生成网页链接 / 分享为链接 / 发布到网上 / /md-web).

metadata:
  openclaw:
    homepage: https://github.com/rockbenben/aishort-skills/tree/main/skills/md-web
    emoji: "🌐"
    requires:
      bins: ["node"]
    envVars:
      - name: MD_WEB_ACCESS_KEY
        required: false
        description: Bucket access key, used instead of access_key in config.json.
      - name: MD_WEB_SECRET_KEY
        required: false
        description: Bucket secret key, used instead of secret_key in config.json.
    files:
      - upload.js
      - "docsify-server/**"
---

# MD Web - Markdown to Web Page

Upload one raw `.md` file to the user's S3-compatible bucket; a Docsify viewer already in that bucket renders it at a public URL. `{SKILL_DIR}` below is this skill's base directory — always keep it quoted.

## Ground rules

- **Public.** Anyone with the link can read it, and there is no un-publish step — unless `expire_days` is set, which auto-deletes the uploaded file after N days. Before the first upload in a session, tell the user that in one sentence and wait for a go-ahead, unless their request already asked for a public/shareable link.
- **Explicit requests only.** "整理一下" or "看看效果" is not a request to publish — answer in chat instead.
- **Check the content first.** If it contains credentials, tokens, private keys, internal URLs or personal data, point it out and get confirmation (or redact) before uploading.
- Upload raw Markdown. Never generate HTML.

## Workflow

### 1. Configuration

Check for `~/.md-web/config.json` (`%USERPROFILE%\.md-web\config.json` on Windows). If it is missing or incomplete, run **First-time configuration** below.

Exception: if it is missing but a legacy `config.json` sits next to `upload.js`, skip the wizard and just upload — the script migrates it (and `.deployed`) to `~/.md-web/` and prints `Config migrated to:`.

### 2. Prepare the file

Use the existing `.md` file, or write the content to a temp file (`/tmp/` on Linux/macOS; `$TEMP` in Git Bash, `%TEMP%` in cmd). Delete temp files you created after the upload.

Viewer limits — write for them:
- Only the `.md` is uploaded: relative images (`![](a.png)`) break. Use absolute `https://` image URLs.
- GFM, tables, `<details>` and inline HTML render; scripts never run. **Mermaid and LaTeX/KaTeX are not rendered** (shown as code) — use tables, lists or images instead.
- Start with a `# Title`: it becomes the browser tab title. YAML front matter is stripped automatically.

### 3. Publish

```bash
node "{SKILL_DIR}/upload.js" <local-file> <remote-key>
```

- `<remote-key>`: short lowercase ASCII slug describing the content, e.g. `api-docs`, even for Chinese documents. The script slugifies whatever it gets — a key with no ASCII letters or digits collapses to `doc` — prepends a timestamp, appends a short random suffix so two documents published in the same second cannot land on the same object, forces `.md` and stores it under `md-web/`.
- If stderr contains `SETUP_REQUIRED`, run the one-time viewer setup, then re-run the same publish command:

  ```bash
  node "{SKILL_DIR}/upload.js" --setup
  ```

  Setup writes `index.html`, `README.md` and `assets/` to the bucket root and applies `expire_days`. It is idempotent; it is needed on first use, after a skill upgrade, and after changing `bucket` or `endpoint` — those two are what the deploy fingerprint covers, so publish asks for setup again after either. Changing `expire_days` needs a re-run too, but publish will not ask: run it yourself. Changing `public_url` only changes the link that gets printed.
- `Warning: lifecycle —` during setup means the bucket lifecycle could not be read or written — usually the token lacks **Admin Read & Write**. The viewer still works; tell the user to grant that permission and re-run setup, or set the rule in the provider dashboard.
- Re-publishing creates a **new** link; the old one stays live.

### 4. Reply

- **Success:** the last stdout line is the URL. Reply with the document name and the clickable link only — do not paste the Markdown into chat. Example: `api-docs` — https://pub-xxxx.r2.dev/index.html#/md-web/20260305-091500-api-docs-4f2a
- **Failure** (non-zero exit, `UPLOAD_FAILED` / `CONFIG_MISSING` / `CONFIG_INVALID` / `Missing config fields`): report the error in one line with the likely fix (table below), then deliver the content in chat.

| Error contains | Likely cause |
|---|---|
| `SignatureDoesNotMatch`, `InvalidAccessKeyId` | Wrong keys, or wrong `region` (`auto` for R2; the real region for AWS) |
| `AccessDenied` on upload | Token lacks Object Read & Write, or is scoped to another bucket |
| `NoSuchBucket` | Typo in `bucket`, or endpoint of another account |
| `ENOTFOUND`, `CONFIG_INVALID` | `endpoint` must be a bare hostname; `public_url` must start with `https://` |
| `Missing config fields` | `config.json` is incomplete — fill in the fields it lists, or set `MD_WEB_ACCESS_KEY` / `MD_WEB_SECRET_KEY` for the two keys |
| Link opens the "Looking for a document?" page | Document expired (`expire_days`) or `public_url` points to another bucket |

## First-time configuration

1. Explain that the skill needs an S3-compatible bucket with public read access. Setup guide: `{SKILL_DIR}/README.md` (Chinese: `{SKILL_DIR}/README.zh.md`) — Cloudflare R2 step by step, plus AWS S3, B2, Spaces, Wasabi, COS endpoints.
2. Collect the required fields:
   - `access_key`, `secret_key` — API token credentials (**Object Read & Write** is enough)
   - `endpoint` — hostname without `https://`, e.g. `ACCOUNT_ID.r2.cloudflarestorage.com`
   - `bucket`
   - `public_url` — custom domain if bound (recommended; `r2.dev` URLs are rate-limited), else `https://pub-XXXX.r2.dev`

   Secrets should not travel through chat if avoidable: offer that the user writes `config.json` themselves, or omits the two keys and exports `MD_WEB_ACCESS_KEY` / `MD_WEB_SECRET_KEY` instead (the file wins when both are set).
3. Optional: `region` (default `auto`; AWS needs the real region, e.g. `us-east-1`) and `expire_days` (auto-delete uploads after N days; `0` removes the rule). **Omit `expire_days` unless the user asks for auto-expiry** — managing it needs an Admin Read & Write token. The script only edits its own `md-web/`-scoped rule and preserves every other lifecycle rule.
4. Write `~/.md-web/config.json` (create the directory; the script tightens it to `chmod 600` on macOS/Linux):

```json
{
  "access_key": "...",
  "secret_key": "...",
  "endpoint": "ACCOUNT_ID.r2.cloudflarestorage.com",
  "bucket": "md-web",
  "region": "auto",
  "public_url": "https://pub-XXXX.r2.dev"
}
```

5. Run `--setup`, then publish (step 3).

## Security & privacy

- Connects only to the user's own S3 endpoint (file content + SigV4 auth headers). No telemetry, no third-party services, no runtime CDN; `upload.js` uses Node.js built-ins only.
- Credentials are stored in plaintext in `~/.md-web/config.json` unless provided via environment variables. Never commit or share that file.
- Recommend a dedicated bucket. Uploads and the optional expiry rule are confined to the `md-web/` prefix.
- The viewer renders document HTML but is hardened: a route guard (`docsify-server/assets/config.js`) loads only same-origin paths under `md-web/`, and a CSP without `'unsafe-inline'` in `script-src` stops embedded scripts. Still treat the domain as public and untrusted.
