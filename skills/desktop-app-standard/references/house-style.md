# House style（默认做法，核验于 2026-10-28）

用户确认（2026-10-23）：**按当前最新推荐做法执行，不受早期草稿限制**；尽量多平台、主要用 npm、Action 钉大版本标签、不装 Dependabot。
本文件是默认值，不是固定版本表。具体版本只在运行时从官方来源取；每次运行仍以官方来源重新核验，若上游推荐变了，按新推荐更新本文件并在报告中说明。

## 优先级

1. 用户本次明确要求。
2. 项目 `.desktop-policy.json` 中**有 reason 与 revisitWhen 的偏离**（见 templates/desktop-policy.example.json）。
3. 本 house style。
4. 上游默认值。

项目里未声明原因的旧做法不是“项目约定”，而是**漂移**：报告差距、给出迁移 PR 方案，不悄悄保留，也不未经授权直接改。

## 平台与产物

| 平台 | 架构 | 正式（可更新）产物 | 便捷产物 |
|---|---|---|---|
| Windows | x64、arm64 | NSIS 安装包 | portable zip（明确标注不自动更新） |
| macOS | arm64、x64（Tauri 分架构；Electron 同一 job 双架构） | dmg；更新载体 Tauri `.app.tar.gz` / Electron zip | — |
| Linux | x64、arm64 | AppImage（自动更新载体）+ deb + rpm | Flathub/Snap 按需另议 |

- 默认覆盖全部 6 个目标。runner 不可用（如私有仓库没有 arm runner）时用交叉编译或在 policy 中声明偏离，不静默缩减。
- Linux 构建用 ubuntu-22.04（较旧 glibc，兼容面更广）；只有依赖要求时才升级。
- 安装包是正式产物；portable 只是便利。updater 指向的必须是可被替换的安装产物。

## 工具链

- **Node**：当前 Active LTS（按 nodejs/Release 官方 schedule 判定，不写死 major）。
  - CI 钉具体 major 以便复现；`audit.mjs` 会在该线进入 maintenance/EOL、落后于最新 LTS 时报出来。**不要写 `node`/`latest`**：那会跟到非 LTS 的 Current 线。
  - `engines.node` 与 CI 钉版是**两件事，不要混**：`engines` 表达「这段代码最低能在什么 Node 上跑」，CI 钉版表达「这次发版用什么版本构建」。`engines` 的下限应当**从工具链自己的 `engines` 约束里取**（如 ESLint 10 要求 `^20.19.0 || ^22.13.0 || >=24`、Vite 8 要求 `^20.19.0 || >=22.12.0`，取其交集并排除已 EOL 的线），而不是抄 CI 的 major——照抄会声明一个根本装不起来的下限（Vite 8 装不上 Node 18），也会让 Node 20 这类已 EOL 的线继续被声称支持。
  - `.nvmrc` / `.node-version` 是**可选**的便利件，给本地开发指个版本用；它不是契约，也不必与 `engines` 一致。**少一处要同步的东西。**
  - `audit.mjs` 的 P 级只针对 CI 的 `node-version` / `node-version-file`；本地 `.nvmrc` 过期只作 Heads-up。
  - Node 只是构建工具，不是应用运行时（Electron 内置 Node，版本由 Electron major 决定）。
- **npm**：默认包管理器。CI 用 `npm ci`（锁文件入库，按 `integrity` 校验），本地用 `npm i`。锁文件是唯一事实来源。
  - Yarn / pnpm / bun 项目不强迁：脚本照样能读它们的锁文件。存量 Yarn 1 项目 CI 必须 `--frozen-lockfile`；真要迁 Yarn 4 时单独一个 PR。
  - 没有 Dependabot 也就没有自动冷却期：新版本不当天就升——读懂 release notes，再由人决定何时升。
- **Rust（Tauri）**：stable toolchain；Cargo.lock 入库；遵守目标 crate 的 MSRV。

## 框架选择（新应用）

- **Tauri v2**：默认首选（体积、内存、权限模型）。JS `@tauri-apps/api` 与 Rust `tauri` 同 minor；官方插件 JS/Rust 同版本。
- **Electron**：需要 Chromium 一致渲染、Node 生态或现有 Electron 代码时选用。打包用 **electron-builder + electron-updater**：它是三平台（含 Linux AppImage）都有自动更新的主流方案。Electron 官方默认推荐 Forge；已用 Forge 的项目继续用 Forge，不为风格迁移。
- 跟随受支持的最新稳定 major：Electron 只支持最新 3 个 major，落在最旧一条即 P1、落出即 P0。不要求每个新 major 当天就上；升级目标用 npm `latest` 的稳定版，但 major 升级仍是一个要读 release notes 的决定。
- 安装/初始化用 npm `latest` 的 `electron`、`electron-builder`、`electron-updater`；不要用 `next`（27 / 7 alpha）做稳定应用。`vNN` 标签可能比 `latest` 早一个 patch：要最新稳定补丁就装 `@vNN`，否则等 `latest` 追平。

## 版本与发布

- **git tag `vX.Y.Z` 是唯一版本源**。发版提交先改 package.json（Tauri 的 `tauri.conf.json` `version` 指向 `"../package.json"`），再打 tag；release workflow 断言一致，不一致即失败。
- 发布流：`validate`（tag⇄版本、测试）→ 单一草稿 → 矩阵构建上传 → `publish`（校验 feed/资产、LF SHA256SUMS、provenance attestation、protected environment 人工审批、`draft=false make_latest=true`、匿名检查 `releases/latest` 与 feed）。
- release workflow 只在默认分支维护；tag 运行的是**被打 tag 的提交里的 workflow 文件**。要发布特性分支代码，用 workflow_dispatch + 指定 ref，而不是在分支里改 workflow。
- 测试门禁在同一文件内（`needs: validate`）；红树不发布。
- 流水线稳定后开启 GitHub **immutable releases**：资产只能在草稿阶段上传，发布后 tag 与资产锁定，修复只能 forward-fix 新版本。
- 多个应用共用一个发布仓库（release hub）时，tag 加应用前缀（如 `appA-v1.2.3`），两边都从 tag 推导名称和版本。

## 签名

| 层 | 默认 |
|---|---|
| Tauri updater 签名 | 必须；私钥只在 secrets；不随意轮换（旧客户端只信旧公钥） |
| Windows | 公开分发后签名，首选 Azure Artifact Signing；未签名期间在 release 说明提示 SmartScreen |
| macOS | Developer ID + 公证；没有 Apple 账号时 Tauri 用 ad-hoc（`signingIdentity: "-"`）并写明打开方式；Electron 未签名则 macOS 只能手动更新 |
| Linux | 无系统签名；SHA256SUMS + attestation |

## winget

- winget 是 Windows 的次要渠道，GitHub Release 才是事实来源。
- **清单归 winget-manifests 仓管**：那边 `apps.json` 是唯一源，它自己巡检各发布仓的 release，重生成 manifest 并往 winget-pkgs 开 PR。发布仓**不提交清单**——加进 `apps.json` 即可。
- **一种机制**：两条路写同一个包，等于开两个 PR，第二个被当重复拒掉，看起来就像「winget 坏了」。
- 不在那个流水线里的发布者，才在发布工作流的最后一个 job（`needs: publish`，仅稳定版）用 winget-releaser（基于 Komac）提交；需要 classic PAT（`public_repo`、`workflow`）存为 `WINGET_TOKEN` 并做预检；首个版本手工提交。
- 不依赖 `on: release: published`：用 GITHUB_TOKEN 发布的 release 不触发其他 workflow。

## 依赖与 Action

- Action 一律**大版本标签**（`@v7`）：补丁随标签自动到手，升级大版本是**一个决定**而不是每次顺手改哈希。
  - **不钉完整 SHA**：SHA 钉死换来的那点供应链收益，代价是每次升级都要手工改哈希——而在实践中，那个哈希就永远不动了。要更紧时钉**精确版本**（`@v7.0.1`）：仍可人工升级，但不再随 tag 漂移。
  - 唯一例外是**能写产物**的 Action（release 创建、attestation、上传）：被接管时受影响的正是用户下载到的东西。house style 仍用大版本标签，但这一类值得单独提出来看——`audit.mjs` 把它们列为 `notice`（`action-moving-ref`），不计入 P0/P1/P2。
- **不装 Dependabot**：它自动开 PR，而这里的升级多数要连带改代码、连带跑一次真实更新验证，人工过一遍更省事。

## 应用默认体验

- 不默认开机自启；关闭到托盘由产品需求决定；主题跟随系统；遥测默认关闭，开启需声明并获同意。
- Electron：`contextIsolation`、`sandbox`、禁用 `nodeIntegration`、严格 CSP、窄 IPC。Tauri：最小 capabilities，Rust command 边界校验输入。

## 何时重新评估

上游改变推荐（如 Tauri pipeline 文档、electron-builder 签名方式、GitHub runner/attestation 变化）、平台签名政策变化、用户群出现新平台/架构需求、或某条偏离到了 revisitWhen。
