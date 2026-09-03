---
name: wpf-desktop
version: 1.0.2
description: Use when building, debugging or releasing a WPF desktop app on .NET — tray, single-file exe, DPI, startup, release CI. 托盘应用 / 单文件 exe. Refs are Chinese.
tags: [wpf, dotnet, csharp, desktop, windows, tray, single-file, xaml, github-actions, winget]
homepage: https://github.com/rockbenben/aishort-skills/tree/main/skills/wpf-desktop

metadata:
  openclaw:
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

## Three iron rules

Break any of these and the symptom shows up long after the change, with nothing pointing back at the cause.

**1. Verify version numbers first; never trust the ones in a template.** Package versions drift, and numbers written into docs are stale by definition:

```bash
dotnet nuget list source                                  # confirm the feed
gh api repos/actions/setup-dotnet/releases/latest --jq .tag_name
dotnet list package --outdated                            # for an existing project, just ask it
```

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
| Tagged release on GitHub Actions, SHA256 sums, winget submission | `github-actions.md` |

## Mandatory pre-change checks

Each of these is the "looks fine now, explodes much later" kind:

- **Before touching layout**: read the container-semantics table under 「德语界面上控件被挤没」 in `pitfalls.md` — that section also carries the mechanical form of the rule, including the third condition that took a first attempt from 64 false positives down to 1 real hit. A horizontal `StackPanel` offers its children **infinite** width, so wrapping a `ContentPresenter` in one inside a control template means that control's text label can never wrap anywhere in the app — no amount of outer `Grid` fixes it.
- **Before adding `MinWidth`**: decide who truncates. `MinWidth` on a `TextBlock` with `TextTrimming` shifts truncation from the TextBlock to the parent's clip — invisible in LTR, but **in Arabic it cuts the start of the string, with no ellipsis**.
- **Before changing window activation**: foreground and z-order are different things. The OS owns foreground; when it refuses, a z-order bump is still available as a fallback — but **never on a `Topmost` window**. `SetWindowPos` writes `WS_EX_TOPMOST` behind WPF's back while `Window.Topmost` still reads true, so WPF never re-applies it and that window silently stops being topmost for the rest of the process. Read the three guards under 「点了「设置」，窗口偶尔没到最前面」 in `pitfalls.md` first.
- **Before moving work off the startup path**: a background build needs three things, not one — the UI thread must not `Wait()` on it (block long enough and Windows silently removes the app's low-level keyboard hooks for the rest of the session), a bounded wait is **not** the way out of that (it answers from a half-built index, i.e. returns wrong instead of slow), and a swallowed failure still has to be reported or you get "everything is listed but nothing is findable, with no error". See 「冷启动 1.9 秒，慢的却不是磁盘」 in `pitfalls.md`.
- **Before wiring a tray icon**: a `TaskbarIcon` declared in `App.xaml` resources never enters a visual tree, so H.NotifyIcon's `Loaded`-based creation never fires — call `ForceCreate()`, or the app ships with no tray icon at all. See the tray section in `project-setup.md`.
- **Publish settings**: `RuntimeIdentifier` / `SelfContained` / `PublishSingleFile` go in pubxml only, never the csproj. In the csproj they drag every `dotnet build` through the RID-specific single-file path, and a self-contained project cannot be referenced by a test project (`NETSDK1151`).
- **Before scanning user directories**: not `Directory.EnumerateFiles(..., SearchOption.AllDirectories)` — that overload has "compat" semantics (`IgnoreInaccessible = false`): one unreadable subdirectory throws away the whole walk, and a wrapping catch turns hundreds of results into zero. Use the `EnumerationOptions` overload.
- **Before hardcoding a size cap**: the same number must serve a 1366×768 laptop and a 4K display. A hardcoded value is wrong at one end or the other; compute from the work area of the monitor the window is actually on.

## Before you finish

- **Run `--smoke`**: WPF XAML is lazy-loaded — a broken window XAML throws nothing until that window opens, and ships that way. Have it assert every window laid out to a non-zero size: `Window.Show()` silently no-ops once the app has begun shutting down, and a throw-only smoke stays green through that (see 「harness 会自己引爆的三颗雷」 in `dev-switches.md`).
- **UI changed? Run `--shots` and compare**: multi-language + multi-resolution + dark/light problems are all invisible in Chinese at comfortable sizes. But it has two blind spots, and both are structural — no number of extra screenshots closes them:
  - The harness sets `MaxHeight` itself, so a window missing its own runtime height cap looks fine in every screenshot and still puts its OK button off-screen on a real laptop.
  - A row that no harness state renders is simply not in the matrix. Conditional field panels are selected by *data*, so a rarely-used branch can have zero pixels across thousands of images.

  **Make both into build-time tests rather than review items** — each judgement is pure text over the XAML, so it needs no run: every `SizeToContent` window has a runtime cap *and* a conservative XAML fallback sized for the smallest screen; every wrapping `TextBlock` has something to wrap against. Review misses both because both read as already handled: the runtime cap's own comment promises the XAML fallback (so nobody re-opens the XAML to check), and a `TextWrapping="Wrap"` looks like the wrapping was dealt with. See 「它查不出什么」 ×2 in `dev-switches.md`.
- **Don't write size numbers into docs**: two releases later they no longer match. GitHub's asset list already shows exact sizes; keep only the judgment ("one big, one much smaller") in prose.
