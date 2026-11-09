---
name: md-web
version: 1.3.2
description: Publish Markdown as a web page via the user's own S3 bucket, rendered by Docsify; returns a shareable link. It also provisions the viewer files at the bucket root (a separate --setup command) and can optionally auto-delete uploads after N days (expire_days), and it reads ~/.md-web/config.json for credentials. Use only when the user asks for a web page, online preview, published page or share link (做成网页 / 生成网页链接 / 分享为链接 / 发布到网上 / /md-web).

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

## What this touches

The complete list of what this skill does. Nothing outside it happens.

- **Publish** writes **exactly one object**: `md-web/<timestamp>-<slug>-<suffix>.md`, under the `md-web/` prefix of the configured bucket. It writes nothing else and deletes nothing.
- **`--setup`** is a **separate command**, never a side effect of publishing. It **overwrites the viewer files at the bucket root** (`index.html`, `README.md`, `assets/`) — shared state that every published link depends on. It is idempotent, and a publish that finds the viewer unprovisioned stops with `SETUP_REQUIRED` instead of provisioning it.
- **`expire_days`** is the only bucket administration here, and it is **off unless the user sets it**. With it set, `--setup` **reads** the bucket's lifecycle configuration and writes back **one rule of its own**, scoped to the `md-web/` prefix; `0` removes that rule again. Every other rule and every bucket-wide setting is preserved. Uploads under that prefix are then **auto-deleted after N days** — the link stops working when they are.
- **Local files:** reads `~/.md-web/config.json` (credentials and bucket settings) and writes `~/.md-web/.deployed` (a deploy fingerprint). A legacy `config.json` next to `upload.js` is copied into `~/.md-web/` on first run and is not read again after that.
- **Nothing else.** No other bucket, no other key prefix, no other skill's files, no startup entry, no scheduled job, no background service, no third-party service, no telemetry.

Scope in one line: it runs `node` locally, reads `~/.md-web/config.json` (or `MD_WEB_ACCESS_KEY` / `MD_WEB_SECRET_KEY`), makes HTTPS requests **only** to the configured S3 endpoint, writes the uploaded `.md` plus the viewer assets, may write one lifecycle rule scoped to the `md-web/` prefix, creates and deletes at most one temporary file, touches no other skill, and installs nothing.

## Ground rules

- **Public.** Anyone with the link can read it, and there is no un-publish step — unless `expire_days` is set, which auto-deletes the uploaded file after N days. Before the first upload in a session, tell the user that in one sentence and wait for a go-ahead, unless their request already asked for a public/shareable link.
- **Ask before every state change, not only the upload.** These three need an explicit go-ahead each time, and none of them may be run on your own initiative: publishing an object under `md-web/` (it becomes public and permanent), running `--setup` (it rewrites the viewer files at the bucket root), and adding, changing or removing `expire_days` (it edits the bucket's retention).
- **Explicit requests only.** "整理一下" or "看看效果" is not a request to publish — answer in chat instead.
- **Check the content first.** If it contains credentials, tokens, private keys, internal URLs or personal data, point it out and get confirmation (or redact) before uploading.
- Upload raw Markdown. Never generate HTML.

## Workflow

### 1. Configuration

Check for `~/.md-web/config.json` (`%USERPROFILE%\.md-web\config.json` on Windows). If it is missing or incomplete, run **First-time configuration** below.

Exception: if it is missing but a legacy `config.json` sits next to `upload.js`, skip the wizard and just upload — the script migrates it (and `.deployed`) to `~/.md-web/` and prints `Config migrated to:`.

### 2. Prepare the file

Use the existing `.md` file, or write the content to a temp file in the **OS temp directory** (`/tmp/` on Linux/macOS; `$TEMP` in Git Bash, `%TEMP%` in cmd).

The temp file is scratch space for this one upload: **delete it as soon as the upload reports success or failure** — do not leave it behind, and do not reuse a path you did not create. Nothing about it survives the session: no path, no content and no reference to it is written anywhere, nothing is installed into a startup path, and this skill schedules no cron job and starts no background service. The only things that outlive the session are the uploaded object in the bucket and `~/.md-web/.deployed`.

Viewer limits — write for them:
- Only the `.md` is uploaded: relative images (`![](a.png)`) break. Use absolute `https://` image URLs.
- GFM, tables, `<details>` and inline HTML render; scripts never run, but inline HTML still becomes live markup in the page — never publish Markdown from an untrusted source (see **Security & privacy**). **Mermaid and LaTeX/KaTeX are not rendered** (shown as code) — use tables, lists or images instead.
- Start with a `# Title`: it becomes the browser tab title. YAML front matter is stripped automatically.

### 3. Publish

```bash
node "{SKILL_DIR}/upload.js" <local-file> <remote-key>
```

- `<remote-key>`: short lowercase ASCII slug describing the content, e.g. `api-docs`, even for Chinese documents. The script slugifies whatever it gets — a key with no ASCII letters or digits collapses to `doc` — prepends a timestamp, appends a short random suffix so two documents published in the same second cannot land on the same object, forces `.md` and stores it under `md-web/`.
- If stderr contains `SETUP_REQUIRED`, **ask the user first** — `--setup` rewrites the viewer files at the bucket root, which every published link depends on — then run the one-time viewer setup and re-run the same publish command:

  ```bash
  node "{SKILL_DIR}/upload.js" --setup
  ```

  Setup writes `index.html`, `README.md` and `assets/` to the bucket root and applies `expire_days`. Both go beyond one document, so get the user's go-ahead before running it, and again before adding, changing or removing `expire_days` — that setting edits the bucket's retention. It is idempotent; it is needed on first use, after a skill upgrade, and after changing `bucket` or `endpoint` — those two are what the deploy fingerprint covers, so publish asks for setup again after either. Changing `expire_days` needs a re-run too, but publish will not ask: run it yourself. Changing `public_url` only changes the link that gets printed.
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
4. Write `~/.md-web/config.json` (create the directory; on macOS/Linux the script tightens the file to owner-only access — mode `0600` — as the user who ran it; it never asks for root and never needs elevated privileges):

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

5. Run `--setup`, then publish (step 3). Both need the user's go-ahead first.

## Security & privacy

- Connects only to the user's own S3 endpoint (file content + SigV4 auth headers). No telemetry, no third-party services, no runtime CDN; `upload.js` uses Node.js built-ins only.
- Credentials are stored in plaintext in `~/.md-web/config.json` unless provided via environment variables. Never commit or share that file.
- **No elevated privileges.** The only permission change this skill makes is the script tightening the user's own `~/.md-web/config.json` to owner-only access (mode `0600`) — a user-scoped change to a file in the user's own home directory, made by the script running as that user. It never asks for root, never runs an elevated command, and touches no file outside the home directory and the configured bucket.
- Recommend a dedicated bucket. Uploads and the optional expiry rule are confined to the `md-web/` prefix.
- **The viewer runs the uploaded Markdown as HTML on the page.** GFM, tables, `<details>` and inline HTML all render. The Content-Security-Policy (`script-src 'self'`, without `'unsafe-inline'`) stops a document from *running* script — no inline `<script>`, no `onerror=`, no `javascript:` URL — and the route guard (`docsify-server/assets/config.js`) loads only same-origin paths under `md-web/`. It does **not** stop a document from *inserting elements* into the page. So never publish Markdown that came from an untrusted source, and never let a document carry markup you did not write yourself. Readers must treat the published page as untrusted: anyone who can write to the bucket can put content there.
- **Language.** This skill imposes no language requirement on the document you upload — publish it in the language its content is written in. The skill ships an English `README.md` and a Chinese `README.zh.md`; the reader picks either, and neither is required. The viewer's own chrome is English (`MD Web`, `Search`, `No results found`); the word counter follows the uploaded document's own content. Nothing here translates, rewrites or checks the language of what you upload.
