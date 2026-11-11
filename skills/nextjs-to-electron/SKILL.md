---
name: nextjs-to-electron
description: Use when converting a Next.js static export into a Windows Electron desktop app, especially for offline machines without WebView2. Next.js 转 Windows Electron / 将 Next.js 静态导出打包成 exe. Confirm the project supports static export and Windows Electron is the intended target.

metadata:
  version: "1.1.15"
  openclaw:
    homepage: https://github.com/rockbenben/aishort-skills/tree/main/skills/nextjs-to-electron
    emoji: "⚛️"
    requires:
      bins: ["node"]
    files:
      - electron-files.md
---

# Next.js → Electron Desktop App

## Overview

Wrap a **client-side** Next.js (App Router) static export in a thin Electron shell. Electron bundles its own Chromium, so unlike Tauri it needs **no system WebView2** — the reason to pick it for locked-down/intranet machines. Keep the web behavior intact and put shell-specific behavior in `electron/`. Make the source or configuration changes required for a working export.

**Core principle:** Serve the export over a custom `app://` protocol, NOT `file://`. Almost all migration pain is path/origin resolution, not React — and `file://` silently breaks both. (See [electron-files.md](electron-files.md) for all copy-paste code.)

## When to use

- The app is (or can be) a **static export** (`output: "export"`) — diff/format/calculator/viewer tools, no SSR or API-at-runtime.
- **Export prerequisites**: `output: "export"` in `next.config.*`, plus `images.unoptimized: true` when the app uses `next/image` — Next throws at export time otherwise ("Image Optimization using the default loader is not compatible with export"). That is a config line, not a source edit.
- You want a Windows desktop build that runs **fully offline**, especially where WebView2 is absent (LTSC/Server images, air-gapped intranet) so Tauri won't launch.

**Check platform and toolchain compatibility.** Confirm the target Windows version and architecture against the selected Electron release. Use a supported stable Electron line and compatible builder/updater versions from the project's package source; old release asset inventories do not establish current support.

For CI, select a supported Node version that satisfies the build tools' engines. An explicit Active LTS major is a reproducible default; retain a deliberate project pin policy. `engines.node` expresses compatibility, not simply the CI version. See [Electron releases](https://releases.electronjs.org/releases.json) and the [Node schedule](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json).

**Do NOT use when** the app needs a live Node server at runtime (real API routes, SSR, server actions). **Prefer `nextjs-to-tauri`** when the targets have WebView2 and you want a ~3–10 MB exe with auto-update — Electron is ~150 MB because it ships Chromium.

Use this playbook for Next.js static exports; other application types need their own packaging approach.

This playbook targets **Windows** (`--win dir`/`portable`, SmartScreen, WebView2-less boxes). macOS/Linux packaging (`.dmg`/`.AppImage`, notarization, codesigning) is out of scope.

## Procedure

Adapt the following steps to the repository. Full code is in [electron-files.md](electron-files.md). Preserve existing web behavior and make only necessary export or desktop integration changes. Commands use **yarn**; in an npm or pnpm repo substitute the equivalent (`npm ci` for `yarn install --frozen-lockfile`) and match `setup-node`'s `cache:` to the lockfile you actually have — `cache: yarn` fails the job outright when there is no `yarn.lock`.

1. **Confirm the export is client-side and check its shape.** `yarn build`, then `ls out/` — you'll see flat files (`index.html`, `en.html`, `zh.html`) and `_next/`. `trailingSlash: false` (flat files) is fine; the resolver handles both layouts (gotcha #2). If the build stops on the default image loader, that is the `images.unoptimized` prerequisite above — set it and rebuild.

2. **Add the toolchain** (after the version check above): `yarn add -D electron electron-builder`. In `package.json` add `"main": "electron/main.js"` and scripts: `electron:dev` (`node scripts/electron-dev.cjs`, which sets `ELECTRON_DEV=1` and spawns electron), `electron:build` (`next build && electron-builder --win dir`), `test:electron` (list the test files explicitly — `node --test electron/resolvePath.test.js electron/store.test.js …`; choose a glob only when the project Node/shell supports it, gotcha #5). Add `electron/package.json` with `{"type":"commonjs"}` so the shell and its tests also run when the Next.js project's root declares `"type": "module"`.

3. **Create the `electron/` layer** (copy from electron-files.md). Split into **pure modules that must NOT `require("electron")`** (so `node --test` runs them) and Electron-bound ones:
   - `constants.js` — `SCHEME="app"`, `LOCALES[]`. `resolvePath.js` — `resolveAssetPath(outDir, pathname, exists)` with `.html`→`/index.html`→`404.html` fallback. `store.js` — dependency-free JSON store in `userData`. `locale.js` — `startUrl`/`parseLocale`/`trackLocale`. `window-state.js` — `createWindowStateKeeper`. (All pure → unit-tested.)
   - `protocol.js`, `tray.js`, `main.js` — the only files that import electron.

4. **Load via the `app://` protocol, never `file://`** (gotcha #1). Before `app.ready`: `protocol.registerSchemesAsPrivileged([{scheme:"app", privileges:{standard:true, secure:true, supportFetchAPI:true}}])`. After ready: `protocol.handle("app", …)` mapping `app://local/<path>` → `resolveAssetPath` → `net.fetch(pathToFileURL(file))` (with a `.catch` returning a 404 Response). Load `app://local/` + the saved locale.

5. **Wire the sample desktop features in main.js** (passive navigation/window events, gotchas #3, #4): single-instance lock + second-instance focus; restore window bounds from the store; `trackLocale(win, store)` persists locale on `did-navigate`; tray with close-to-tray via an `app.isQuitting` flag.

6. **Package** (gotcha #6). `electron-builder.yml`: `extraResources` maps `out → out` and `build/icon.png → icon.png`; `main.js` reads them at `process.resourcesPath/out` and `/icon.png` when packaged. Choose target: `dir` (unpacked folder — runs `<AppName>.exe` directly, fast) vs `portable` (self-extractor, re-unzips to %TEMP% every launch, slower) — gotcha #11.

7. **CI** (`.github/workflows/electron.yml`): `windows-latest` → setup-node → `yarn install --frozen-lockfile` → `yarn test:electron` → `yarn electron:build` → upload the build as an artifact. The workflow in electron-files.md pins each action to a major (`actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, `softprops/action-gh-release@v3`) and Node to a major — **check those are still current before trusting the template** (actions against their latest release, Node against the official schedule), e.g. `gh api repos/actions/checkout/releases/latest --jq .tag_name`. If desktop code lives on a side branch, tag its exact commit or use the committed source-map variant (gotcha #10). To also attach the build to a GitHub Release — e.g. alongside a Tauri release in the same tag — derive both the version and the zip name from the tag and `gh release upload` it; gotcha #12 lists the traps that silently produce an empty release, and electron-files.md describes the two-app variant in prose rather than as a template.

8. **Verify:** `yarn test:electron` (pure modules), then `yarn electron:build` and run the unpacked `<AppName>.exe`. Verify UI behavior on Windows using the available automation or manual checks: rendering, i18n, persistence and tray lifecycle. A process-launch check alone does not prove those behaviors; test a WebView2-less environment when that is the deployment requirement.

## Gotchas (the non-obvious, hard-won ones)

| # | Gotcha | Fix |
|---|--------|-----|
| 1 | **White screen / unstyled — the `file://` trap.** `win.loadFile("out/index.html")` makes absolute asset paths `/_next/...` resolve to the **filesystem root**, not the app dir → every asset 404s. `loadFile` does NOT rebase absolute paths. (Agents confidently claim it "resolves relative to the file" — it does not.) | Register a custom **`app://` standard+secure** scheme and serve `out/` via `protocol.handle`; `loadURL("app://local/")`. Absolute `/_next/...` then resolve against the protocol origin. Bonus: a stable custom-scheme origin makes `localStorage` (theme/locale via next-themes) persist reliably — `file://` storage behaviour is not something to rely on. |
| 2 | **`trailingSlash:false` → flat files, no directory index.** Pages are `en.html`/`zh.html`, not `en/index.html`; a file/protocol server won't append `.html`. | Resolver fallback, for an extensionless request: `path + ".html"` → `path + "/index.html"` → `404.html` (a request that already has an extension is served if it exists, else `404.html`). Handles both trailingSlash modes. Use exact-segment matching so `zh-hant` isn't swallowed by `zh`. |
| 3 | **Language not remembered across launches.** Static export has **no middleware**, so root `index.html` redirects to the *default* locale every launch — the web app cannot remember. | Persist locale in a **main-process** JSON store; launch with `loadURL("app://local/" + savedLocale)`; capture changes via `webContents.on("did-navigate", …)` parsing the locale segment from the URL. |
| 4 | **Desktop changes break the web build.** | Prefer main-process navigation/window events for passive behavior. Add preload/IPC only for features that need it, expose a narrow API, and guard desktop-only paths so the browser build still works. |
| 5 | **Pure tests import Electron or discover no tests.** | Keep path, locale and store logic independent of Electron-bound modules. The sample lists test files explicitly for shell portability; verify discovery on the project Node/shell before choosing a glob. |
| 6 | **Packaged resource paths must match electron-builder; works in dev, white-screens packaged.** `main.js` uses `process.resourcesPath/out` and `/icon.png` when `app.isPackaged`. | `extraResources` must map `from: out → to: out` and `from: build/icon.png → to: icon.png` so the runtime paths line up. The static export is NOT in the asar — it's real files under `resources/`. |
| 7 | **Web fonts hang offline.** A raw `<link href="fonts.googleapis.com">` fetches at runtime → FOUT/hang on an air-gapped box. | `next/font/google` self-hosts fonts into `_next/static/media` at **build** time (fine offline, as long as the CI build machine has internet). Self-host any other web fonts; never CDN-link them. |
| 8 | **App can never quit / tray icon vanishes.** Close-to-tray that always `preventDefault`s traps the user; a `Tray` with no retained reference is garbage-collected and disappears. | Intercept window `close` → `preventDefault()`+`hide()` **UNLESS `app.isQuitting`**; only the tray "Quit" item sets `app.isQuitting=true` then `app.quit()`. Assign the `Tray` to a variable that outlives setup. |
| 9 | **Relaunch spawns duplicate windows.** | `app.requestSingleInstanceLock()`; `app.quit()` if not primary; on `second-instance` restore/show/focus the existing window. |
| 10 | **`workflow_dispatch` button missing.** GitHub only shows "Run workflow" if the workflow file is on the **default branch**. Keeping the desktop build on a side branch hides the button. | Keep a workflow on the default branch for the manual button. Release builds use the triggering tag commit, or a full source SHA recorded in that tag's source map. Keep a workflow in every commit that can receive a release tag. Keep it separate from any existing Tauri/desktop workflow rather than overwriting it. |
| 11 | **`portable` exe is slow to start; unsigned exe warns.** electron-builder `portable` = a self-extractor that re-unzips to %TEMP% on **every** launch. And any unsigned build trips Windows SmartScreen "unknown publisher". | For intranet, `target: dir` → `win-unpacked/` runs `<AppName>.exe` directly (no per-launch extraction). Distribute the folder (zip for transport; GitHub auto-zips an uploaded folder artifact). SmartScreen needs a code-signing cert to silence — usually acceptable internally. |
| 12 | **Tag workflows build mismatched versions or attach no assets.** | Ensure the tagged commit contains the workflow and trigger. Inject or assert the tag version before building, derive asset names from that version, and upload to the same tag. For multiple apps, use the fixed-source coordinator variant in [electron-files.md](electron-files.md); adapt its draft/publish policy to the repository. |

## Delivery

Provide the runnable Windows package, the shell tests and UI checks actually performed, and any remaining environment limits. Package size depends on Chromium, dependencies and resources; use the generated release assets for exact sizes.
