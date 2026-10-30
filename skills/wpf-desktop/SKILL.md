---
name: wpf-desktop
version: 1.1.1
description: Use when building, debugging or releasing a WPF app on .NET — tray, single-file exe, DPI, startup, release CI. WPF 桌面应用：托盘、单文件 exe、DPI、启动、发版 CI。

metadata:
  openclaw:
    homepage: https://github.com/rockbenben/aishort-skills/tree/main/skills/wpf-desktop
    emoji: "🪟"
    os: ["win32"]
    files:
      - project-setup.md
      - pitfalls.md
      - dev-switches.md
      - github-actions.md
---

# WPF Desktop Apps

A selection-and-pitfalls checklist for tray-resident WPF utilities. Selections track current official releases and docs — **verify versions before use** (rule 1 below). The pitfalls are field-tested, each with the measurement that exposed it.

**Language:** this page is English, the four reference files it points to are Chinese.
That is where the actual content lives — the symptom write-ups, the code and its
comments — so a reader who does not read Chinese gets the index and not the substance.
The lookup keys are the Chinese section headings, quoted here in 「」, so an agent can
route to the right file either way.

## When to use

- Building or reworking a WPF app: picking dependencies, publish profiles, CI self-checks (smoke / screenshots)
- Chasing WPF-specific symptoms: white flash on open, window not coming to front, DPI math wrong on a second monitor, controls crushed by long translations, slow startup
- Publishing a single-file exe (self-contained / framework-dependent)

**Not for**: desktop-packaging a web stack (that's `nextjs-to-tauri` / `nextjs-to-electron`), WinUI 3, MAUI.

**Cross-stack release baseline:** the rules shared with Tauri/Electron — tag as the only version source, draft → verify → publish, asserting `releases/latest`, SHA256 + attestation, signing, winget — live in `desktop-app-standard`'s `references/release-flow.md`「跨栈发布基线」. The WPF-specific implementation is still `github-actions.md` here; use `desktop-app-standard` for Tauri/Electron audits, and its `audit.mjs --dotnet` for the automated .NET runtime/SDK check (TFM support/EOL, `global.json` pin/`rollForward`).

## Deliberate choices — don't "fix" them

- **Actions pinned to major tags** (`@v7`), not commit SHAs. Patches arrive by themselves; majors are checked by hand (rule 1).
- **No Dependabot.** It was taken out on purpose. Version drift is caught by rule 1's commands, run before every release.

Generic CI auditors (e.g. `desktop-app-standard --ci-only`) flag the moving tags as `action-moving-ref` — a `notice`, not a P-level — and that one is accepted here; everything else they report is worth reading. That auditor has no Dependabot check at all, so the choice above is a house-style decision, not an accepted finding.

## Three iron rules

Break any of these and the symptom shows up long after the change, with nothing pointing back at the cause.

**1. Verify version numbers first; never trust the ones in a template.** Package versions drift, and numbers written into docs are stale by definition:

```bash
dotnet nuget list source                                  # confirm the feed
dotnet list package --outdated                            # for an existing project, just ask it
dotnet list package --vulnerable --include-transitive
# every action in ci.yml: pinned ref vs. latest release (exact pins shown in full)
grep -oE 'uses: [^ ]+@v[0-9]+(\.[0-9]+)*' .github/workflows/ci.yml | sort -u | while read -r _ ref; do
  echo "$ref → $(gh api "repos/${ref%@*}/releases/latest" --jq .tag_name)"; done
# .NET channel: latest SDK, support phase, end of support (PowerShell; no jq needed)
powershell -NoProfile -Command '$j = Invoke-RestMethod https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json; "{0}`t{1}`t{2}" -f $j."latest-sdk", $j."support-phase", $j."eol-date"'
```

The .NET channel itself drifts too: net8 and net9 both reach end of support on 2026-11-10; a template that still says `net8.0-windows` is shipping an unpatched runtime inside every self-contained exe after that date.

**2. Measure before touching a performance problem.** WPF startup cost hides where you least expect it — in one measured case, disk reads plus JSON parsing took 9 ms while **a single function call took ~770 ms** (a third-party library loading its built-in dictionary on first call). Untimed fixes fix the wrong thing. Method: the phase-timing probe in `dev-switches.md`.

**3. Intermittent problems need a scoreboard first.** For "sometimes it doesn't work", a single repro proves nothing. Write a probe, run N rounds, record the success rate, then talk causes. One such scoreboard (11/12 vs 6/12) cleared the change that looked most guilty. Read the rest of that entry before you trust a single run of your own: a second round of the same probe came back 12/12 twice, which says the failure did not reproduce reliably and the first scoreboard settled less than it appeared to. The method is still the right one — it is what tells you the difference.

## How to use this skill

**Read the matching file before changing code — not from memory.** Several of these pitfalls were re-introduced after being written down, each time by someone who trusted their recollection instead of re-reading. The reference files are written in Chinese; the symptom headings are the lookup keys, and this page quotes the relevant ones in 「」 so you can find them without reading Chinese.

Absolute numbers in those files (milliseconds, MB) come from one app on one machine — the transferable part is the shape, not the value. Re-measure on yours with the probes in `dev-switches.md`.

| Task | Read first |
| --- | --- |
| New project, dependency choices, publish profiles | `project-setup.md` |
| Debugging a specific symptom | `pitfalls.md` (look up by symptom heading) |
| Verifying a change didn't break things, CI smoke/screenshots, timing or intermittent problems | `dev-switches.md` |
| Tagged release on GitHub Actions, SHA256 sums, signing, winget submission | `github-actions.md` |
| Is our .NET / SDK still current? EOL coming? | rule 1's `releases.json` line, or the automated `desktop-app-standard` `audit.mjs --dotnet`; then `project-setup.md`「SDK 固定：global.json 一处说了算」 |

## Mandatory pre-change checks

Each of these is the "looks fine now, explodes much later" kind:

- **Before touching layout**: read the container-semantics table under 「德语界面上控件被挤没」 in `pitfalls.md` — that section also carries the mechanical form of the rule, including the third condition that took a first attempt from 64 false positives down to 1 real hit. A horizontal `StackPanel` offers its children **infinite** width, so wrapping a `ContentPresenter` in one inside a control template means that control's text label can never wrap anywhere in the app — no amount of outer `Grid` fixes it.
- **Before adding `MinWidth`**: decide who truncates. `MinWidth` on a `TextBlock` with `TextTrimming` shifts truncation from the TextBlock to the parent's clip — invisible in LTR, but **in Arabic it cuts the start of the string, with no ellipsis**.
- **Before changing window activation**: foreground and z-order are different things. The OS owns foreground; when it refuses, a z-order bump is still available as a fallback — but **never on a `Topmost` window**. `SetWindowPos` writes `WS_EX_TOPMOST` behind WPF's back while `Window.Topmost` still reads true, so WPF never re-applies it and that window silently stops being topmost for the rest of the process. Read the three guards under 「点了「设置」，窗口偶尔没到最前面」 in `pitfalls.md` first.
- **Before moving work off the startup path**: a background build needs three things, not one — the UI thread must not `Wait()` on it (block long enough and Windows silently removes the app's low-level keyboard hooks for the rest of the session), a bounded wait is **not** the way out of that (it answers from a half-built index, i.e. returns wrong instead of slow), and a swallowed failure still has to be reported or you get "everything is listed but nothing is findable, with no error". See 「冷启动 1.9 秒，慢的却不是磁盘」 in `pitfalls.md`.
- **Before wiring a tray icon**: a `TaskbarIcon` declared in `App.xaml` resources never enters a visual tree, so H.NotifyIcon's `Loaded`-based creation never fires — call `ForceCreate()`, or the app ships with no tray icon at all. See the tray section in `project-setup.md`.
- **Before changing `TargetFramework`, `global.json` or `setup-dotnet`**: change all three together — `global.json` is the single SDK source, CI reads it via `global-json-file`, and a hardcoded `dotnet-version` next to it is the "two sources, one gets forgotten" bug. Read 「SDK 固定：global.json 一处说了算」 in `project-setup.md`.
- **Before turning on `packages.lock.json`**: single-file publish implicitly references `Microsoft.NET.ILLink.Tasks`, whose version follows the SDK patch — with `--locked-mode` the next SDK patch fails restore with `NU1004`. Read 「NuGet 锁文件：单文件发布先别开」 in `project-setup.md`.
- **Publish settings**: `RuntimeIdentifier` / `SelfContained` / `PublishSingleFile` go in pubxml only, never the csproj. In the csproj they drag every `dotnet build` through the RID-specific single-file path, and a self-contained project cannot be referenced by a test project (`NETSDK1151`).
- **Before scanning user directories**: not `Directory.EnumerateFiles(..., SearchOption.AllDirectories)` — that overload has "compat" semantics (`IgnoreInaccessible = false`): one unreadable subdirectory throws away the whole walk, and a wrapping catch turns hundreds of results into zero. Use the `EnumerationOptions` overload.
- **Before hardcoding a size cap**: the same number must serve a 1366×768 laptop and a 4K display. A hardcoded value is wrong at one end or the other; compute from the work area of the monitor the window is actually on.
- **Before running a self-check harness or the test suite on the machine you are sitting at**: a harness that builds the full-screen topmost overlay really puts it on your desktop, and the production path's window-ghosting switch does not run on that path — a UI thread that stalls past 5 s then lets DWM cover the screen with a click-eating ghost until you kill `dwm.exe`. A test that really installs a global `WH_MOUSE_LL` hook takes the mouse of every desktop on the machine, and its press gate also re-injects a key while tearing down. Read 「整个桌面点不动，只有杀掉桌面窗口管理器才恢复」 in `pitfalls.md` and 「跑测试会真的接管你这台机器的鼠标」 in `dev-switches.md`.

## 已验证 / 未验证

**已验证（2026-10-24，Windows 11 实机）**：在真实 WPF 仓（rockbenben/Clockwork，2737 个测试）上实跑 `global.json` 的 SDK 下限那一节——用 `dotnet-install.ps1` 把 SDK 10.0.100 与 10.0.303 分别装进**独立 root**（不碰系统那套 10.0.303/10.0.402）后实测：下限 10.0.402 + `latestFeature` 在只装着 10.0.303 的 root 上**解析失败**（"A compatible .NET SDK was not found. Requested SDK version: 10.0.402"），下限改成 GA 基线 10.0.100 则正常解析到 10.0.303；同一台机器上带 `"test": {"runner": "Microsoft.Testing.Platform"}` 段 → MTP 模式、测试全过，去掉该段 → 退回 VSTest 并报 `MSB1001`（`--minimum-expected-tests` 被当成未知开关）。同批实跑的还有：发布页上 v3.2.1 那份 `SHA256SUMS.txt` 实测 3 行全是 CRLF，GNU coreutils 8.32 下 `sha256sum -c` 逐行 "No such file or directory"（`\r` 进了文件名），换成 LF 后两行 OK；`gh release download` 能下草稿（走 GraphQL 的「待发布 tag 名」查找，REST 的 `releases/tags/<tag>` 不返回草稿）；`gh api --method PATCH .../releases/{id}` 带 `draft=false` + `make_latest=true` 一次调用即完成「转正 + 指针前移」。同批还实测到：带 `FitToWorkArea` 的长提醒弹窗仍可能把「是/否/稍后」排到屏幕下方，而 `PrintWindow` 的整窗图照样把按钮画全；给正文滚动区按工作区封顶后按钮回到屏内。

**已验证（2026-10-23，Linux 沙箱）**：用本版文档片段生成的合成仓库（csproj、global.json、四份 pubxml、ci.yml）过 actionlint 1.7.12 无错误；.NET SDK 10.0.402 + `EnableWindowsTargeting` 下四个 profile 全部发布成功，PowerShell 7.6 实跑 Check tag（`v1.2.3-beta` 被拒）/ Publish / Package，产出 6 个资产；publish job 的核验脚本全 OK，删掉一个 zip 后退出 1。铁律一那条命令实跑：ci.yml 里 6 个 action 的大版本标签都存在且对应最新 release（checkout v7.0.1、setup-dotnet v6.0.0、attest v4.2.2、action-gh-release v3.0.3、azure/login v3.1.0、artifact-signing-action v2.0.0）；.NET 10：SDK 10.0.402、active、EOL 2028-11-14（2026-10-25 起 latest-sdk 已到 10.0.403——上面这个数是当天的实测值，`global.json` 里的下限不用跟着抬）。

**未验证**：真实 Windows runner 上的 `--smoke`、真实签名（需要 Azure 账户）、真实仓库里的 attestation 与草稿/公开流程（上面那条草稿/公开流程是在**真实仓库**上用临时草稿与临时 tag 实跑的，但**没有**真的走一遍发版）、winget 提交、arm64 真机运行。

**这一节是活的**：改了什么就把对应的验证补进来或划掉，别让它变成又一份历史快照。2026-10-24 的校正分别实跑或对过原文：铁律一的 action 核验（旧正则把 `@v4.2.2` 截成 `@v4`，已用合成 `ci.yml` 复现；新命令输出的是「钉住的标签 → 上游最新 release」，例如 `actions/attest@v4 → v4.2.2`）、.NET 那行改用 PowerShell（实跑得到 `10.0.402 / active / 2028-11-14`，不再依赖 jq；`10.0.402` 是那天的实测值，latest-sdk 现已是 10.0.403）、`--shots` 的最紧档 464 DIP（与 `pitfalls.md` 的算式对齐）、`WrapPanel` 的测量语义（dotnet/wpf `WrapPanel.MeasureOverride` 传的是 `constraint.Width`）、`TaskScheduler.UnobservedTaskException` 默认不终止进程（官方文档）、VS 17.14 能装 10.0.1xx 但 target 上限是 net9.0（官方版本对应表）；跨栈发布基线指针已核对（`desktop-app-standard` 的 `references/release-flow.md`「跨栈发布基线」存在，WPF 实现仍在 `github-actions.md`）；自动 .NET 运行时/SDK 审计用 `desktop-app-standard` 的 `--dotnet`（TFM 支持期/EOL、`global.json` pin/rollForward），本 skill 的手工核验仍是 WPF 构建/发布侧的权威。

## Before you finish

- **Run `--smoke`**: WPF XAML is lazy-loaded — a broken window XAML throws nothing until that window opens, and ships that way. Have it assert every window laid out to a non-zero size: `Window.Show()` silently no-ops once the app has begun shutting down, and a throw-only smoke stays green through that (see 「harness 会自己引爆的四颗雷」 in `dev-switches.md`).
- **UI changed? Run `--shots` and compare**: multi-language + multi-resolution + dark/light problems are all invisible in Chinese at comfortable sizes. But it has two blind spots, and both are structural — no number of extra screenshots closes them:
  - The harness sets `MaxHeight` itself, so a window missing its own runtime height cap looks fine in every screenshot and still puts its OK button off-screen on a real laptop.
  - A row that no harness state renders is simply not in the matrix. Conditional field panels are selected by *data*, so a rarely-used branch can have zero pixels across thousands of images.

  **Make both into build-time tests rather than review items** — each judgement is pure text over the XAML, so it needs no run: every `SizeToContent` window has a runtime cap *and* a conservative XAML fallback sized for the smallest screen; every wrapping `TextBlock` has something to wrap against. Review misses both because both read as already handled: the runtime cap's own comment promises the XAML fallback (so nobody re-opens the XAML to check), and a `TextWrapping="Wrap"` looks like the wrapping was dealt with. See 「它查不出什么」 ×2 in `dev-switches.md`.
  - **A window cap is not a content cap.** A transparent `SizeToContent` window with a scrollable body can still lay out past the work area even with `FitToWorkArea`; cap the scrolling content too, and verify the action buttons' screen rect with a full-screen capture — `PrintWindow`/offscreen `--shots` render the whole window even when it is below the monitor. See 「窗口封顶了，正文和按钮仍可能在屏外」 in `pitfalls.md`.
- **Touched `ci.yml`, `global.json`, a pubxml or the TFM?** Run rule 1's commands again; a version bumped in one place and not the others is the usual way a release goes red.
- **Don't write size numbers into docs**: two releases later they no longer match. GitHub's asset list already shows exact sizes; keep only the judgment ("one big, one much smaller") in prose.
