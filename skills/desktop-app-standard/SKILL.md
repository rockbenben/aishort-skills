---
name: desktop-app-standard
description: Build, maintain or fix Tauri/Electron desktop apps. 主动检查相关版本、性能、安全配置、打包与更新。新建或整体升级按目标大版本实施，局部修复按需升级。提供只读巡检和 .NET SDK 审计。

metadata:
  version: "0.9.1"
  openclaw:
    homepage: https://github.com/rockbenben/aishort-skills/tree/main/skills/desktop-app-standard
    emoji: "📐"
    requires:
      bins: ["node"]
    files:
      - scripts/audit.mjs
      - scripts/core.mjs
      - scripts/ci-traps.mjs
      - scripts/dotnet.mjs
      - scripts/review-baseline.mjs
      - scripts/checksums.mjs
      - references/house-style.md
      - references/bootstrap.md
      - references/upgrade-dependencies.md
      - references/version-targets.json
      - references/release-flow.md
      - references/ci-traps.md
      - references/tauri.md
      - references/electron.md
      - references/adopt-checklist.md
      - references/report-and-baseline.md
      - references/verification-performance.md
      - references/sources.md
      - templates/workflows/ci.yml
      - templates/workflows/release-tauri.yml
      - templates/workflows/release-electron.yml
      - templates/desktop-policy.example.json
      - templates/release-plan.md
      - templates/performance-record.md
---

# Desktop App Standard

从应用所属 workspace、锁文件和构建入口确认使用的框架及实际版本。每次都主动检查与任务相关的升级和优化机会。检查范围由用户的目标决定，用户指定的组件、平台、版本和只读要求优先。

## 按目标选择入口

| 用户目标 | 检查、实施与验收 |
| --- | --- |
| 只给技能与仓库，或笼统要求维护 | 先运行在线审计，再按 [Tauri](references/tauri.md) 或 [Electron](references/electron.md) 检查框架配对、安全配置、启动与资源、打包和更新链路。用代码、锁文件或产物核实发现，修复有具体影响且能验证的缺口。其余版本差距列为后续项。 |
| 新建、整体升级或按本技能全面改造 | 新项目先按[起手步骤](references/bootstrap.md)生成骨架。按[目标大版本表](references/version-targets.json)与[依赖升级](references/upgrade-dependencies.md)实际更新框架、前端、构建、测试和 CI，在目标 major 内安装最新兼容稳定版，表外依赖取最新兼容稳定版。用更新后的锁文件安装、构建并启动，按项目适用的平台和发布标准验证产物。 |
| 局部功能或故障 | 沿受影响路径检查代码、依赖兼容性和优化机会。只修改解决问题所需的代码、配置和配套依赖。按[验证与优化](references/verification-performance.md)选择受影响路径的验收方法。 |
| 只读巡检、评估或计划 | 从仓库文件、现有产物与上游版本采集证据。交付差距、影响和验证办法，保持项目文件及锁文件原样。 |
| 排查 CI、草稿、更新清单、签名或 winget | 运行 `--ci-only`，按 [CI 陷阱](references/ci-traps.md) 核对命中的 job，按[发布流程](references/release-flow.md)检查实际送达。 |
| 查 .NET 的 TFM 支持期、SDK 下限、rollForward 或 CI 配置 | 运行 `--dotnet`。WPF 的 XAML、DPI、托盘、安装包与单文件发布实现见独立技能 `wpf-desktop`。 |
| 测启动速度、内存或体积 | 先按[性能验证](references/verification-performance.md)记录相同环境下的基准，再测改动。 |

## 运行审计

涉及发布时，查看目标仓库实际触发 tag 的 workflow，从校验、各平台构建追到公开 release 的 job。复核已有发布可用 `gh run view <run-id> --repo <owner/repo>` 查看各 job，再按 tag 核对安装包和公共更新清单。

从任意工作目录调用本技能随附的脚本。将 `{SKILL_DIR}`、`<repo>` 换成实际路径，报告路径相对于当前工作目录。在线模式可从环境读取 `GH_TOKEN` 或 `GITHUB_TOKEN`。

```sh
node "{SKILL_DIR}/scripts/audit.mjs" "<repo>" --out audit.json
node "{SKILL_DIR}/scripts/audit.mjs" "<repo>" --ci-only
node "{SKILL_DIR}/scripts/audit.mjs" "<repo>" --dotnet
node "{SKILL_DIR}/scripts/audit.mjs" "<repo>" --offline --json
```

审计只读项目，不运行应用脚本。`--out` 只创建指定的新文件。退出码 **0** 表示范围内采集完整，**2** 表示离线、限流、无法解析或范围受限，其他非零码表示调用失败。先读 warnings/errors，再判断优先级；离线结果仍可用于定位本地问题。

## 判断与交付

- [House style](references/house-style.md) 给出了平台矩阵、包管理器和 Action 的做法。保留已有包管理器和明确的平台要求。与目标大版本冲突的支持要求要列为具体阻碍。
- 用锁文件、仓库代码及[上游原文](references/sources.md)核实审计线索。`usageHints`、CI 字符串和带日期的[迁移案例](references/adopt-checklist.md)需要结合项目核对。整体升级时用包管理器补查框架审计未覆盖的依赖。
- 交付时写清检查了什么、发现依据、实际改动，以及运行了哪项验证。性能收益按[验证与优化](references/verification-performance.md)在相同条件下对比。缺少运行环境的结论标为待验证。完整在线报告审阅后，按[报告与基线](references/report-and-baseline.md)用 `review-baseline.mjs` 记录已读的 release，复查时传 `--since-baseline`。
- 新建或升级交付可运行的改动、实际解析版本和验证结果。仍有版本差距时列出包名、具体约束和复查条件，继续完成其余升级。应用内更新涉及的发布验收要从已安装的 N 走通 N+1，确认下载、验签、重启与数据保留。远程 tag、公开 release、secrets 与 winget 按用户授权处理。
