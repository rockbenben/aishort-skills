---
name: wpf-desktop
description: Build, maintain or audit Windows WPF/XAML apps, including windows, DPI, tray, SDK/NuGet and packaging. Windows WPF 新建、维护与只读评估；新建或整体升级对齐 .NET 10，局部修复检查受影响路径。SDK/TFM-only audits can use desktop-app-standard --dotnet.

metadata:
  version: "1.3.13"
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
      - templates/ci.yml
      - templates/package-release.ps1.txt
      - templates/UpdatePackage.cs
---

# WPF desktop apps

Start with the WPF project, its effective SDK and target framework, and the user-visible behavior involved. Check for relevant upgrades and optimization opportunities on each task. Follow the user's version, platform, component and read-only constraints.

## Choose the scope

| Request | Action and verification |
| --- | --- |
| Skill and repository only, or general maintenance | Review the solution's SDK, NuGet packages, startup path, window and tray lifecycle, DPI handling, publish profiles and CI. Apply compatible stable NuGet patch/minor updates as described below. Use existing smoke checks or a targeted probe to confirm issues. Fix gaps with demonstrated impact and a way to verify the result. Report blocked or deferred upgrades with the reason. |
| New app, whole-project upgrade or adoption of the full standard | For a new app, select the needed libraries and profiles in [项目起手与发布配置](project-setup.md). Target `net10.0-windows` and the latest stable 10.0 SDK. Apply [依赖升级](upgrade-dependencies.md) across the solution, profiles and CI. Restore, build and test, then exercise the affected windows and publish profiles on Windows. |
| Feature or specific fault | Inspect the affected code and package versions. Apply compatible stable patch/minor updates to dependencies already involved in the task; keep unrelated dependency sweeps out of a focused fix. For a misplaced window, check monitor coordinates and DPI conversion, then reopen it on the affected monitor at the same scaling. |
| Read-only assessment or plan | Inspect project files, existing results and configured feeds. Report findings, evidence and proposed checks, preserving the working tree. If available, use `desktop-app-standard`'s `audit.mjs <repo> --dotnet` for static SDK, TFM and CI checks. |

Compatible patch/minor updates and their authorization, compatibility and verification rules are defined in [依赖升级](upgrade-dependencies.md). Apply them within the chosen scope; SDK/TFM and major migrations are evaluated separately.

## CI and release adoption

For new apps and general maintenance, identify the distribution channel and report both PR checks and tag delivery. For GitHub Releases, adapt [templates/ci.yml](templates/ci.yml) using [the release guide](github-actions.md). The Windows test job gates publish profiles and packaging; softprops/action-gh-release publishes the explicit asset list directly with draft: false and fail_on_unmatched_files enabled after local package and checksum verification. Approval, drafts and provenance are configured when required by the project.

Use the existing solution and test runner. For new apps, general maintenance and full-standard adoption, align profiles and packaging with the recommended distribution matrix: an installer plus x64/ARM64 self-contained and framework-dependent ZIPs. Fill missing package types and architectures; an incomplete historical release does not define the target matrix. Preserve explicit current user constraints and verify platform compatibility. Avoid attaching the same executable again when it is already distributed in a ZIP. The template uses .NET 10 MTP and stable tags. For VSTest, preserve the repository's test invocation and confirm a nonzero discovered test count. For stores, internal delivery or manual publication, record the actual delivery path. Trace reusable workflows to their implementation and source revision. Focused fixes check the affected paths; read-only assessments provide findings and proposed changes.

Inspect the downloaded package from a clean directory, including external resources and native libraries. Run the unpacked app on each supported architecture when available, record ARM64 cross-build and device execution separately, and verify installed N→N+1 upgrades preserve user data. Include the release run, selected package, signing status and remaining device checks in the result.

Copy [package-release.ps1](templates/package-release.ps1.txt) to tools and call that same script locally and from CI. It checks the four PE architectures, required external files, configured signatures, complete ZIP contents and isolated unpacked x64 smoke, then hashes the explicit asset list. Adapt application-specific smoke switches and required files. For download-based updates, use [UpdatePackage.cs](templates/UpdatePackage.cs) for process-architecture selection and architecture-isolated caching; verify SHA256 before extracting and mark completion only after successful extraction. Preserve offline/manual-update applications without introducing networking.

## Find a diagnostic or release guide

| Task or symptom | Where to start |
| --- | --- |
| White flash, slow startup, focus, multi-monitor placement, buttons off screen, RTL text, shell icons or hotkeys | [按症状查 WPF 故障](pitfalls.md). Search its headings, e.g. 「副屏上窗口位置算错」 or 「德语界面上控件被挤没」. |
| Stale lists, blocking filters, config recovery or update caching | [按症状查 WPF 故障](pitfalls.md), e.g. 「后台扫描完成了，筛选列表仍然卡顿」. |
| Lazy-loaded XAML, WPF test hosts, layout screenshots, phase timing, intermittent activation or translation coverage | [开发期自查工具](dev-switches.md). Use the probe that exposes the symptom. |
| Elevated helper has no usable confirmation, RunAs uses the wrong data directory, or a retry changes its approved scope | [按症状查 WPF 故障](pitfalls.md)「提权重试进程在跑，却没有可操作的确认框」. For real consent, Explorer drag/drop or crash-recovery evidence, read [开发期自查工具](dev-switches.md)「人工交互验收」. |
| GitHub Actions, installer and portable ZIPs, checksums, signing, direct release publication or winget | [发布工作流](github-actions.md). Match the asset list to the selected profiles and installer. |

## Verify the result

- **XAML or tray lifecycle.** Build on the project SDK. On Windows, use the existing `--smoke` harness or open the affected windows, close and reopen them. Check that each window actually lays out to nonzero size and that closing a test window leaves the harness running.
- **Layout or DPI.** Exercise the affected state with long or RTL strings on the smallest supported work area. For example, 1366×768 at 150% with a 48-DIP taskbar leaves about 464 DIP vertically. Compare action-button screen bounds with that monitor’s work area.
- **Startup or intermittent failures.** Time individual phases or count successes over repeated trials under the same conditions before and after the change. Report counts and the environment.
- **Release.** Use an English-only installer and uninstaller UI, including custom pages, buttons and messages, regardless of the OS or app language; configure Inno Setup as shown in [项目起手与发布配置](project-setup.md). Check both wizards on a Chinese-language Windows system. Build the selected profiles, verify the downloaded release files against the expected asset set and hashes, and record which architectures actually ran. Public release, signing-service configuration and winget submission follow the user’s requested scope.
- **GitHub Actions.** Follow the application's existing tag workflow through its Windows build, signing, packaging, package verification and direct publication steps. For an existing release, inspect the run for the tag and match the published assets to that build. Report which steps ran locally and which succeeded on hosted runners.
- **Dependency upgrade.** Report the required major, effective SDK and TFMs, resolved package versions before and after, and the Windows checks run. Record any unmet target with its concrete blocker and retry condition.
- **Report.** State what you checked, what you found, what you changed and how you verified it. Include comparable measurements for performance claims and identify checks that still need a device, runner or published build.
