---
name: wpf-desktop
description: Build, maintain or fix Windows WPF apps. 主动检查相关 SDK/NuGet 版本、XAML、窗口、DPI、托盘与发布。新建或整体升级对齐 .NET 10，局部修复按需升级，支持只读评估。

metadata:
  version: "1.3.1"
  openclaw:
    homepage: https://github.com/rockbenben/aishort-skills/tree/main/skills/wpf-desktop
    emoji: "🪟"
    os: ["win32"]
    files:
      - project-setup.md
      - upgrade-dependencies.md
      - pitfalls.md
      - dev-switches.md
      - github-actions.md
      - VALIDATION.md
---

# WPF desktop apps

Start with the WPF project, its effective SDK and target framework, and the user-visible behavior involved. Check for relevant upgrades and optimization opportunities on each task. Follow the user's version, platform, component and read-only constraints.

## Choose the scope

| Request | Action and verification |
| --- | --- |
| Skill and repository only, or general maintenance | Review the solution's SDK, NuGet packages, startup path, window and tray lifecycle, DPI handling, publish profiles and CI. Use existing smoke checks or a targeted probe to confirm issues. Fix gaps with demonstrated impact and a way to verify the result. Report remaining version gaps for follow-up. |
| New app, whole-project upgrade or adoption of the full standard | For a new app, select the needed libraries and profiles in [项目起手与发布配置](project-setup.md). Target `net10.0-windows` and the latest stable 10.0 SDK. Apply [依赖升级](upgrade-dependencies.md) across the solution, profiles and CI. Restore, build and test, then exercise the affected windows and publish profiles on Windows. |
| Feature or specific fault | Inspect the affected code and package versions. Change dependencies only where the feature or fix requires it. For a misplaced window, check monitor coordinates and DPI conversion, then reopen it on the affected monitor at the same scaling. |
| Read-only assessment or plan | Inspect project files, existing results and configured feeds. Report findings, evidence and proposed checks, preserving the working tree. If available, use `desktop-app-standard`'s `audit.mjs <repo> --dotnet` for static SDK, TFM and CI checks. |

## Find a diagnostic or release guide

| Task or symptom | Where to start |
| --- | --- |
| White flash, slow startup, focus, multi-monitor placement, buttons off screen, RTL text, shell icons or hotkeys | [按症状查 WPF 故障](pitfalls.md). Search its headings, e.g. 「副屏上窗口位置算错」 or 「德语界面上控件被挤没」. |
| Stale lists, blocking filters, config recovery or update caching | [按症状查 WPF 故障](pitfalls.md), e.g. 「后台扫描完成了，筛选列表仍然卡顿」. |
| Lazy-loaded XAML, WPF test hosts, layout screenshots, phase timing, intermittent activation or translation coverage | [开发期自查工具](dev-switches.md). Use the probe that exposes the symptom. |
| Elevated helper has no usable confirmation, RunAs uses the wrong data directory, or a retry changes its approved scope | [按症状查 WPF 故障](pitfalls.md)「提权重试进程在跑，却没有可操作的确认框」. For real consent, Explorer drag/drop or crash-recovery evidence, read [开发期自查工具](dev-switches.md)「人工交互验收」. |
| GitHub Actions, installer and portable ZIPs, checksums, signing, draft promotion or winget | [发布工作流](github-actions.md). Match the asset list to the selected profiles and installer. |
| Previously exercised capabilities, evidence and environment limits | [验证覆盖范围](VALIDATION.md). |

## Verify the result

- **XAML or tray lifecycle.** Build on the project SDK. On Windows, use the existing `--smoke` harness or open the affected windows, close and reopen them. Check that each window actually lays out to nonzero size and that closing a test window leaves the harness running.
- **Layout or DPI.** Exercise the affected state with long or RTL strings on the smallest supported work area. For example, 1366×768 at 150% with a 48-DIP taskbar leaves about 464 DIP vertically. Compare action-button screen bounds with that monitor’s work area. Offscreen shots can show buttons that are unreachable on screen.
- **Startup or intermittent failures.** Time individual phases or count successes over repeated trials under the same conditions before and after the change. Report counts and the environment.
- **Release.** Build the selected profiles, verify the downloaded draft files against the expected asset set and hashes, and record which architectures actually ran. Public release, signing-service configuration and winget submission follow the user’s requested scope.
- **GitHub Actions.** Follow the application's existing tag workflow through its Windows build, signing, packaging, draft verification and promotion jobs. For an existing release, inspect the run for the tag and match the published assets to that build. Report which steps ran locally and which succeeded on hosted runners.
- **Dependency upgrade.** Report the required major, effective SDK and TFMs, resolved package versions before and after, and the Windows checks run. Record any unmet target with its concrete blocker and retry condition.
- **Report.** State what you checked, what you found, what you changed and how you verified it. Include comparable measurements for performance claims and identify checks that still need a device, runner or published build.
