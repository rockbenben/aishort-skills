---
name: md-web
version: 1.2.1
description: Use when markdown should become a shareable web page or link. Uploads to your S3 bucket and the URL is public, so only on request. 做成网页 / 分享为链接.

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

Upload raw `.md` files to an S3-compatible storage bucket, where a pre-deployed Docsify server automatically renders them as web pages. This avoids sending long text in the conversation.

## When to use this skill

**Uploaded content is publicly accessible, and publishing cannot be undone.** Only use this skill when the user explicitly requests it:

- User wants to **show or preview content as a web page** in a browser
- User wants to **generate, export, or publish** content as a web page
- User wants a **shareable link** to content
- User wants output **delivered as a web page** rather than as long text in chat
- User wants to **compile or organize content and present it as a web page**
- User invokes this skill by name (e.g., `/md-web`)

Before the first upload of a session, tell the user the document will be readable by
anyone with the link, and wait for their go-ahead. Publishing to a public URL is not
something to infer from "整理一下" or "看看效果" — if the user did not ask for a web page
or a link, answer in chat instead.

## How to use this skill

### Step 1: Check configuration

Check if `~/.md-web/config.json` exists (cross-platform: use the user's home directory). If it does NOT exist or has empty fields, follow the **Configuration** section below first.

One exception: an older install kept `config.json` in the skill's own directory rather than in the home directory. If `~/.md-web/config.json` is absent but that legacy file is sitting next to `upload.js`, skip the wizard and run the upload — the script copies both it and `.deployed` into `~/.md-web/` and prints `Config migrated to:`. Running the wizard instead would ask the user for credentials that are already on disk.

### Step 2: Prepare the markdown file

Either use an existing `.md` file, or write the content to a temporary file. Choose the temp path based on the current platform (e.g., `/tmp/` on Linux/macOS, `%TEMP%\` on Windows — note Git Bash does not expand `%TEMP%`, so use `$TEMP` there). Use whichever path works in the current shell environment. Delete a temp file you created once the upload reports its URL.

**Only the `.md` file itself is uploaded.** Relative image references (`![](diagram.png)`) will be broken on the page — tell the user to use absolute image URLs for documents that need pictures.

### Step 3: Provision the viewer (once)

```bash
node "{SKILL_DIR}/upload.js" --setup
```

Run this before the first upload on a machine, and again after upgrading the skill —
it is what makes the published links work. It writes the viewer files (`index.html`
and `assets/`) to the bucket root, which is shared state that every published
document depends on, so it is a command of its own rather than something an upload
does on the side. It also applies the `expire_days` setting from `config.json`.

- `{SKILL_DIR}`: the base directory of this skill (shown at the top when skill is loaded). Keep it inside quotes — a skills directory under a path with spaces breaks the shell otherwise.
- Re-run it after the user changes `expire_days`, `bucket` or `public_url`. It is safe to repeat.
- Skip it once `.deployed` in `~/.md-web/` already matches this bucket and these files; the upload command below reports when setup is needed.

### Step 4: Upload via upload.js

```bash
node "{SKILL_DIR}/upload.js" <local-file> <remote-key>
```

- `<remote-key>`: a short **ASCII, lowercase, hyphenated** name with no spaces (e.g., `api-docs.md`, `project-guide.md`) — use this even when the document's own title is Chinese, because the key is what appears in the public URL. A timestamp is prepended automatically to avoid filename collisions, the extension is forced to `.md`, and the object lands under the `md-web/` prefix.
- This writes exactly one object. It refuses to run before Step 3, rather than silently provisioning the site on the way to publishing a document.
- If Step 3 printed a lifecycle warning — `Warning: lifecycle —` — the token lacks Admin Read & Write: grant the permission and re-run `--setup`, or set the rule in the Cloudflare Dashboard.

### Step 5: Return the result

- **On success**: the script prints the URL. Reply with only the filename and clickable link. Do NOT paste the markdown content into the chat.
- **On failure** (non-zero exit code): report the error to the user, then fall back to sending the markdown content as text directly in the chat.

Example success output:
> `api-docs` - https://example.r2.dev/index.html#/md-web/20260305-091500-api-docs

## Configuration

This only needs to happen once. On subsequent runs, `config.json` already exists.

1. Tell the user this skill needs an S3-compatible storage bucket with public access. Point them to `{SKILL_DIR}/README.md` for detailed setup instructions (Cloudflare R2 / AWS S3 / other S3-compatible services), or `{SKILL_DIR}/README.zh.md` when the user works in Chinese — the same document in the other language, with identical steps.
2. Ask the user to provide these 5 required fields:
   - **access_key**: API access key ID
   - **secret_key**: API secret access key
   - **endpoint**: S3 endpoint hostname, without `https://` (e.g., `ACCOUNT_ID.r2.cloudflarestorage.com`)
   - **bucket**: bucket name
   - **public_url**: public access URL. If the user has a custom domain bound to the bucket, use that (e.g., `https://docs.example.com`); otherwise use the default R2.dev URL (e.g., `https://pub-XXXX.r2.dev`). **Recommend custom domain** for production use — R2.dev URLs have rate limits.

   If the user would rather not keep a long-lived secret in a file, say that `access_key` and `secret_key` can be left out of `config.json` and supplied as the `MD_WEB_ACCESS_KEY` / `MD_WEB_SECRET_KEY` environment variables instead — the config file wins when both are set.
3. Ask about optional settings:
   - **region**: S3 region. Use `auto` for Cloudflare R2, or the actual region for AWS S3 (e.g., `us-east-1`). Default is `auto`.
   - **expire_days**: how many days before uploaded markdown files are automatically deleted from the bucket. **Leave it unset to keep this skill out of bucket administration entirely** — the default then needs nothing beyond Object Read & Write, and the script never sends a bucket-level request. Set a number of days to have it maintain a single rule scoped to the `md-web/` key prefix; set `0` to have it remove that rule again. Either way the viewer files at the bucket root and unrelated objects are never touched, and rules the user set themselves are preserved: the script reads the bucket's lifecycle configuration, drops only its own rule, and writes the rest back unchanged. Changing this requires an **Admin Read & Write** token — with a narrower one the script warns and carries on, and the user can set the rule in the Cloudflare Dashboard instead.
4. Write the config to `~/.md-web/config.json` (create the `~/.md-web/` directory if it doesn't exist). Use the user's home directory (`$HOME` on Unix, `%USERPROFILE%` on Windows):

```json
{
  "access_key": "...",
  "secret_key": "...",
  "endpoint": "...",
  "bucket": "...",
  "region": "auto",
  "public_url": "..."
}
```

Omit `expire_days` unless the user actually asked for auto-expiry — writing it in by default would put every user back on a token that needs bucket-admin rights.

5. Then run Step 3 once to provision the viewer, and Step 4 to publish the document.

## Important notes

- Do NOT generate HTML. Just upload the raw `.md` file — Docsify handles rendering.
- Do NOT send markdown content to the chat unless upload fails.

## External endpoints

This skill connects only to the S3 endpoint configured by the user in `config.json`. No data is sent to the skill author or any third-party service.

| Endpoint | Purpose | Data sent |
|----------|---------|-----------|
| User's S3 endpoint (`config.json → endpoint`) | Upload .md files and Docsify server assets | File content, S3 auth headers |

## Security & privacy

- **Anything you upload becomes publicly accessible** at the returned URL, and there is no undo — never upload secrets, credentials, PII, or other sensitive content.
- Credentials go in **plaintext** in `~/.md-web/config.json` (outside the skill directory, safe from upgrades) and are only sent to the user's own S3 endpoint for authentication. If the user would rather not keep a secret in a file, `access_key` and `secret_key` can come from the `MD_WEB_ACCESS_KEY` / `MD_WEB_SECRET_KEY` environment variables instead. Protect the file either way — don't commit it or share it.
- **Use a dedicated bucket.** Uploads live under the `md-web/` key prefix and any rule this skill manages is scoped to that prefix, so viewer files and unrelated objects are never expired. A dedicated bucket is still the clean answer: it keeps this skill's bucket-administration rights away from anything you actually care about.
- **The published viewer renders Markdown from your bucket as raw HTML**, which is what makes `<details>` blocks, alignment and inline images work. It is protected by two things: a route guard (`docsify-server/assets/config.js`) that only ever loads same-origin paths under `md-web/`, so a crafted link cannot make the viewer fetch a document from another origin, and a Content-Security-Policy that keeps `'unsafe-inline'` out of `script-src`, so HTML inside a document cannot run script either. Treat the domain as public and untrusted regardless: it holds documents anyone can publish into your bucket.
- No telemetry, analytics, or data collection by the skill itself.
- `upload.js` uses only Node.js built-in modules and all Docsify assets are bundled locally — no third-party dependencies, no CDN at runtime.

By using this skill, markdown content is uploaded to **your own** S3-compatible storage bucket and made publicly accessible. No data is sent to the skill author or any third-party service. Only install if you trust the storage provider you configure.
