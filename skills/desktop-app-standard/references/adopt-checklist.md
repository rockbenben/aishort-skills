# Adopt checklist — 快照（核验于 2026-10-28，Electron 45.1.0 / Tauri 2.12.5）

> **这是带日期的快照，不是当前事实。** 使用前用 `audit.mjs`（在线）重新核验最新版本和 release notes；
> 版本已前进时，以在线报告的 `changes` / 插件 CHANGELOG 段落为准，并把本文件更新为新的快照。
> 内容取自上游 release notes 原文，每条附 PR 链接，便于复查。

## Toolchain snapshot (2026-10-28)

| Package | npm `latest` | Notes |
|---|---|---|
| `electron` | `45.1.0` | Chromium `156.0.8078.49` · Node `24.22.1` · V8 `15.6`；`engines` >=22.12 |
| `electron-builder` | `26.18.0` | `v26` tag points at `26.18.1`（GitHub 同日发布），`latest` 仍落后一个 patch；`next` 是 27.0.0-alpha，不作为 stable 目标 |
| `electron-updater` | `6.8.11` | `v26` tag points at `6.8.12`；安装以 `latest` 为准，升级时看 `v26` 与 release notes |
| `@electron/rebuild` | `4.2.1` | 用这个包；旧名 `electron-rebuild` 已弃用。electron-builder 26.18.0 已依赖 4.2.1 |
| `@electron-forge/cli` | `8.0.1` | 只给已有 Forge 项目；新应用仍用 electron-builder |
| `@electron/fuses` | `2.1.3` | 可选；启用后要在实际打包产物上验证 |

- 安装从 npm `latest` 取 `electron` / `electron-builder` / `electron-updater`；下 pin 前先跑 `npm view <pkg> dist-tags version engines`。`vNN` 标签可能比 `latest` 早一个 patch；要最新稳定补丁就装 `@vNN`，否则等 `latest` 追平。审计会把 GitHub 更新的 release 标出来。
- 安装后显式跑 `npx install-electron`（Yarn：`yarn run install-electron`）；Electron 42+ 不再有 postinstall 下载。
- 原生模块用 `@electron/rebuild` 按目标架构 rebuild，不要再用 `electron-rebuild`。
- `electron-builder` 留在 26.x stable；`next`（27 alpha）和 `electron-updater` 的 `next`（7 alpha）不用于稳定应用。

## Electron

### v45.0.0 — breaking, act before upgrading

| Change | What it means for your app |
|---|---|
| Sandboxed preload scripts lose the `events`, `timers`, `url` modules and the `Buffer`, `setImmediate`, `clearImmediate` globals | A sandboxed `preload.js` that uses `Buffer` now throws. Polyfill it, or run that preload unsandboxed. ([#54048](https://github.com/electron/electron/pull/54048)) |
| `safeStorage`'s **synchronous** methods are deprecated, removal in Electron 46 | `isEncryptionAvailable`/`encryptString`/`decryptString` still work, but `decryptStringSync` et al. go away next major. Move to the async API now. (No PR link in the release notes.) |
| 32-bit builds removed (Windows `ia32`, Linux `armv7l`) | Only `x64`/`arm64` are published. A 32-bit target is no longer buildable, at any version. ([#51816](https://github.com/electron/electron/pull/51816)) |
| `contentTracing.enableHeapProfiling()` removed | Chromium dropped the memlog backend. Use the `nativeHeapProfiling` option on `contentTracing.startRecording()`. The companion change landed as [#54863](https://github.com/electron/electron/pull/54863). |
| Screen/window/tab capture is reported to `setPermissionRequestHandler` as **`display-capture`**, not `media` | A handler that allows only `media` silently kills screen sharing. Allow both. ([#52824](https://github.com/electron/electron/pull/52824)) |
| `document.requestStorageAccessFor` is disabled by default in Chromium | Restore with the `enableBlinkFeatures: "RequestStorageAccessFor"` web preference — but it is on the way out. |
| ASAR: `fs.open` on a file **inside** the archive no longer extracts a temp copy | The descriptor only identifies the entry; code that reads the raw descriptor (native addons, `child_process` stdio, `net.Socket({fd})`, `respondWithFile()`) fails with `EBADF`. Write flags now fail with `EACCES` instead of silently writing to a temp copy. |
| `window.open()` children whose `sandbox` state differs from the opener now get their **own process**, with no opener relationship | If you rely on sharing an unsandboxed opener's process, set `sandbox: false` in `setWindowOpenHandler`. ([#52472](https://github.com/electron/electron/pull/52472)) |
| `nodeIntegrationInWorker` semantics tightened | A `Worker` created from an `<iframe>` no longer inherits Node integration when the iframe has none. |
| `chrome-extension://` documents no longer receive the window's preload script | Only top-level frames and DevTools front-ends get it; an extension frame in a normal page now follows `nodeIntegrationInSubFrames`. |
| `app.setLoginItemSettings()` — `openAsHidden` removed | Also removed from `app.getLoginItemSettings()`'s return value. ([#52351](https://github.com/electron/electron/pull/52351)) |

### v45.0.0 — new APIs worth adopting

| API | Use it when |
|---|---|
| **Save/Restore Window State API** | You hand-rolled window-bounds persistence. Electron now ships a cross-platform one. ([#51510](https://github.com/electron/electron/pull/51510)) |
| `protocol.registerSource()` (experimental) | You serve a custom scheme from a directory with a JS handler that only reads files. ([#54521](https://github.com/electron/electron/pull/54521)) |
| `ELECTRON_DEBUG_DRAGGABLE_REGIONS` | You built a custom title bar with draggable regions and cannot see them. Unpackaged only. ([#53626](https://github.com/electron/electron/pull/53626)) |
| `app.configureWebAuthn()` | macOS passkeys through iCloud Keychain. ([#51563](https://github.com/electron/electron/pull/51563)) |
| `webFrame.getIsolatedWorlds()` + `isolated-world-created` | You need to discover isolated worlds. ([#50633](https://github.com/electron/electron/pull/50633)) |
| `disableWakeLocks` (WebPreferences) | You want the renderer to stop holding a wake lock. ([#52342](https://github.com/electron/electron/pull/52342)) |
| Windows Error Reporting helper (`electron_wer.dll`) | `crashReporter` misses `__fastfail` crashes on Windows; the WER DLL captures them. ([#53851](https://github.com/electron/electron/pull/53851)) |
| `select-client-certificate` on `net.request` / `net.fetch` | Your server asks for a client certificate; requests used to fail with `ERR_SSL_CLIENT_AUTH_CERT_NEEDED`. ([#52162](https://github.com/electron/electron/pull/52162)) |
| `initiatorOrigin` on webRequest / protocol-handler requests | You need to know which origin initiated a request. ([#53700](https://github.com/electron/electron/pull/53700)) |

### v45.1.0 — current stable (patch line)

| Change | What it means for your app |
|---|---|
| `session.registerPreloadScript` accepts `matches`, `excludeMatches`, `includeGlobs`, `excludeGlobs`, `matchOriginAsFallback` | Scope preload injection by URL/origin instead of registering one broad script. Verify redirect/final-URL behavior in your app. ([#55181](https://github.com/electron/electron/pull/55181)) |
| Chromium `156.0.8078.49`, Node `24.22.1` | Patch-level stack refresh; rebuild native modules and re-run the OS/arch floor checks. |
| ASAR, extension-service-worker and Linux D-Bus fixes | Re-test apps that read packed files through raw fds, load MV3 extensions, or call D-Bus; see the release notes for the exact fixes. ([v45.1.0](https://github.com/electron/electron/releases/tag/v45.1.0)) |

### Also in 45.x (lower-risk features)

- `MenuItem.badge` — macOS 14+ count/custom text next to a menu item. ([#50805](https://github.com/electron/electron/pull/50805))
- `app.setBadgeCount` / `win.setProgressBar` on Linux — works with any dock/taskbar implementing the LauncherEntry D-Bus API; no `libunity`. ([#52739](https://github.com/electron/electron/pull/52739))
- `process.getSystemMemoryInfo().available` on Linux — exposes `MemAvailable`; use it for memory-pressure hints instead of `free`. ([#52299](https://github.com/electron/electron/pull/52299))
- `webFrameMain.printToPDF()` — print an individual frame to PDF from the main process. ([#52439](https://github.com/electron/electron/pull/52439))
- `webContents.caretBrowsingEnabled` — toggle caret browsing for accessibility. ([#52696](https://github.com/electron/electron/pull/52696))

### Preferences at 45.x

- Sandboxed preload no longer has `Buffer`, `events`, `timers`, `url`, `setImmediate`, `clearImmediate`; polyfill or move the work across a contextBridge boundary. Do not disable `sandbox` to fix a missing import.
- `safeStorage` synchronous methods are deprecated in 45 and removed in 46; use the async API and verify the platform backend.
- Screen/window/tab capture is reported as `display-capture`, not `media`; handle both in the permission handler.
- Scope preloads with `session.registerPreloadScript` filters (45.1+) and implement both `setPermissionRequestHandler` and `setPermissionCheckHandler`.

### Electron — standing facts

- **Stack at v45.1.0:** Chromium `156.0.8078.49`, Node `24.22.1`, V8 `15.6.75.19`.
  A major bump moves all three — re-read your `engines` and your native deps.
- **Support window: the latest three majors.** At this snapshot the supported
  majors are 45 / 44 / 43; v45.0.0's `## Notices` section announces "End of
  Support for 42.x.y". 43 drops when 46 ships — that is a deadline for
  shipping patches, not a note.
- **Since Electron 42 the package has no `postinstall`.** The runtime is
  downloaded the first time something runs it, so `npm ci` is fast and
  quiet and the first launch pauses for ~100 MB. In CI run
  `npx install-electron` (Yarn: `yarn run install-electron`) right after install so the download is an explicit,
  cacheable step; `ELECTRON_SKIP_BINARY_DOWNLOAD` no longer exists.
- npm dist-tags: `latest` tracks the current stable major; `45-x-y` tracks the
  45.x patches. For `electron-builder` / `electron-updater`, the repo also
  publishes `v26` (latest 26.x / 6.8.x patch) and `next` (27 / 7 alpha);
  `latest` can lag `v26` by a patch. Check `npm view <pkg> dist-tags` and
  prefer `latest` unless you deliberately need the tagged patch.

---

## Tauri

### v2.12.x — act on these

| Change | What it means for your app |
|---|---|
| `choowHowToInstall` → `chooseHowToInstall` (NSIS language string) | A custom language file in `bundle.windows.nsis.customLanguageFiles` that defines the old (misspelled) name still works — for now. Migrate. ([#16333](https://github.com/tauri-apps/tauri/pull/16333)) |
| NSIS installers no longer block downgrades over a newer MSI installation in silent / passive / update modes | `bundle.windows.allowDowngrades: false` now applies across installer types, not just NSIS-vs-NSIS. ([#16254](https://github.com/tauri-apps/tauri/pull/16254)) |
| `macos-private-api` / `macOSPrivateAPI` no longer required for transparency or fullscreen on macOS | You can drop the flag from `tauri.conf.json` and the Cargo feature. ([#16166](https://github.com/tauri-apps/tauri/pull/16166)) |
| `process::restart` / `AppHandle::restart` on macOS relaunches through LaunchServices (`open -n`) | The new instance no longer inherits the exiting process's stdio and process group — which used to crash it on its first print when the original stdout reader was gone. ([#15783](https://github.com/tauri-apps/tauri/pull/15783)) |
| `asset://` files load asynchronously instead of on the event loop | A slow or unreachable path no longer freezes every window. ([#16050](https://github.com/tauri-apps/tauri/pull/16050)) |
| Rust-side `listen` / `once` handlers are removed when the window or webview is destroyed | `Window`, `Webview` and `WebviewWindow` listeners no longer leak after close. ([#15617](https://github.com/tauri-apps/tauri/pull/15617)) |
| Runtime capabilities (`add_capability`, feature `dynamic-acl`) no longer pollute the build-time ACL | Scope values are no longer duplicated when a scoped permission allows more than one command. ([#15291](https://github.com/tauri-apps/tauri/pull/15291)) |
| `Menu` creation no longer takes `MenuItemOptions` with `action` directly | Update menu construction code. ([#16231](https://github.com/tauri-apps/tauri/pull/16231)) |
| Security: channel-data IPC queue entries are bound to their webview | A fix, not a break — but it is the kind of cross-webview leak worth having. |
| Android `$VIDEO` / `video_dir()` resolve to the app-specific Movies directory | **Breaking on Android only.** External cache storage is no longer used. |

### Tauri — standing facts

- **The crates do not share a version.** At the time of writing: `tauri`
  `2.12.5`, `tauri-cli` `2.12.4`, `tauri-build` `2.7.4`, `tauri-macros` `2.7.4`.
  `@tauri-apps/cli` tracks the **CLI crate** (`2.12.4`), not the core crate
  (`2.12.5`) — "the CLI is a patch behind" is normal and not a bug.
- **A plugin's Rust crate and its JS package ship separately.** They live in
  different repos and different version streams. A mismatch does not fail the
  build; it fails at runtime, usually as a missing command. Bump both together.
- **Tauri 3 is in alpha** (`@tauri-apps/cli`'s `next` tag was `3.0.0-alpha.5`).
  Not actionable for a stable app — but a v2 → v3 migration will need the
  capability and plugin changes reviewed, not just a version bump.
- **Release bodies carry a Cargo Audit block** listing RustSec advisories for
  *transitive* crates (e.g. `RUSTSEC-2026-0206` for `rustybuzz`). Those are
  advisory-only warnings about unmaintained dependencies, not advisories
  against your code — but they tell you when a transitive dep rots.
- Plugin changelogs live at
  `tauri-apps/plugins-workspace`, branch `v2`, path
  `plugins/<name>/CHANGELOG.md`. The plugin's own repo has no changelog.

---

## Upgrading safely, both frameworks

1. **Skew first.** Tauri: crate vs CLI, crate vs JS package per plugin.
   Electron: `electron` vs `electron-builder`, and your `engines` field.
2. **One breaking change per commit.** A revert is a commit, not a bisect.
3. **Re-read the app's own version gates.** The desktop layer usually has a
   version check somewhere ("if Electron >= 40 …"); a major bump usually
   invalidates it.
4. **Test the update path, not just the build.** Install N, ship N+1 through the
   real feed on every OS you publish (house style: Windows/macOS/Linux, x64+arm64).
5. **Run the audit again afterwards.** The P0 list for the new version should
   be empty. If it is not, the upgrade did not land.
