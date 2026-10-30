# desktop-app-standard · 0.7.3

> Tauri / Electron 桌面应用的**新建骨架、版本巡检、升级与多平台发布检查**，以及 **.NET 运行时/SDK 审计**（`--dotnet`）Skill。

默认做法（house style）按 2026-10-28 核验的最新推荐：Windows/macOS/Linux × x64/arm64、npm（`npm ci`）、Action 钉大版本标签、不装 Dependabot、草稿→校验→审批→发布、内置 updater、公开后签名、winget 清单归 winget-manifests。

## 安装

解压后把整个 `desktop-app-standard/` 目录放进代理宿主的 Skill 目录（保持 scripts/references/templates 结构）。.NET 运行时/SDK 生命周期用 `--dotnet` 审计；WPF 的 XAML/DPI/托盘与构建发布实现由 `wpf-desktop` 负责。

## 常用提示词

```text
用 desktop-app-standard 巡检 /path/to/app：最新稳定版、支持窗口、配对、上游变更是否影响本应用，以及 GitHub Actions 发布链路。只读，不改代码。
```
```text
用 desktop-app-standard 给新的 Tauri 应用搭发布骨架：多平台、自动更新、发布校验。
```
```text
用 desktop-app-standard 把 /path/to/app 升到最新 Electron。允许改本地文件并跑测试，不要推送或发布。
```
```text
用 desktop-app-standard 审计 /path/to/wpf-app 的 .NET 运行时/SDK：TFM 支持期、EOL，以及 global.json 的 SDK pin/rollForward。只读，不改代码。
```

## 直接运行

需要 Node.js 22+（脚本自身要求；桌面项目按 house style 用当前 Active LTS）。零第三方依赖，不执行项目代码。

```bash
GH_TOKEN=$(gh auth token) node scripts/audit.mjs /path/to/app --out /tmp/audit.json
node scripts/audit.mjs /path/to/app --ci-only        # 只查 .github/workflows
node scripts/audit.mjs /path/to/app --dotnet         # .NET TFM/SDK/支持期 + CI 检查
node scripts/audit.mjs /path/to/app --offline --json # 无网络
node --test tests/*.test.mjs
```

- 读取 npm / Yarn classic / Yarn berry / pnpm / bun 锁文件与 Cargo.lock，按 governing lock 报告实际解析版本。
- 在线：npm/crates 最新版、Electron 支持窗口（releases.json）、Node 工具链（nodejs/Release schedule，CI pin 是否仍为 LTS；`.nvmrc` 过期只作提示）、Tauri 插件 JS⇄Rust 配对与 CHANGELOG 段落、electron-builder/updater release notes、Action 最新 release 与 `suggestedPin`（最新大版本标签）、.NET release metadata（TFM 支持期/EOL、latest SDK/runtime）。
- `--dotnet`：扫 `.csproj/.fsproj/.vbproj` 与 `Directory.Build.props`，解析 `TargetFramework(s)`（含旧式 `TargetFrameworkVersion`）和最近的 `global.json`；按官方 `rollForward` 语义判断 pin 能否到最新。报告 `dotnet`（projects/globalJson/channels）与 `dotnet-*` 发现；不执行 `dotnet`/MSBuild。
- `ciFindings`：38 条 workflow 陷阱 + 5 条仓库级发现 + 3 条在线 Node 工具链发现（[references/ci-traps.md](references/ci-traps.md)），另有 `--dotnet` 的 .NET SDK 来源检查（two-sources / shadow / setup 缺失）；`notice`（符合 house style 的提示）与 `.desktop-policy.json` 接受的偏离单列，不计入 P0/P1/P2。
- 退出码：0 完整；2 不完整（离线/限流/不可读）；其他为执行错误。只有 `--out` 会写文件，且拒绝覆盖。

## 模板（templates/）

| 文件 | 用途 |
|---|---|
| `workflows/ci.yml` | PR 检查，只读、无 secrets（Tauri 步骤按 `src-tauri/Cargo.toml` 自动跳过） |
| `workflows/release-tauri.yml` | Tauri 六目标矩阵 + 唯一草稿 + 校验发布 + winget |
| `workflows/release-electron.yml` | Electron 每 OS 一 job 双架构 + 单一 publish + winget |
| `desktop-policy.example.json` | house style 与带理由的偏离（`rule` 可以是平台，也可以是任一发现 id） |

模板中的 Action 大版本标签核验于 2026-10-23；模板默认 npm，存量 Yarn/pnpm 仓库按注释换安装行（漏改会报 `npm-ci-without-lockfile`）。模板的 Node major 是 bootstrap 起点，不是永久值：复制后跑 `audit.mjs --ci-only`，`node-version-*` 会指出它是否已落后于 LTS。首次使用前跑 `audit.mjs --ci-only`（.NET 项目用 `--dotnet`），并在真实仓库中跑一次完整发布与 N→N+1 更新。

## 从旧版升级

替换整个目录（0.3.x 时叫 `desktop-version-watch`）。报告 JSON 仍为 schemaVersion 3，0.5.1 起新增字段：`severity: "notice"`、`accepted`、`summary.ci.notice`、`summary.ciAccepted`；0.6.0 起新增 `--dotnet`、`dotnetRequested` 与 `dotnet`（projects/globalJson/channels）；0.6.2 起 `.desktop-policy.json` 的偏离也能接受 framework finding，并新增 `summary.frameworkAccepted`；0.6.3 起 release 模板兼容 `latest.json` 的 API asset URL，`tauri-linux-deps` 只按真正构建 Tauri 的 Ubuntu job 报；0.6.4 移除 `version-watch` 模板与 `no-version-watch` 审计项；0.6.5 新增 `nodeSupport` / `nodePins` 与 `node-version-*` 在线检查，模板默认 Node 26（bootstrap 起点，不是永久值）；0.7.0 新增 `mac-update-needs-zip`（Electron 的 mac 目标缺 zip 时报 P1——只有 dmg 时 macOS 的应用内更新必失败）、Electron 发布模板补上 electron-builder 的资产改名（`--publish never` + 手动上传时上游那次改名不发生，清单会指向不存在的资产、更新 404）、`electron-runtime-download` 的影响描述按实测改写、打包产物里的 manifest 副本不再算版本来源；0.7.1 修掉 Electron 发布模板里一个**实测踩到**的坑：GitHub 把「没有这个 secret」渲染成空字符串，而 electron-builder 把空的 CSC_LINK 理解成「证书就是这个路径」，于是拿工作目录当证书去签，macOS 那条腿直接失败（Windows/Linux 不受影响，看着像平台问题）。模板改为只在凭据真的存在时才导出，并新增 `electron-builder-empty-csc-link`（P1）自动报出；0.7.1 同一轮还发现 Windows runner 的默认 shell 是 PowerShell，多行 bash 脚本在那条腿会 ParserError（macOS/Linux 照常通过），模板的 Build 步骤显式 `shell: bash`，并新增 `bash-script-on-windows-runner`（P1）报出；0.7.2 移除 `node-version-source-mismatch`——house style 已把 `.nvmrc`/`.node-version` 定为可选本地便利件，P 级 Node 检查只看 CI 的 `node-version`/`node-version-file`，本地文件过期只作 Heads-up；0.7.3 把 Electron 快照更新到 45.1.0（Chromium 156.0.8078.49 / Node 24.22.1），补 45.1 的 `session.registerPreloadScript` URL/origin 过滤、45.x 特性（badge/Linux progress/memory/printToPDF/caret browsing）与当前偏好（sandboxed preload 能力、safeStorage async、display-capture、`@electron/rebuild`），并记录 electron-builder 26.18.0 / electron-updater 6.8.11 的 `latest` 与 `v26` 领先 patch 的差异。旧基线（schema 2/3）仍可读取。已删除 `templates/dependabot.yml`——仓库里装过的 `.github/dependabot.yml` 要手动删。.NET 运行时/SDK 生命周期用 `--dotnet`；WPF 构建/发布见 `wpf-desktop`。本仓不给每个技能留 changelog：版本号在 `SKILL.md` 的 frontmatter，变更看 git 历史。
