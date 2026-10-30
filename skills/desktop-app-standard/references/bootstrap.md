# Bootstrap：新桌面应用

目标：第一天就具备多平台发布、自动更新和持续版本跟进，而不是“先做功能，发布以后再说”。
先查已安装的 `nextjs-to-tauri` / `nextjs-to-electron` 技能：若用户从 Next.js 迁移，用它们完成前端改造，本文件只负责版本、CI 与发布骨架。

## 1. 选框架（见 house-style.md）

默认 Tauri v2；需要 Chromium 一致性或 Node 原生生态时选 Electron + electron-builder。先在线核验当前稳定版（`audit.mjs` 或 registry），不要抄本文件里的数字。

## 2. 脚手架（npm）

```bash
# Tauri
npm create tauri-app@latest      # 选 TypeScript + 所需前端框架；package.json 会有 "tauri": "tauri" 脚本
# Electron：选一个带 electron-builder 的模板，或在现有前端中加入：
npm view electron electron-builder electron-updater version   # latest stable at bootstrap
npm i -D electron electron-builder && npm i electron-updater
npx install-electron             # Electron ≥ 42 不再在 postinstall 下载运行时
git add package-lock.json        # 锁文件入库；CI 用 npm ci
```

已有的 Yarn/pnpm 项目不迁；复制模板时把 `cache: npm` + `npm ci` 换成对应写法（模板注释里有）。

Electron 三件套从 npm `latest` 取；不要装 `electron-builder@next` / `electron-updater@next`（27 / 7 alpha）做稳定应用。`npm latest` 是安装目标，dist-tags 里的 `vNN` 可能领先一个 patch；要立即拿这个稳定补丁就装 `@vNN`，否则等 `latest` 追平，`audit.mjs` 会把 GitHub 更新的 release 标出来。原生模块用 `@electron/rebuild`，旧名 `electron-rebuild` 已弃用。

`create-electron-app` 生成的是 Electron Forge 项目；要按 house style 用 electron-builder，就不要用它，或在第一天迁移。

## 3. 安全默认

- **Tauri**：capabilities 按窗口最小授权；只启用需要的插件；CSP 明确；Rust command 校验输入与路径。
- **Electron**：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；preload 用 `contextBridge` 暴露窄 API；限制导航/新窗口；启用适用的 fuses。

## 4. 自动更新（第一天就接）

- **Tauri**：`npm run tauri signer generate -- -w ~/.tauri/<app>.key`；公钥写入 `plugins.updater.pubkey`，endpoint 用 `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`；`bundle.createUpdaterArtifacts: true`；私钥与密码存入 secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`，离线备份——丢了旧用户就无法再更新。
- **Electron**：electron-builder 配置 `publish: { provider: github }`；Windows target `nsis`，macOS `dmg`+`zip`，Linux `AppImage`+`deb`+`rpm`；主进程 `autoUpdater.checkForUpdatesAndNotify()`（electron-updater）。

## 5. 版本单一来源

- package.json `version` 为准；Tauri `tauri.conf.json` 写 `"version": "../package.json"`。
- 发版：`npm pkg set version=x.y.z`（与包管理器无关，只改 package.json）→ 提交 → `git tag vX.Y.Z` → 推送 tag。

## 6. 复制 CI 文件

| 模板 | 放到 |
|---|---|
| templates/workflows/ci.yml | `.github/workflows/ci.yml` |
| templates/workflows/release-tauri.yml 或 release-electron.yml | `.github/workflows/release.yml` |
| templates/desktop-policy.example.json | `.desktop-policy.json`（只在需要偏离时写 deviations） |

模板里的 Action 钉的是**大版本标签**（house style）。复制后先跑 `node scripts/audit.mjs <repo> --ci-only`，按报告里的 `action-major-behind` 升大版本。仓库设置：创建 `release` environment 并设 required reviewers；Actions 默认 token 保持只读（模板按 job 提权）。

## 7. 首次发布检查

1. `node scripts/audit.mjs <repo>`：框架 P0/P1 和 CI P0 为零。
2. 推 `v0.1.0`：构建 job 全绿（Tauri 矩阵 6 个；Electron 每 OS 一 job，3 个）；草稿只有一个；`latest.json` / `latest*.yml` 覆盖所有平台。
3. 审批 `release` environment 后，`releases/latest` 指向新 tag，匿名可下载 feed。
4. 在每个 OS 上安装 v0.1.0，再发 v0.1.1，验证**真实的 N→N+1 更新**（下载、验签、安装、重启、数据保留）。这一步之前不要对外宣布“自动更新可用”。
5. 签名未就绪时，release 说明写明 SmartScreen / Gatekeeper 提示与打开方式。
6. 要上 winget：把新应用加进 `winget-manifests` 的 `apps.json`（清单由那条流水线生成并开 PR），**不要**在本仓里再提交一份 manifest。
7. 只有**不在** winget-manifests 流水线里的发布者：首个版本手工提交到 microsoft/winget-pkgs，之后取消 release 模板里 winget job 的注释，设 `vars.WINGET_ID` 与 `secrets.WINGET_TOKEN`。两条路只能选一条。
