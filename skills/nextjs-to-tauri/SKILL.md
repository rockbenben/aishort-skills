---
name: nextjs-to-tauri
version: 1.1.6
description: Use when packaging a Next.js 16 App Router app as a Tauri 2 desktop app with static export, auto-update, tray and CI. Triggers on 打包成桌面应用 / 生成 exe.
tags: [tauri, nextjs, desktop, app-router, static-export, auto-update, next-intl, github-actions]
homepage: https://github.com/rockbenben/aishort-skills/tree/main/skills/nextjs-to-tauri

metadata:
  openclaw:
    emoji: "🦀"
    requires:
      bins: ["node"]
    files:
      - tauri-files.md
      - frontend-integration.md
      - desktop-build.yml
---

# Next.js 16 → Tauri 2 Desktop App

## Overview

Wrap a **client-side** Next.js 16 (App Router) app in a thin Tauri 2 native shell. The React code is untouched; Tauri serves the static export from its embedded asset server. Build in GitHub Actions so no local Rust is needed.

**Core principle:** Tauri loads the static export over its own asset protocol — which behaves differently from a real HTTP server. Most migration pain is path/routing resolution, not React.

## When to use

- The app is (or can be) a **static export** (`output: "export"`) — diffing/formatting/calculator/viewer tools, no SSR-at-runtime needed.
- You want a desktop/portable `.exe`, `.dmg`, `.AppImage`, optionally with auto-update.

**Do NOT use when** the app needs a live Node server at runtime (real API routes, SSR, server actions). Tauri can bundle a sidecar server, but that's a different, heavier playbook.

## Procedure

Do these in order. Copy-paste templates live in the supporting files.

1. **Verify latest versions first** (they drift — never trust the numbers in templates):
   - npm: `npm view @tauri-apps/cli version` (+ `plugin-opener`, `plugin-updater`)
   - crates: `curl -sA x https://crates.io/api/v1/crates/tauri | node -p "JSON.parse(require('fs').readFileSync(0)).crate.max_stable_version"` (repeat for each `tauri-plugin-*`)
   - actions: `gh api repos/actions/checkout/releases/latest --jq .tag_name` (+ `actions/setup-node`, `Swatinem/rust-cache`, `actions/upload-artifact`; `tauri-apps/tauri-action@v1` is the moving major tag — check its README, not the release list)

2. **Gate static export on Tauri** in `next.config.*`, driven by an EXPLICIT build flag rather than Tauri's auto-injected `TAURI_ENV_PLATFORM` (gotcha #1). Merge into your existing config, keeping the `next-intl` plugin wrapper:
   ```ts
   // The NextConfig annotation is load-bearing: spreading `{ output: "export" }` into an
   // un-annotated object literal widens output to `string`, and withNextIntl() then
   // rejects it — `yarn build:tauri` fails type-checking before it ever builds.
   import type { NextConfig } from "next";
   import createNextIntlPlugin from "next-intl/plugin";
   const withNextIntl = createNextIntlPlugin();

   const isDev = process.env.NODE_ENV === "development";
   const isTauri = process.env.TAURI_BUILD === "1"; // set by `yarn build:tauri`

   const nextConfig: NextConfig = {
     // ...your existing config...
     ...(isDev ? {} : { output: "export" }),       // export is build-only (gotcha #2)
     ...(isTauri ? { trailingSlash: true } : {}),   // Tauri-only (gotcha #1)
     images: { unoptimized: true },
   };

   export default withNextIntl(nextConfig);  // keep your existing wrapper(s)
   ```
   Add the flag-setting script (`yarn add -D cross-env`) — tauri.conf's `beforeBuildCommand` runs it, NOT plain `yarn build`:
   ```jsonc
   // package.json → "scripts"
   "build:tauri": "cross-env TAURI_BUILD=1 next build"
   ```

3. **Scaffold** (CLI steps are JS — no Rust needed):
   ```bash
   yarn add -D @tauri-apps/cli@latest
   yarn tauri init --ci --app-name "<app>" --window-title "<Title>" \
     --frontend-dist "../out" --dev-url "http://localhost:3000" \
     --before-dev-command "yarn dev" --before-build-command "yarn build:tauri"
   # The source must be SQUARE (the CLI says "squared PNG or SVG") and 1024x1024 — the
   # generated .icns carries a 1024 layer, so a 512 source is upscaled 2x for macOS.
   yarn tauri icon public/logo.png
   rm -r src-tauri/icons/{android,ios}   # desktop-only; they are directories, hence -r
   ```
   Then **fix `.gitignore`** — see gotcha #3.

4. **Edit `src-tauri/` config & Rust.** Copy from `tauri-files.md`: `tauri.conf.json` (window `url`, updater, `webviewInstallMode`, portable `mainBinaryName`), `Cargo.toml` (plugin deps + release profile), `src/lib.rs` (plugin registration + tray + single-instance), `capabilities/default.json` (permissions).

5. **Frontend integration** (only the features you need). Copy from `frontend-integration.md` into **one `src/app/desktop/` folder** — desktop-only files scattered through `utils/`/`hooks/` get lost (see that file's opening note): external-links util (opener-based), auto-update hook, and — for `next-intl` apps — the remember-language hook. Mount them in one `"use client"` component rendered inside your providers (e.g. antd `<App>`, inside `NextIntlClientProvider`). That component also installs the global external-link interceptor (gotcha #10). Switch locales with plain `router.push` (soft nav works in Tauri — never hard-nav a switch); if you remember the language, guard the launch redirect with a module-level flag (gotcha #11).

6. **Version single-source + CI.** Add `src-tauri/update-version.js` and an `update-version` script (copies `package.json` version into `tauri.conf.json`). Copy `desktop-build.yml` for cross-platform builds, signing, draft release with `latest.json`, and the portable-exe steps.
   - **Make the git tag the single source of truth (the template does this):** on tag push, `npm pkg set version="${GITHUB_REF_NAME#v}"` (guarded `if: github.event_name == 'push'`) runs *before* `update-version`, so installer filenames, the embedded app version and `tagName: v__VERSION__` all equal the tag — you set the version by tagging, never by bumping branches. Do NOT point `tagName` at `github.ref_name` (gotcha #13).
   - **If you skip injection, the pushed git tag MUST equal `package.json` version** (`v3.0.0` ↔ `"version": "3.0.0"`). `tauri-action` expands `__VERSION__` from the app version, and the portable-exe step uploads to `v${APP_VERSION}` — a mismatch silently breaks the portable upload.
   - **Windows is fully covered; macOS/Linux are not signed.** Unsigned `.dmg`/`.app` is blocked by macOS Gatekeeper, and unsigned `.AppImage` triggers warnings. If you ship beyond Windows, add Apple notarization / codesigning secrets — out of scope here.

7. **Auto-update signing keys** (only if shipping updates):
   ```bash
   yarn tauri signer generate --ci -p "" -w src-tauri/app.key -f   # private key — gitignore it, NEVER commit (gotcha #7)
   cat src-tauri/app.key.pub   # paste this base64 into tauri.conf.json plugins.updater.pubkey
   ```
   The CI signing step needs the private key as a repo secret — **without it every signed build fails**. The agent doing the migration usually can't set repo secrets, so it MUST **remind the user to run this (or set it in the GitHub UI)**:
   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY < src-tauri/app.key   # bash / Git Bash
   # only if you generated the key WITH a password (not `-p ""`):
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
   ```
   **PowerShell** has no `<` redirection — pipe instead:
   ```powershell
   Get-Content src-tauri/app.key -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY
   ```
   Manual path: repo → Settings → Secrets and variables → Actions → New repository secret.

8. **Verify** (without Rust): `yarn build:tauri`, then confirm the export shape:
   ```bash
   ls out/en/index.html   # MUST exist (not out/en.html) — proves trailingSlash worked
   ```
   The Rust shell (tray/single-instance API) only compiles in CI — flag that you can't compile it locally and let the first Actions run validate it.

## Handoff — remind the user (manual, easy to forget, fail silently)

The code migration is done by the agent; these steps need the human and break things quietly if skipped. **After migrating, surface them explicitly:**

1. **Set the signing secret** before the first build — bash: `gh secret set TAURI_SIGNING_PRIVATE_KEY < src-tauri/app.key`; PowerShell: `Get-Content src-tauri/app.key -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY`; or the GitHub UI. Without it, CI signing fails (step 7).
2. **Publish (un-draft) the first release** — builds produce a *draft*; the updater resolves `releases/latest`, which ignores drafts, so updates never reach anyone until you un-draft it (gotcha #6).
3. **Tag from a default-branch commit that already contains the corrected workflow** — a tag-triggered run uses the workflow from the *tagged commit*, not the branch tip (gotcha #13). If you removed the template's tag-injection step, keep `package.json` equal to the pushed `v*` tag (step 6).

## Gotchas (the non-obvious, hard-won ones)

| # | Gotcha | Fix |
|---|--------|-----|
| 1 | **White screen / flat files.** Static export puts `/en` at `en.html` + an `en/` dir of RSC data; Tauri's asset server serves a directory's `index.html` but does **not** append `.html` to extensionless paths. | `trailingSlash: true` (Tauri builds only) → emits `en/index.html`, resolved by directory-index. **Gate it with an explicit `TAURI_BUILD` flag (`yarn build:tauri`) rather than the auto-injected `TAURI_ENV_PLATFORM`.** That variable is real and the CLI does set it for `beforeBuildCommand`, so this is not a bug workaround — it is that the flag names the intent and lives in the script you run, which keeps the difference between the web build and the Tauri build visible in `package.json` instead of hiding in an env var the reader has to know about. Set window `url: "/en/"` as a safe entry; don't rely on the root `/`→`/en` redirect (emitted without a trailing slash, 404s in Tauri). |
| 2 | **`output: "export"` + middleware is forbidden in Next 16 — even in dev.** `next-intl` ships middleware (`proxy.ts`/`middleware.ts`). Setting `output` in dev silently kills locale redirects. | Make `output` build-only (`isDev ? {} : {...}`). |
| 3 | **`src-tauri/` vanishes from `git status`.** Some repo `.gitignore`s have a bare `src-tauri` line. | Replace with `src-tauri/target` + `src-tauri/gen/schemas`. Verify: `git check-ignore src-tauri/tauri.conf.json` returns nothing. |
| 4 | **`isTauri()` false positives** if you detect by dynamic-importing `@tauri-apps/api`. It imports fine in a plain browser; `invoke` only throws at call time. | Detect via runtime globals: `window.__TAURI_INTERNALS__` / `__TAURI__` / UA contains `Tauri`. Same bundle ships to web + desktop. |
| 5 | **Single-instance plugin must be registered FIRST**, before all other plugins, or second-launch refocus won't route. Desktop-only (target-gate it off mobile). | See `lib.rs` ordering in `tauri-files.md`. |
| 6 | **Auto-update never reaches clients** though CI "succeeds." The updater endpoint resolves `releases/latest`, which **ignores draft and prerelease** releases. | Builds publish a draft; you must manually un-draft to roll out. Document this in the workflow. Note the order this forces on re-runs: `tauri-action@v1` **fails** when `releaseDraft: true` but the release it finds is already published, so re-running a tag you have un-drafted needs the release deleted first (v0 carried on silently). |
| 7 | **Committing the private signing key** lets anyone sign malicious auto-updates your clients auto-trust. The `.pub` is public/safe; the bare key is not. | `.gitignore` the private key; store it only as a GitHub secret. If one ever lands in git history, rotate it. |
| 8 | **Portable "green" exe + auto-update are incompatible.** `update.install()` expects an installed-app layout; on a standalone exe it fails/no-ops. The portable exe also needs the **WebView2** runtime (preinstalled Win 11 / current Win 10; absent on old LTSC/Server). | It's the raw `target/release/<mainBinaryName>.exe` (web assets compiled in). Ship it for convenience, but document "no self-update" and the WebView2 dependency. `install()` **rejects** here, so the hook's `onOk` must await it inside a `try/catch` and say so in the UI — without that the user confirms an install and nothing visibly happens. You can't cleanly detect "am I portable?" at runtime — it's the *same* compiled binary as the one inside the installers — so to truly hide the update prompt you'd produce a separate build with the updater plugin disabled. |
| 9 | **System-language autodetect is unreliable on macOS/Linux.** `navigator.language` in WKWebView/WebKitGTK can be `en-US` regardless of OS. Also `lang.split("-")[0]` can yield an unsupported locale. | Treat saved preference as source of truth; validate the detected locale against your locale list (`validLocales.includes(...)`) before using/saving it. |
| 10 | **External links open inside the app webview**, hijacking the tool; or `openUrl` does nothing at all. | One capture-phase `document` click delegate routes external http(s)/`mailto`/`tel` through `@tauri-apps/plugin-opener`'s `openUrl` (not shell); same-origin links fall through to the router. **Capability must be `opener:default`** — bare `opener:allow-open-url` has no URL scope, so the call is denied at runtime and nothing opens. `opener:default` bundles `allow-open-url` + `allow-default-urls` (http/https/mailto/tel). |
| 11 | **Language switching looks broken / bounces back to one locale.** Two self-inflicted causes: (a) hard-navigating a switch, and (b) a startup "remember-language" redirect guarded by a `useRef`. A locale switch **remounts the `[locale]` layout subtree**, so a hard reload re-resolves paths AND a `useRef` guard resets → the redirect re-fires and bounces every switch. | **Switch with plain `router.push` (soft nav) — it works in Tauri; never hard-nav a switch.** If you redirect to a remembered locale at launch, guard it with a **MODULE-LEVEL flag (not `useRef`)** so it fires once per session, use a **soft** `router.replace`, and save the preference **in the switcher**, not a navigation effect. If the switcher is a file you cannot edit (a vendored or upstream-synced component), the effect-based variant does work, on one condition: **the first pass must not persist anything**. On that pass the current locale is the window's configured entry URL, not the user's preference, so writing it overwrites the stored choice with the entry locale and the app can never return to it. Persist only on the passes after the redirect has fired. |
| 12 | **App aborts or shows a blank window on some Linux desktops** (Xfce, VMs, hybrid/NVIDIA, and especially rolling distros — Manjaro/Arch/CachyOS) with `Could not create surfaceless EGL display: EGL_BAD_ALLOC. Aborting...` (the `xapp-gtk3-module` / `atk-bridge` lines around it are harmless noise). Not gotcha #1: EGL errors are present, and Windows renders fine. Two *different* layers fail with near-identical output. **The decisive tell: does the EGL line disappear once `WEBKIT_DISABLE_DMABUF_RENDERER=1` is actually in effect?** Yes → **layer A**, WebKit's DMABUF renderer. No — it persists whatever `WEBKIT_*` you set → **layer B**, below WebKit: the AppImage's bundled `libwayland-*.so` clashes with the host's newer Mesa/libEGL and the process aborts before WebKit reads any env var. Stop adding `WEBKIT_*` vars at that point. | **Layer A:** set `WEBKIT_DISABLE_DMABUF_RENDERER=1` at the very top of `run()`, before `Builder::default()`, `#[cfg(target_os = "linux")]` and only if unset. It disables GPU-buffer *sharing* only — still accelerated, near-zero cost. Do **not** bake in `WEBKIT_DISABLE_COMPOSITING_MODE=1`: that forces software rendering, only helps a genuine GL-compositing failure, and cannot fix layer B. **Layer B:** confirm by stripping the bundled libs — `./App.AppImage --appimage-extract && find squashfs-root -name 'libwayland-*.so*' -delete && ./squashfs-root/AppRun` — if it paints, it is layer B. Fix: at the top of `run()` (before the WEBKIT block), when `APPIMAGE` is set, find the host `libwayland-client.so.0` (`/usr/lib/x86_64-linux-gnu/`, `/usr/lib64/`, `/usr/lib/`), prepend it to `LD_PRELOAD` and `exec()` self **once** (sentinel env var against a loop), so the loader overrides the stale bundled copy — the ecosystem norm (yaak, tolaria). Alternative: strip the four `libwayland-*` libs from the AppImage in CI. Code in `tauri-files.md` `lib.rs`. Refs: [tauri #9394](https://github.com/tauri-apps/tauri/issues/9394), [espressif/idf-im-ui #755](https://github.com/espressif/idf-im-ui/issues/755), [tolaria fix](https://github.com/refactoringhq/tolaria/commit/8c286a4856637d662f05428f679faa4aee607c66). |
| 13 | **A CI fix on `main` doesn't apply to the release; or the release comes out empty / with mismatched installers.** Tag-triggered runs execute the workflow definition **from the tagged commit**, not the branch tip — tag a commit whose history predates your fix and the *old* workflow runs (or a newly-added `push: tags` trigger never fires at all). Separately, pointing `tagName` at `github.ref_name` ships a release *named* `v3.0.1` containing `..._3.0.0_...` installers, because installer names + embedded version come from `tauri.conf.json`, not `tagName` (and on `workflow_dispatch`, `github.ref_name` is a branch name). | Cut the `v*` tag from a commit that already contains the corrected workflow. To rescue a broken/empty release, re-tag after fixing: `gh release delete vX --yes; git push origin :refs/tags/vX; git tag vX <fixed-commit>; git push origin vX`. For version coherence, inject the tag into `package.json` at build time (step 6), don't fiddle with `tagName`. **Multi-app "release hub"** (one tag on `main` fans out to Tauri + Electron, each workflow pinning `checkout … ref: <feature-branch>` to build that app's code): keep the workflows **only on `main`** and trigger from there — duplicate copies on feature branches drift out of sync and mislead, since the feature-branch copy is never what a tag runs. |

## What to expect

A typical multi-locale next-intl tool migrates in a single branch: React untouched, a ~3–10 MB exe (vs ~150 MB for Electron), fully offline, CI-only builds across Windows/macOS/Linux plus a portable exe. The frontend build verifies locally; Rust compiles in CI.
