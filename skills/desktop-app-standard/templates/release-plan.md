# Release workflow 生成与验收约定

这不是可直接部署的 YAML。基于实际项目与本次核验的官方 Action 参数生成 workflow，避免把过期 runtime/inputs 永久固化在模板中。

## 输入

- 可信 repository、default branch、release commit/tag、版本源与 app-specific tag 规则。
- framework、包管理器与锁文件、工作目录、Node/Rust/toolchain。
- OS/架构矩阵、最低 OS、runner、打包 target、构建/测试/打包命令。
- signing/notarization/更新签名是否就绪（只记录 secret 名称，不记录值）。
- release provider、stable/beta feed、是否 immutable release、是否 winget/商店。

## Jobs 与权限

1. validate 使用只读权限，核对 tag、应用版本和实际检出的提交。用锁文件安装，检查技能目标 major，在该提交执行测试。
2. build 从 validate 取得提交 SHA，矩阵检出该提交逐平台构建。对可信 release 源注入最小签名凭证，打包后验签；不同架构产物唯一命名。
3. aggregate：needs 全部成功的 build；下载和检查资产，合并 updater 平台/架构元数据，计算最终散列。
4. stage：仅此处所需 contents:write；创建/更新同一草稿、上传全部资产；需要时生成 provenance/SBOM。
5. publish 在草稿核验通过后按仓库并发组排队，再核对 tag 指向。稳定新版取得 latest，已有更高稳定版时将旧 tag 公开为历史 release。
6. post-release：只读验证 tag、feed、匿名资产可下载、hash/签名、N→N+1 客户端。若测试需公开影响/付费资源先获授权。

## 栈差异

- Tauri：Windows NSIS（`updaterJsonPreferNsis: true`），macOS dmg + 更新载体 `.app.tar.gz` (.sig)，Linux AppImage + deb + rpm。核验 tauri-action 的 projectPath/args/releaseDraft/更新 manifest 生成选项，更新签名环境变量、所有平台 `.sig` 与 payload；不要让一个矩阵 job 的 latest.json 覆盖另一个。
- Electron-builder：Windows NSIS，macOS dmg + zip（MacUpdater 必须），Linux AppImage + deb + rpm。打包器 publish 与独立发布器只选明确的责任边界；常见做法先 `--publish never` 再统一上传。核验 provider 生成的 yml、blockmap、各平台 target；Forge 项目使用对应发布链，不照搬 builder 参数。
- WPF / .NET 原生桌面：Windows 推荐「三轨分发矩阵」（1. 免 UAC Inno Setup 6 / NSIS 安装包 + 2. 自包含便携 Zip + 3. 框架依赖精简 Zip），按 `wpf-desktop` 的 `project-setup.md` 与 `github-actions.md` 执行。
- 生成工作流时先核对 Action 的稳定 release 与 runner 要求。新项目默认大版本标签，已有项目沿用其 pin 策略。

## 生成后必须检查

- YAML/actionlint 与 GitHub 平台校验；本地 lint 不等于 GitHub 真跑成功。
- PR 无私钥/token；trusted commit 在构建和发布间不变；所有必需平台成功才公开。
- draft 是预期阶段；已发布不可变资产不追加/覆盖；rerun 不误重复 publish。
- manifests 引用最终签名文件且各平台齐全；校验旧 updater 读取兼容性。
- stable/beta 分离；用户数据/签名身份/更新公钥无意外变化。
- 哪些命令实测，哪些依赖环境、签名凭证和批准而未执行，逐项说明。
