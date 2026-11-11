---
name: desktop-app-standard
description: Build, maintain or audit Tauri/Electron desktop apps, including dependencies, packaging, updates and CI. Next.js shell migration uses the corresponding nextjs-to-tauri or nextjs-to-electron Skill. 支持只读巡检，以及明确请求的 .NET SDK/TFM 静态审计；局部修复按受影响路径实施。

metadata:
  version: "0.9.15"
  openclaw:
    homepage: https://github.com/rockbenben/aishort-skills/tree/main/skills/desktop-app-standard
    emoji: "📐"
    requires:
      bins: ["node"]
    files:
      - scripts/audit.mjs
      - scripts/core.mjs
      - scripts/app-context.mjs
      - scripts/ci-traps.mjs
      - scripts/delivery-checks.mjs
      - scripts/dotnet.mjs
      - scripts/review-baseline.mjs
      - scripts/checksums.mjs
      - scripts/release-assets.mjs
      - references/house-style.md
      - references/bootstrap.md
      - references/upgrade-dependencies.md
      - references/version-targets.json
      - references/release-flow.md
      - references/workflow-examples.md
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
      - templates/winget-readiness.example.json
      - templates/performance-record.md
---

# Desktop App Standard

从应用所属 workspace、锁文件和构建入口确认使用的框架及实际版本。每次都主动检查与任务相关的升级和优化机会。检查范围由用户的目标决定，用户指定的组件、平台、版本和只读要求优先。

## 按目标选择入口

| 用户目标 | 检查、实施与验收 |
| --- | --- |
| 只给技能与仓库，或笼统要求维护 | 先运行在线审计，再按 [Tauri](references/tauri.md) 或 [Electron](references/electron.md) 检查框架配对、安全配置、启动与资源、打包和更新链路，并对照 [CI 模板](templates/workflows/ci.yml) 检查实际测试矩阵和门禁。用代码、锁文件或产物核实发现，落实范围内可验证的修复与 CI 缺口；其余差距说明阻碍和复查条件。 |
| 新建、整体升级或按本技能全面改造 | 新项目先按[起手步骤](references/bootstrap.md)生成骨架。按[目标大版本表](references/version-targets.json)与[依赖升级](references/upgrade-dependencies.md)实际更新框架、前端、构建、测试和 CI，在目标 major 内安装最新兼容稳定版，表外依赖取最新兼容稳定版。用更新后的锁文件安装、构建并启动，按项目适用的平台和发布标准验证产物。 |
| 局部功能或故障 | 沿受影响路径检查代码、依赖兼容性和优化机会。只修改解决问题所需的代码、配置和配套依赖。按[验证与优化](references/verification-performance.md)选择受影响路径的验收方法。 |
| 只读巡检、评估或计划 | 从仓库文件、现有产物与上游版本采集证据。交付差距、影响和验证办法，保持项目文件及锁文件原样。 |
| 排查 CI、草稿、更新清单、签名或 winget | 运行 `--ci-only`，按 [CI 陷阱](references/ci-traps.md) 核对命中的 job，按[发布流程](references/release-flow.md)检查实际送达。 |
| 查 .NET 的 TFM 支持期、SDK 下限、rollForward 或 CI 配置 | 运行 `--dotnet`。WPF 的 XAML、DPI、托盘、安装包与单文件发布实现见独立技能 `wpf-desktop`。 |
| 测启动速度、内存或体积 | 先按[性能验证](references/verification-performance.md)记录相同环境下的基准，再测改动。 |

## CI 与发布的日常检查

新建和全面维护时先确认实际分发渠道，再分别报告 PR 测试和 tag 交付的证据。GitHub Releases 项目采用下表的发布链；商店、内部或人工分发项目记录其现有交付入口与验收。已有工作流达到同等结果时沿用其结构。维护时按推荐的平台与产物矩阵补齐缺口；历史发布类型较少本身不构成缩减目标。用户当前明确要求和实际兼容性约束优先。相同可执行文件已打入便携 ZIP 时通常只发布 ZIP，更新协议必需的载体、签名和清单仍需保留。局部任务按受影响路径检查；只读任务给出差距与改法。

| 应用 | 推荐入口 | 构建与发布责任 |
| --- | --- | --- |
| Tauri | [release-tauri.yml](templates/workflows/release-tauri.yml) | 官方 tauri-apps/tauri-action 使用 releaseDraft: false 直接发布，矩阵完成后核对 updater 平台覆盖并附加摘要。 |
| Electron builder/updater | [release-electron.yml](templates/workflows/release-electron.yml) | 平台构建显式 --publish never；单一 publish 检查本地更新清单和摘要后用 softprops/action-gh-release 直接公开。示例只接受稳定版，beta 项目按真实 channel 生成和校验清单。 |
| PR 检查 | [ci.yml](templates/workflows/ci.yml) | 使用实际应用工作目录、锁文件和 scripts；覆盖承诺的平台及受影响的打包运行路径。 |

复制和改造按[模板适配步骤](references/bootstrap.md#适配已有应用的-workflow)。检查项至少包含所测提交、测试发现数量或结果、各平台产物、最终签名与摘要、公开后的 feed 和下载入口。默认直接发布；审批、草稿、provenance 和额外构建证据按项目明确要求配置。大型项目参考见[工作流实例](references/workflow-examples.md)。reusable workflow 追到被调用文件和固定版本核实。

默认 Tauri 模板调用 release-assets.mjs 的 verify-release，检查公开资产归属、六平台 feed、签名对应和真实 SHA256；Electron 在 tag 校验中调用 delivery-checks.mjs 检查有效 NSIS 英文配置。随模板复制所声明脚本，按[适配清单](templates/release-plan.md)核对外置文件、缓存架构、实际更新方式与中央 winget 完整资产门禁。audit.mjs 也输出已知源码分发陷阱，静态候选需结合实际入口验证。

## 运行审计

涉及发布时，查看目标仓库实际触发 tag 的 workflow，从校验、各平台构建追到公开 release 的 job。复核已有发布可用 `gh run view <run-id> --repo <owner/repo>` 查看各 job，再按 tag 核对安装包和公共更新清单。

从任意工作目录调用本技能随附的脚本。将 `{SKILL_DIR}`、`<repo>` 换成实际路径。报告、总结和审阅基线统一放在项目的 Git 忽略目录，不在仓库根目录散落或提交；优先使用已有忽略目录，例如 `desktop/release/audit-reports/YYYYMMDD/`，没有则建立专用目录并加入 `.gitignore`。先创建目录，下面的 `<report-dir>` 用其实际路径替换；未指定 `--out` 时只输出到终端。在线模式可从环境读取 `GH_TOKEN` 或 `GITHUB_TOKEN`。

```sh
node "{SKILL_DIR}/scripts/audit.mjs" "<repo>" --out "<report-dir>/audit.json"
node "{SKILL_DIR}/scripts/audit.mjs" "<repo>" --ci-only
node "{SKILL_DIR}/scripts/audit.mjs" "<repo>" --dotnet
node "{SKILL_DIR}/scripts/audit.mjs" "<repo>" --offline --json
```

审计只读项目，不运行应用脚本。`--out` 只创建指定的新文件。退出码 **0** 表示范围内采集完整，**2** 表示离线、限流、无法解析或范围受限，其他非零码表示调用失败。先读 warnings/errors，再判断优先级；离线结果仍可用于定位本地问题。

## 判断与交付

- [House style](references/house-style.md) 给出了平台矩阵、包管理器和 Action 的做法。安装与卸载界面统一英文（含自定义页面、按钮和提示），不随系统或应用语言切换；按其中的配置固定英文，并在中文 Windows 上验收两个向导。保留已有包管理器和明确的平台要求。与目标大版本冲突的支持要求要列为具体阻碍。
- 维护和整体改造时按[发布流程的 CI 门禁](references/release-flow.md)落实适用的模板建议；只读模式只报告、局部修复只动受影响路径。支持契约或有原因与复查条件的 policy 偏离优先；历史注释中的「没在别的平台跑过」是待验证状态，不能单独作为跳过 CI 的理由。配置校验、本机验证和远程 runner 通过要分开报告。
- 用锁文件、仓库代码及[上游原文](references/sources.md)核实审计线索。`usageHints` 和 CI 字符串只是线索，按[升级采用清单](references/adopt-checklist.md)筛选本项目用到的变更。整体升级时用包管理器补查框架审计未覆盖的依赖。
- 交付时写清检查了什么、发现依据、实际改动，以及运行了哪项验证。性能收益按[验证与优化](references/verification-performance.md)在相同条件下对比。缺少运行环境的结论标为待验证。需要跨次复查时，完整在线报告审阅后按[报告与基线](references/report-and-baseline.md)用 `review-baseline.mjs` 记录已读的 release，复查时传 `--since-baseline`；报告与基线留在忽略目录。
- 新建或升级交付可运行的改动、实际解析版本和验证结果。仍有版本差距时列出包名、具体约束和复查条件，继续完成其余升级。应用内更新涉及的发布验收要从已安装的 N 走通 N+1，确认下载、验签、重启与数据保留。远程 tag、公开 release、secrets 与 winget 按用户授权处理。
