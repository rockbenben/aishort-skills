# Bootstrap：新桌面应用

目标：第一天就具备多平台发布、自动更新和持续版本跟进，而不是“先做功能，发布以后再说”。
先查已安装的 `nextjs-to-tauri` / `nextjs-to-electron` 技能：若用户从 Next.js 迁移，用它们完成前端改造，本文件只负责版本、CI 与发布骨架。

## 1. 选框架（见 house-style.md）

默认选 Tauri 2。需要 Chromium 一致性或 Node 原生生态时选 Electron + electron-builder，组件大版本见[技能目标表](version-targets.json)。

## 2. 脚手架（npm）

```bash
# Tauri
# 从 create-tauri-app 的发布说明选仍生成目标框架大版本的脚手架，将实际版本赋给 scaffoldVersion
npm create "tauri-app@${scaffoldVersion:?先设置脚手架版本}"
# Electron：选一个带 electron-builder 的模板，或在现有前端中加入：
# 从目标大版本表和包源取三个实际稳定版本，分别赋给以下变量
npm i -D "electron@${electronVersion:?}" "electron-builder@${builderVersion:?}"
npm i "electron-updater@${updaterVersion:?}"
npx install-electron             # Electron ≥ 42 不再在 postinstall 下载运行时
# 保留生成的 package-lock.json，CI 用 npm ci
```

Electron 新项目需要可执行入口：在 package.json 指定主进程文件，为开发启动和打包配置 scripts，在主进程创建 BrowserWindow 并加载项目的页面。先启动生成的应用，再接发布模板。已有 Yarn/pnpm 项目沿用其锁文件和包管理器，复制模板时同步调整安装和缓存步骤。

脚手架生成后，按[依赖升级](upgrade-dependencies.md)逐项更新应用、前端和打包工具，核对并保留锁文件。Electron 原生模块按目标版本使用配套的 rebuild 工具。

`create-electron-app` 生成的是 Electron Forge 项目；要按 house style 用 electron-builder，就不要用它，或在第一天迁移。

## 3. 安全默认

- **Tauri**：capabilities 按窗口最小授权；只启用需要的插件；CSP 明确；Rust command 校验输入与路径。
- **Electron**：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；preload 用 `contextBridge` 暴露窄 API；限制导航/新窗口；启用适用的 fuses。

## 4. 自动更新（第一天就接）

- **Tauri**：`npm run tauri -- signer generate -w ~/.tauri/<app>.key`；公钥写入 `plugins.updater.pubkey`，endpoint 用 `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`；`bundle.createUpdaterArtifacts: true`；私钥与密码存入 secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`，离线备份——丢了旧用户就无法再更新。
- **Electron**：electron-builder 配置 `publish: { provider: github }`；Windows target `nsis`，macOS `dmg`+`zip`，Linux `AppImage`+`deb`+`rpm`；主进程 `autoUpdater.checkForUpdatesAndNotify()`（electron-updater）。

## 5. 版本单一来源

- package.json `version` 为准；Tauri `tauri.conf.json` 写 `"version": "../package.json"`。
- 发版：`npm pkg set version=x.y.z`（与包管理器无关，只改 package.json）→ 提交 → `git tag vX.Y.Z` → 推送 tag。

## 6. 复制 CI 文件

| 模板 | 放到 |
|---|---|
| [references/version-targets.json](version-targets.json) | `.github/desktop-version-targets.json`，与工作流一起纳入版本控制 |
| templates/workflows/ci.yml | `.github/workflows/ci.yml` |
| templates/workflows/release-tauri.yml 或 release-electron.yml | `.github/workflows/release.yml` |
| templates/desktop-policy.example.json | `.desktop-policy.json`（只在需要偏离时写 deviations） |

模板里的 Action 标签和 Node 版本来自编写时的环境。复制后核实当前的稳定 release、Active LTS 及 runner 要求，实际更新工作流。随后执行 `node "{SKILL_DIR}/scripts/audit.mjs" "<repo>" --ci-only` 复查。发布审批和 token 权限见[发布流程](release-flow.md)。

## 7. 首次发布检查

1. `node "{SKILL_DIR}/scripts/audit.mjs" "<repo>"`：框架 P0/P1 和 CI P0 为零。
2. 推 `v0.1.0`：构建 job 全绿（Tauri 矩阵 6 个；Electron 每 OS 一 job，3 个）；草稿只有一个；`latest.json` / `latest*.yml` 覆盖所有平台。
3. 审批 `release` environment 后，`releases/latest` 指向新 tag，匿名可下载 feed。
4. 在每个 OS 上安装 v0.1.0，再发 v0.1.1，验证**真实的 N→N+1 更新**（下载、验签、安装、重启、数据保留）。这一步之前不要对外宣布“自动更新可用”。
5. 签名未就绪时，release 说明写明 SmartScreen / Gatekeeper 提示与打开方式。
6. 要上 winget：把新应用加进 `winget-manifests` 的 `apps.json`（清单由那条流水线生成并开 PR），**不要**在本仓里再提交一份 manifest。
7. 只有**不在** winget-manifests 流水线里的发布者：首个版本手工提交到 microsoft/winget-pkgs，之后取消 release 模板里 winget job 的注释，设 `vars.WINGET_ID` 与 `secrets.WINGET_TOKEN`。两条路只能选一条。
