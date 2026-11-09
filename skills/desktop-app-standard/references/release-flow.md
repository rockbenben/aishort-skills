# Release flow（Tauri & Electron，多平台）

模板：`templates/workflows/release-tauri.yml`、`release-electron.yml`、`ci.yml`。本文件解释每一段为什么存在，方便在已有工作流上做最小修改。

## 跨栈发布基线（Tauri / Electron / WPF 共用）

无论哪套桌面栈，发布卫生都按这一节；本文件其余部分是 Tauri/Electron 的具体实现，WPF 的实现见 `wpf-desktop/github-actions.md`。

- **版本单一来源**：git tag `vX.Y.Z`；发布提交先同步 `package.json` / `tauri.conf.json` / csproj 的版本，workflow 断言 tag 与产物版本一致。
- **workflow 只在默认分支**；tag 运行的是被打 tag 的提交里的 workflow 文件。测试门禁在同一文件内（`needs: validate`），红树不发布。
- **单一草稿 → 校验 → 人工审批 → 发布**：校验资产/updater feed/`SHA256SUMS`，`draft=false make_latest=true` 后断言 API `releases/latest` 指向本 tag。`releases/latest` 忽略草稿和预发布——草稿没人发布 = 构建全绿、没人收到更新。
- **每个发出去的资产都有 SHA256（LF）**，并由 `actions/attest` 生成来源证明；签名在打包之后、算哈希之前。用户能 `gh attestation verify`。
- **签名**：Windows 公开发布后签（Azure Artifact Signing 优先）；macOS Developer ID + 公证；Tauri 更新另需 `TAURI_SIGNING_PRIVATE_KEY`。未签名时在 release 说明写明 SmartScreen/打开方式。
- **winget 只留一条路**：清单归 `winget-manifests`（`apps.json` 唯一源，发布仓不提交）；不在那条流水线的发布者才在 `publish` 之后用 `needs: publish` 提交。不要依赖 `on: release: published`（GITHUB_TOKEN 发布的 release 不触发）。
- **Action 用大版本标签**；不装 Dependabot。
- **产物组织与非自更新说明**：Tauri/Electron 的 Windows 正式产物一律为 NSIS 安装包（以配合其内置 auto-updater）；portable zip/exe 仅作免安装试用，不可自动更新，UI 与 release 说明需写明。（若为 .NET/WPF 原生应用，发布产物按 `wpf-desktop` 的「三轨分发矩阵」执行）。
- **发布后匿名核验**：`releases/latest`、资产/feed 可下载；每个平台实测 N→N+1。

## 总流程

```text
push tag vX.Y.Z (默认分支上的提交)
  └─ validate      tag 格式 + tag == package.json (== tauri.conf) · lint/test · cargo test
      └─ draft     (Tauri) 预先建唯一草稿 → releaseId
          └─ build 矩阵：win x64/arm64 · mac arm64/x64 · linux x64/arm64   ← --publish never / releaseId
              └─ publish (environment: release，人工审批)
                   下载资产 → 校验 updater feed 覆盖所有平台且文件存在 → LF SHA256SUMS → attestation
                   → PATCH draft=false make_latest=true → API 断言 releases/latest == tag → 匿名拉 feed（容忍 CDN 延迟）
                  └─ winget (可选，仅稳定版，needs: publish)
```

## 两个工作流

- `ci.yml`：`pull_request` + main push；`contents: read`；不碰 secrets。不可信代码只在这里跑。
- `release.yml`：tag push 触发。手动重跑用 `gh workflow run release.yml --ref "$TAG" -f tag="$TAG"`，使事件与产物证明指向同一个提交。构建检出 validate 输出的 SHA，公开前再次核对 tag 指向。顶层 `contents: read`，只有需要写 release 的 job 提权（Tauri 的 draft/build/publish；Electron 模板只有 publish）。同一文件里 `needs: validate`，所以红树不会发布。
- workflow 只维护在默认分支。tag 运行的是**被打 tag 的提交里的 workflow 文件**：修了 workflow 但给旧提交打 tag，跑的仍是旧 workflow。
- 双应用 release hub：一个 tag 同时扇出 Tauri 与 Electron 构建时，两边都从 **tag** 推导 release 名与版本，各自 `actions/checkout` 指定自己的 ref；不要让 Electron 侧按 Tauri 的“应用版本名”等待草稿——版本不一致就会超时、什么都没附上。

## 版本单一来源

tag 是唯一来源；发版提交先 `npm pkg set version=x.y.z`（Tauri 的 `tauri.conf.json` `version: "../package.json"`），再打 tag。validate 断言一致，不一致即 `::error::version mismatch`。
不要用 `tagName: v__VERSION__` 让 tauri-action 按应用版本命名：tag 与配置不一致时，release 会挂到另一个版本下，推送的 tag 反而没有 release。

将技能的[目标大版本表](version-targets.json)复制到应用的 `.github/desktop-version-targets.json`。发布门禁在干净安装后比较实际解析版本与这份文件。升级应用时同步更新它，重跑旧 tag 时保持当时的目标。

## Tauri：草稿必须被发布

- 先在 `draft` job 建**唯一**草稿并把 `releaseId` 交给矩阵；矩阵各平台都向这个草稿上传。
- tauri-action 对同一份 latest.json 做读取、合并和替换。模板用 `max-parallel: 1` 串行执行这六个写入者。publish 逐个检查 `windows-x86_64`、`windows-aarch64`、`darwin-aarch64`、`darwin-x86_64`、`linux-x86_64`、`linux-aarch64` 的 URL、架构、载体，以及清单签名是否等于对应载体的 .sig。
- `latest.json` 的 `url` 可能是 API asset URL（`/releases/assets/<id>`）或带 tag 的直链；API ID 需属于当前草稿，两种 URL 都要解析到资产名，不能只按 `basename` 取（tauri-action v1 实测会产出 API asset URL）。
- `updaterJsonPreferNsis: true`：同时产 MSI 与 NSIS 时默认指向 MSI。
- 草稿对 updater 不可见（`releases/latest` 忽略草稿）——构建全绿、没人收到更新。
- `GET /releases/tags/<tag>` **不返回草稿**；在 release 列表里按 `tag_name` + `draft` 找。`gh release view/download/upload` 对已认证调用者能解析草稿。
- 三个应用模板的 publish job 使用同一仓库级并发组排队。稳定 tag 升为 latest 前与已公开的稳定版本比较，后到的低版本以历史 release 公开，预发布维持自己的渠道。
- `make_latest` 不是多余的：发布草稿后 GitHub 不一定重算 latest。判定标准是 API `releases/latest` 指向谁，不是 release 字段；下载重定向还会晚几分钟。
- `createUpdaterArtifacts` 需要 `TAURI_SIGNING_PRIVATE_KEY`；没有它 tauri-action 失败。`.pub` 可以入库，私钥只在 secrets。
- portable exe 不能自更新：`update.install()` 依赖安装布局。UI 里写明。

## Electron：清单就是 updater

- 每个 OS 一个 job，**同一 job 打该 OS 的全部架构**（`--mac --x64 --arm64`）；分 job 打会各写同名 `latest-mac.yml` 互相覆盖。Linux 的 x64/arm64 清单名不同（`latest-linux.yml` / `latest-linux-arm64.yml`）。
- **target 写在 electron-builder.yml 里，命令行只给架构**（`--win --x64 --arm64`）。命令行上的 target 名会**覆盖**配置里的 target 列表：配置写 `win.target: [nsis, portable]`、命令行写 `--win nsis`，portable 就被静默覆盖掉，产物里少一个目标而**没有任何报错**。目标只有一处说了算才不会漏。NSIS 多架构默认产出**一个通用安装包**（内含两个架构的 7z 载荷），清单里对应一条。
- **Windows runner 的默认 shell 是 PowerShell**：多行 bash 脚本（`set -euo`、`export`、`[[`、`[ -n`）在那条腿会直接 ParserError，而 macOS/Linux 照常通过——看着像平台问题，其实是 shell 不对。凡是 bash 脚本，显式写 `shell: bash`。
- 打包一律 `--publish never`，由唯一 publish job 上传；否则 electron-builder 在矩阵中各自发布、竞争、半成品。
- **手动上传要自己改名**：electron-builder 的 GitHub publisher 上传时会把资产改名（GitHub 的资产名只允许 `[0-9A-Za-z._-]`，`my-app Setup 1.0.0.exe` → `my-app-Setup-1.0.0.exe`），并把更新清单里的 `url` 改成同一个名字。`--publish never` 意味着那次改名不会发生——照原样上传，清单就指向一个不存在的资产，应用内更新直接 404。publish job 必须先按同一规则改名（空格 → 短横线），再校验清单里每个 `url` 在本地都有对应文件。
- Electron ≥ 42：安装后 `npx install-electron`（Yarn：`yarn run install-electron`）；不再有 postinstall 下载。它是 bin 不是 script，`npm run install-electron` 会报 Missing script。**打包本身不受影响**（electron-builder 会自己下载发行包），受影响的是下载时机：装依赖时不再下，改成第一次用到时才下，离线 runner 会在那一刻才失败。
- 模板按 GitHub provider 默认的 `latest*.yml` 处理。上传清单引用的全部文件和所需的 `.blockmap`；逐文件比对 SHA-512，再比较本次构建与草稿的文件名和 SHA-256。定制 channel 或 universal 产物时，同步调整清单名、架构判断与公开后的探测 URL。
- **清单必须指向能自更新的载体，publish job 要断言**：Windows 只认 NSIS；macOS 只认 zip；Linux 只认 AppImage（deb/rpm 只作安装渠道）。
- **macOS 的 zip 不是可选的第二个包**：electron-updater 的 MacUpdater 只在清单里找 zip——`findFile(files,"zip",["pkg","dmg"])` 里的 `pkg`/`dmg` 是**排除表**，不是兜底。只有 dmg 时清单会指向 .dmg，检查更新抛 `ERR_UPDATER_ZIP_FILE_NOT_FOUND`：**Mac 上「检查更新」100% 失败，而构建全绿、清单也在，只有用户点得到**。`audit.mjs` 的 `mac-update-needs-zip` 检查就是盯这个。
- macOS 自动更新还要求**应用已签名**（Squirrel.Mac 要求更新包与已装应用同一签名）；未签名时更新查得到、装不上，release 说明写明手动更新。
- artifact 名必须唯一（`dist-${{ matrix.name }}`）；下载后按平台目录归集，同名文件在打包上传前报错。

## 签名（按平台）

| 平台 | Tauri | Electron（electron-builder） |
|---|---|---|
| Windows | `bundle.windows.signCommand` 调 Azure Artifact Signing（或 signtool + 证书） | `win.azureSignOptions` + `AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET` |
| macOS | `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY` + 公证 `APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID` 或 `APPLE_API_*`；无证书时 ad-hoc `signingIdentity: "-"` | `CSC_LINK`/`CSC_KEY_PASSWORD` + 公证 `APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER` 或 `APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID`；v27 起 mac 签名配置移到 `mac.sign`（升级时核验） |
| Linux | 无 OS 签名 | 无 OS 签名 |
| 更新签名 | `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` 必须 | 依赖 OS 代码签名（macOS 必须） |

签名未就绪：Windows 在 release 说明提示 SmartScreen；macOS 写明“右键打开/系统设置允许”。签名身份变更（证书主体、Team ID）会影响旧版本能否接受更新，先在 N→N+1 上实测。

## 校验和与来源证明

- 在 Linux 上 `sha256sum` 生成 `SHA256SUMS`（LF）；PowerShell `Set-Content` 会写 CRLF，`sha256sum -c` 全部失败。
- `actions/attest`（v4，`subject-checksums: dist/SHA256SUMS`）生成 SLSA provenance；需要 `id-token`、`attestations`、`artifact-metadata` 写权限。私有仓库需要相应套餐。
- 用户核验：`gh attestation verify <file> -R owner/repo`。

## Immutable releases

开启后资产与 tag 在发布瞬间锁定，并自动生成 release attestation。因此：所有上传（含 SHA256SUMS）必须在草稿阶段完成；“发布”必须是最后一步；已发布的坏版本不能替换资产，只能 forward-fix 新版本（模板在 draft 已发布时直接报错要求升版本）。

## winget

见 house-style.md。默认：清单归 winget-manifests（`apps.json` 加一行），发布仓不提交，模板里的 winget job 保持注释。不在那条流水线里的发布者才启用它：`needs: publish`；仅稳定版；`WINGET_TOKEN` 预检；首个版本手工提交；不要依赖 `on: release: published`（GITHUB_TOKEN 发布的 release 不触发它）。两条路只能留一条。

## Action 固定

大版本标签（`@v7`）。house style 不钉 SHA：每次升级手改哈希，实际就永远不动了；要更紧就钉精确版本（`@v7.0.1`）。`audit.mjs` 报告 `action-major-behind`（P1，落后的大版本）与 `action-moving-ref`（notice，仅限能写产物的那几个 Action，不计入 P0/P1/P2）。升级大版本是**一个决定**：先读该 Action 的 release notes，再单独提一个 PR。

## 发布后验证与回滚

1. API：`releases/latest` == tag。
2. 匿名下载 feed（Tauri `latest.json`；Electron 各 `latest*.yml`），版本正确、引用的文件可下载。
3. 每个 OS 从 N 实测更新到 N+1。
4. 出问题：**forward-fix**（发 N+2）。要阻止扩散，可把上一版本重新 `make_latest=true`，但已更新的用户不会回退；不要删除 tag/资产（immutable 下也做不到）。
