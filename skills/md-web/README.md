# MD Web

Turn any content into a web page with a shareable URL. Uploads Markdown to an S3-compatible storage bucket, rendered by Docsify.

[中文文档](README.zh.md)

## Installation

Pick whichever matches your agent / CLI:

```bash
# ClawHub / OpenClaw
clawhub install md-web

# skills.sh (Vercel skills CLI — Claude Code, Cursor, and more)
npx skills@1.7.2 add rockbenben/aishort-skills
```

Pin the CLI version as shown. An unpinned `npx skills add …` resolves whatever the
registry serves at install time, so the installer you review is not the installer that
runs.

Or install manually — clone this repo and copy (or symlink) the `skills/md-web/` folder
into the skills directory your agent reads from. A single folder named `md-web` is all
it needs; use whichever path your agent documents.

## Quick Start

1. Install the skill (see above)
2. On first use, the AI will guide you through bucket configuration
3. The AI then provisions the viewer once — a separate step that writes the page shell to
   your bucket, and again after any upgrade of the skill
4. After that, tell the AI "share as a link" whenever you want to publish content as a web page

## Bucket Setup

This skill requires an **S3-compatible object storage bucket** with public access enabled. The example below uses Cloudflare R2.

### Step 1: Create a Bucket

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Select **R2 Object Storage** from the left menu
3. Click **Create bucket**, enter a name (e.g., `md-web`), use the default region
4. After creation, go to the bucket's **Settings** page
5. Find **Public Access**, click **Allow Access**, enable the **R2.dev subdomain**
6. Once enabled, a public URL will appear: `https://pub-XXXX.r2.dev`
   → This is the **public_url** in the config

### Step 2: Create an API Token

1. On the R2 page, click **Manage R2 API Tokens**
2. Click **Create API Token**
3. Set permissions to **Object Read & Write** (or **Admin Read & Write** only if you set `expire_days`, which manages a bucket lifecycle rule — see below)
4. Optionally restrict scope to the specific bucket
5. After creation, you'll see:
   - **Access Key ID** → **access_key** in the config
   - **Secret Access Key** → **secret_key** in the config
   - **S3 Endpoint** in the format `https://ACCOUNT_ID.r2.cloudflarestorage.com`
     → Remove `https://`, the rest is the **endpoint**

### Step 3: Tell the AI

On first use, the AI will ask for these fields:

| Field       | Required | Description                                                               | Example                               |
| ----------- | -------- | ------------------------------------------------------------------------- | ------------------------------------- |
| access_key  | Yes      | API access key ID                                                         | `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4`    |
| secret_key  | Yes      | API secret access key                                                     | `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6...` |
| endpoint    | Yes      | S3 endpoint (without `https://`)                                          | `ACCOUNT_ID.r2.cloudflarestorage.com` |
| bucket      | Yes      | Bucket name                                                               | `md-web`                              |
| public_url  | Yes      | Public access URL (custom domain recommended)                             | `https://pub-XXXX.r2.dev`             |
| region      | No       | S3 region (`auto` for R2, actual region for AWS S3, e.g., `us-east-1`)   | `auto`                                |
| expire_days | No       | Auto-delete uploaded files after N days. Unset = this skill never touches the bucket's lifecycle (default) | `30` |

> **Tip**: R2.dev URLs have rate limits. For production use, bind a custom domain to your bucket and use that as `public_url`.

The AI will automatically save these to `~/.md-web/config.json`. No repeat setup needed.

Prefer not to keep a long-lived secret in a file? Leave `access_key` and `secret_key` out
of the config and set `MD_WEB_ACCESS_KEY` / `MD_WEB_SECRET_KEY` in the environment
instead. The config file wins when both are set, so an existing setup keeps working.

## Usage

Uploaded content is **publicly accessible** via the generated URL. The skill only runs when you explicitly ask for it, and the AI tells you the link is public before it uploads anything:

```text
show as a web page
publish this online
/md-web path/to/file.md
share as a link
```

The AI returns a link — click to view the rendered document in your browser.

> **Note**: Markdown image references (e.g., `![](image.png)`) are not uploaded — only the `.md` file itself. Use absolute image URLs if your document includes images.

## Auto-expiry (`expire_days`)

Left unset, this skill never sends a bucket-level request — an **Object Read & Write**
token is all you need, and your bucket's lifecycle configuration is untouched.

Set a number of days and the skill maintains exactly one rule, scoped to the `md-web/`
key prefix; set `0` and it removes that rule again. Either way the viewer files at the
bucket root and any unrelated object are never touched, and **rules you set yourself are
preserved**: the script reads the bucket's lifecycle configuration, drops only its own
rule, and writes the rest back unchanged.

Managing it needs an **Admin Read & Write** token. With a narrower token the upload
still succeeds and a warning goes by in the output — set the rule in the dashboard
instead. Re-run the one-time setup step after changing it.

## Security

- **Anything you upload is publicly accessible** at the returned URL, and publishing cannot be undone — never upload secrets, API keys, PII, or other sensitive content.
- Credentials live in **plaintext** in `~/.md-web/config.json`, or in `MD_WEB_ACCESS_KEY` / `MD_WEB_SECRET_KEY` if you prefer to keep them out of a file. On macOS and Linux the script tightens the config file to owner-only access; protect it either way — don't commit it or share it.
- **Use a dedicated bucket.** Uploads and any expiry rule are namespaced under `md-web/`, but a dedicated bucket keeps this skill's bucket-administration rights away from anything you actually care about.
- **The viewer renders your Markdown as HTML**, so `<details>` blocks, alignment and inline images work. Two things keep that safe: a route guard that only loads same-origin paths under `md-web/` (a crafted link cannot make the viewer fetch a document from another origin), and a Content-Security-Policy without `'unsafe-inline'`, so HTML inside a document cannot run script. Treat the domain as public either way.

## File Structure

```yaml
md-web/                     # Skill directory (managed by ClawHub, may be replaced on upgrade)
├── SKILL.md              # AI instruction file
├── upload.js             # Upload script (pure Node.js, zero dependencies)
├── README.md             # This document
├── README.zh.md          # Chinese documentation
└── docsify-server/       # Viewer files (uploaded by the one-time setup step)
    ├── index.html
    ├── README.md
    ├── .nojekyll
    └── assets/           # JS/CSS assets (bundled locally, no CDN dependency)
        ├── config.js     # Viewer configuration + document-route guard
        ├── docsify.min.js
        ├── vue.css
        └── ...

~/.md-web/                  # User data directory (preserved across upgrades)
├── config.json           # Bucket credentials & settings (created on first use)
└── .deployed             # Deploy fingerprint (tracks server deployment state)
```

`.nojekyll` never reaches an installed copy: ClawHub's publish bundle skips every dot-named file, so it exists only in a working checkout of this repo. `upload.js` hashes the whole `docsify-server/` directory to build the fingerprint in `.deployed`, which means a checkout and an install produce different fingerprints — so switching between the two means running the setup step once more. Nothing is lost by it: `.nojekyll` only matters to GitHub Pages, and this skill publishes to R2 or another S3-compatible bucket.

## Other S3-Compatible Services

Besides Cloudflare R2, this skill works with any S3-compatible object storage:

- **AWS S3**: endpoint is `s3.REGION.amazonaws.com`
- **Backblaze B2**: endpoint is `s3.REGION.backblazeb2.com`
- **DigitalOcean Spaces**: endpoint is `REGION.digitaloceanspaces.com`
- **Wasabi**: endpoint is `s3.REGION.wasabisys.com`
- **Tencent Cloud COS**: endpoint is `cos.REGION.myqcloud.com`

Any service that provides an S3-compatible API and a public access URL will work.
