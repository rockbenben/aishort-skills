# Adopt checklist — 快照（核验于 2026-11-03，Electron 45.2.1 / Tauri 2.12.5）

> **这是带日期的快照，不是当前事实。** 使用前用 `audit.mjs`（在线）重新核验最新版本和 release notes；
> 版本已前进时，按[本次升级流程](upgrade-dependencies.md)在目标应用中落实新版本。下表用于识别跨过这些版本时需要迁移的 API。
> 内容取自上游 release notes 原文，每条附 PR 链接，便于复查。

## Toolchain snapshot (2026-11-03)

| Package | npm `latest` | Notes |
|---|---|---|
| `electron` | `45.2.1` | Chromium `156.0.8078.75` · Node `24.22.1` · V8 `15.6.75.25`；`engines` >=22.12.0；`latest` 与 `45-x-y` 同指 `45.2.1` |
| `electron-builder` | `26.18.0` | `v26` tag points at `26.18.1`（GitHub 同日发布），`latest` 仍落后一个 patch；`next` 是 27.0.0-alpha，不作为 stable 目标 |
| `electron-updater` | `6.8.11` | 当时同一稳定线的 v26 标签已指向补丁 6.8.12。 |
| `@electron/rebuild` | `4.2.1` | 用这个包；旧名 `electron-rebuild` 已弃用。electron-builder 26.18.0 已依赖 4.2.1 |
| `@electron-forge/cli` | `8.0.1` | 只给已有 Forge 项目；新应用仍用 electron-builder |
| `@electron/fuses` | `2.1.3` | 可选；启用后要在实际打包产物上验证 |

- 这些是当时的 npm 标签。安装时以[当前技能目标](version-targets.json)为准，审计分别报告上游稳定参考和指定 major 内已发布的稳定目标。
- 安装后显式跑 `npx install-electron`（Yarn：`yarn run install-electron`）；Electron 42+ 不再有 postinstall 下载。
- 原生模块用 `@electron/rebuild` 按目标架构 rebuild，不要再用 `electron-rebuild`。
- 快照中 builder 和 updater 的 next 标签当时均为 alpha。每次升级重新查询稳定渠道。

## Electron

### v45.0.0 — breaking, act before upgrading

| Change | What it means for your app |
|---|---|
| Sandboxed preload scripts lose the `events`, `timers`, `url` modules and the `Buffer`, `setImmediate`, `clearImmediate` globals | Update affected imports or move privileged work into the main process behind a narrow IPC handler. ([#54048](https://github.com/electron/electron/pull/54048)) |
| `safeStorage`'s **synchronous** methods are deprecated, removal in Electron 46 | `isEncryptionAvailable`/`encryptString`/`decryptString` still work, but `decryptStringSync` et al. go away next major. Move to the async API now. (No PR link in the release notes.) |
| 32-bit builds removed (Windows `ia32`, Linux `armv7l`) | Only `x64`/`arm64` are published. A 32-bit target is no longer buildable, at any version. ([#51816](https://github.com/electron/electron/pull/51816)) |
| `contentTracing.enableHeapProfiling()` removed | Chromium dropped the memlog backend. Use the `nativeHeapProfiling` option on `contentTracing.startRecording()`. The companion change landed as [#54863](https://github.com/electron/electron/pull/54863). |
| Screen/window/tab capture is reported to `setPermissionRequestHandler` as **`display-capture`**, not `media` | A handler that allows only `media` silently kills screen sharing. Allow both. ([#52824](https://github.com/electron/electron/pull/52824)) |
| `document.requestStorageAccessFor` is disabled by default in Chromium | Restore with the `enableBlinkFeatures: "RequestStorageAccessFor"` web preference — but it is on the way out. |
| ASAR: `fs.open` on a file **inside** the archive no longer extracts a temp copy | The descriptor only identifies the entry; code that reads the raw descriptor (native addons, `child_process` stdio, `net.Socket({fd})`, `respondWithFile()`) fails with `EBADF`. Write flags now fail with `EACCES` instead of silently writing to a temp copy. |
| `window.open()` children whose sandbox state differs from the opener get their own process without an opener relationship | Keep child windows sandboxed and test any flow that depended on the opener. ([#52472](https://github.com/electron/electron/pull/52472)) |
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

### v45.1.0 — the previous minor

| Change | What it means for your app |
|---|---|
| `session.registerPreloadScript` accepts `matches`, `excludeMatches`, `includeGlobs`, `excludeGlobs`, `matchOriginAsFallback` | Scope preload injection by URL/origin instead of registering one broad script. Verify redirect/final-URL behavior in your app. ([#55181](https://github.com/electron/electron/pull/55181)) |
| Chromium `156.0.8078.49`, Node `24.22.1` | Patch-level stack refresh; rebuild native modules and re-run the OS/arch floor checks. |
| ASAR, extension-service-worker and Linux D-Bus fixes | Re-test apps that read packed files through raw fds, load MV3 extensions, or call D-Bus; see the release notes for the exact fixes. ([v45.1.0](https://github.com/electron/electron/releases/tag/v45.1.0)) |

### v45.2.0 / v45.2.1 — the current minor line

| Change | What it means for your app |
|---|---|
| `Menu.setHighlightColors()` sets menu highlight colors on Windows | Custom menu highlight colors no longer need a native workaround. ([#55493](https://github.com/electron/electron/pull/55493)) |
| Extensions get `chrome.storage.sync` | It behaves as a **second local storage area** under Chrome's sync quotas — there is no cross-device sync, so an MV3 extension that assumed real sync still has none. ([#55253](https://github.com/electron/electron/pull/55253)) |
| `net.fetch()` is faster without a body, and for repeated `file:` URLs | Each has backports into the other supported lines (#55446 also in 43/44/46, #55459 also in 44/46) — a perf-only reason to take the line. ([#55446](https://github.com/electron/electron/pull/55446), [#55459](https://github.com/electron/electron/pull/55459)) |
| DevTools "Save" reuses the previously chosen folder; fractional opacity in `window.open()` feature strings is no longer truncated; `webContents.adjustSelection()` honours `end` | Behavior fixes that only show up in a packaged app. ([#55485](https://github.com/electron/electron/pull/55485), [#55499](https://github.com/electron/electron/pull/55499), [#55462](https://github.com/electron/electron/pull/55462)) |
| v45.2.1 moves Chromium to `156.0.8078.75` and backports upstream Chromium fixes | **A supported stable line only maintains its newest minor** — an app pinned to `45.1.0` is off the maintained minor even though 45 is still supported. ([#55419](https://github.com/electron/electron/pull/55419), [#55523](https://github.com/electron/electron/pull/55523), [v45.2.1](https://github.com/electron/electron/releases/tag/v45.2.1)) |

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

- **Stack at v45.2.1:** Chromium `156.0.8078.75`, Node `24.22.1`, V8 `15.6.75.25`.
  A major bump moves all three — re-read your `engines` and your native deps.
- **Support window: the latest three majors.** At this snapshot the supported
  majors are 45 / 44 / 43; v45.0.0's `## Notices` section announces "End of
  Support for 42.x.y". 43 drops when 46 ships — that is a deadline for
  shipping patches, not a note. The official schedule puts 45's EOL at
  2027-04-27, 44's at 2027-03-02, 43's at 2027-01-05.
- **Since Electron 42 the package has no `postinstall`.** The runtime is
  downloaded the first time something runs it, so `npm ci` is fast and
  quiet and the first launch pauses for ~100 MB. In CI run
  `npx install-electron` (Yarn: `yarn run install-electron`) right after install so the download is an explicit,
  cacheable step; `ELECTRON_SKIP_BINARY_DOWNLOAD` no longer exists.
- npm dist-tags: `latest` tracks the current stable major; `45-x-y` tracks the
  45.x patches. For `electron-builder` / `electron-updater`, the repo also
  publishes `v26` (latest 26.x / 6.8.x patch) and `next` (27 / 7 alpha);
  `latest` can lag `v26` by a patch. Check `npm view <pkg> dist-tags` and
  install the registry-confirmed stable version for the major declared in the skill's target table.

### Electron 46 — scheduled, not actionable yet

Heads-up only: a stable app does not act on prereleases. Dates come from the
official schedule and are provisional — re-read them each run.

- **Where it is now:** npm `alpha` = `46.0.0-alpha.5` (2026-11-02). Scheduled
  beta 2026-12-03, scheduled stable **2027-01-05**.
- **The stack moves under it:** the schedule targets Chromium **160** and
  embedded Node **26.13.0** for 46.0.0 (45.x is Chromium 156 / Node 24.22). The
  alpha in progress is already on Chromium 158 / V8 15.8, so the exact numbers
  are not settled — but the embedded Node jumping 24 → 26 is, and that means a
  new ABI: plan an `@electron/rebuild` pass on every target arch, and re-check
  `engines` against the tooling you install alongside it.
- **Support window closes on the same day:** 43's EOL is 2027-01-05, i.e. the
  scheduled 46 stable date. Any patch you still owe a 43-based build is due
  before that release.
- **The removal already announced in 45's notes lands here:** `safeStorage`'s
  synchronous methods are deprecated in 45 and removed in 46. Move to the
  async API on the current release rather than treating it as a 46 task.

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

按[依赖升级流程](upgrade-dependencies.md)更新实际项目。跨越上述版本时，只迁移项目用到的 API。涉及应用内更新时，另按[发布流程](release-flow.md)从已安装的旧版验收。
