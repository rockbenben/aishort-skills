# WPF CI 与直接发布

默认流程为 test → release，测试通过后构建、签名、打包并用 softprops/action-gh-release 直接公开，draft: false。复制 [templates/ci.yml](templates/ci.yml) 到应用的 .github/workflows/ci.yml，并核对下表。

同时将 [package-release.ps1.txt](templates/package-release.ps1.txt) 复制并重命名为 tools/package-release.ps1，CI 和本地使用同一个入口，避免文件命名、压缩和摘要范围漂移。.txt 后缀用于确保 skill 发布包保留脚本原文。脚本需要 PowerShell 7.4+。例如构建四份 profile、编译安装器后运行：

```powershell
./tools/package-release.ps1 -AppName Xxx -Tag v1.2.3 -PublishRoot src/Xxx.App/bin/Release -Installer artifacts/Xxx-v1.2.3-setup.exe -OutputDirectory artifacts/release -RequiredFiles e_sqlite3.dll
```

RequiredFiles 填真实外置资源和原生库，无此依赖时不传；每份 profile 都会验证存在。SmokeEnvironment 传应用自己的测试数据路径和禁止 Shell 集成开关，避免 smoke 注册热键、启动项、右键菜单或访问真实数据。脚本已为子进程隔离 TEMP/TMP/APPDATA/LOCALAPPDATA，使用独立解包目录。RequireSigning 打开时，四份应用及安装器任一签名失效即失败；最终签名须在调用脚本之前完成。脚本核对四份 exe 的 PE 架构，ARM64 仍需真机运行。最低测试数应替换成该工程真实测试数量。

| 输入 | 适配方法 |
| --- | --- |
| 应用与版本 | 替换 Xxx、src/tests 路径，保留 global.json 和实际版本源。示例接受稳定版 tag vX.Y.Z。 |
| 测试 | 示例采用 .NET 10 MTP 和最低测试数。VSTest 项目沿用 dotnet test <project> -c Release，检查 TRX 中实际测试数。 |
| 发布 | 根据支持的 RID 与 pubxml，同步修改 publish、签名路径、ZIP 和说明。 |
| 安装器 | 默认 Inno Setup 6，找不到发行版脚本时失败。便携版专用项目移除安装器步骤及对应说明。 |
| 签名 | 配置 Azure 联合身份和仓库变量后签 exe 与安装器，生成摘要前检查最终 Authenticode 状态。 |

保留现有可用的项目结构、测试 runner、安装器和 reusable workflow。对照 [Flow Launcher 构建](https://github.com/Flow-Launcher/Flow.Launcher/blob/ff99ea05d7ad198de6e26e2878215f7221860dac/.github/workflows/dotnet.yml)，可以把 restore、build、test 与项目打包脚本直接连起来。模板中的四份 profile 是分发示例，按应用支持范围选用。

## 产物验证

ZIP 收录 publish 目录的文件与子目录，保留外置资源及原生库，排除调试文件。发布目录保持干净，避免把开发数据加入分发包。x64 自包含和框架依赖 ZIP 从独立解包目录运行 smoke，ARM64 交叉构建与真机运行分别记录。应用 smoke 应实际读取资源并完成窗口布局。

验证打包脚本时调用本地与 CI 共用的入口，用临时目录覆盖缺安装器、缺外置资源和已要求签名却无有效签名的失败路径；安装器编译包含带空格的路径。控制台夹具只能验证打包和进程启动，不能代替真实 WPF 窗口、ARM64 设备或签名服务验收。

签名先于打包和摘要生成。SHA256SUMS.txt 使用 LF，上传文件来自同一份明确资产列表，fail_on_unmatched_files: true 使缺资产直接失败。公开后下载文件核对摘要，检查所选架构能启动、安装/卸载界面为英文。

发布说明给出本版本变更、实际下载类型、运行时要求、架构和签名状态。默认自动生成版本说明；需要维护 changelog 时链接真实存在的版本段。已有已安装用户时验证 N→N+1、设置保留和旧安装器卸载行为。

## SDK、权限与重跑

global.json 决定有效 SDK，CI 从实际构建目录确认版本。PR 使用 contents: read，release job 才获得 contents: write；签名 OIDC 按需要使用 id-token。门禁沿 needs 连接到同一 tag 的测试。

Release Action 使用 make_latest: legacy，按 GitHub 版本规则判断 latest。同一 tag 的重跑沿 Action 的资产覆盖语义处理。仓库有 immutable releases 或特殊发布策略时核对其服务端限制和 Action 支持。provenance、SBOM、审批与额外证据按实际要求添加。

## winget 与升级卸载

保留一个 winget 提交来源。由 winget-manifests 的 apps.json 管理的包，发布仓完成 GitHub Release 即可。项目自行提交时，在 release 验证成功后调用既有 winget 工具；首次提交和 token 配置沿用项目流程。GITHUB_TOKEN 发布的 Release 不会触发其他 on: release 工作流。

### 修了卸载规则，旧版升级后仍会删除用户文件

历史安装器的卸载日志可能在覆盖升级时沿用。用隔离 AppId、安装目录和用户文件哨兵验证旧包安装、升级、卸载与全新安装卸载。修复卸载规则后，确认历史日志的迁移方式，分别核对用户文件保留和受管文件清理。

## 配套参考

项目与发布 profile 见 [project-setup.md](project-setup.md)，窗口及打包 smoke、人工交互验收见 [dev-switches.md](dev-switches.md)。

## VSTest 适配示例

保留现有测试工程和适配器包，沿项目使用的 SDK 执行并核对实际测试数量。

```powershell
dotnet test tests/Xxx.Core.Tests -c Release --logger "trx;LogFileName=results.trx"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
[xml]$result = Get-Content tests/Xxx.Core.Tests/TestResults/results.trx
if ([int]$result.TestRun.ResultSummary.Counters.total -lt 1) { throw 'No tests discovered' }
```

多目标工程给每个目标独立结果路径，汇总全部目标；MTP 工程使用模板中的 --minimum-expected-tests。

## 包型目标与既有项目

日常全面维护和整体采用时，以项目起手文档的三轨分发矩阵为目标，补齐安装包、x64/ARM64 自包含 ZIP 与框架依赖 ZIP。历史上只发两个 x64 包的项目同样检查这些缺口。用户当前明确限制或可验证的架构兼容问题决定实际例外。

同一程序已经在 ZIP 中时，发布页提供 ZIP 即可。外置原生 DLL、资源和配置模板须随包保留。安装器配置按应用数据位置验证升级和卸载，仅删除由安装器管理的文件。

## winget 送达检查

复查中央 apps.json 中的实际登记状态，核对包标识、公开源、所选资产、架构、安装器类型和 ARP 身份。安装包支持静默安装；框架依赖 ZIP 只在声明 Desktop Runtime 依赖时作为 winget 目标。已有 portable 包切换为安装器需要迁移验收，已有用户更新路径随原包标识验证。

直接公开上传时，中央巡检等待所选文件和完成标记齐备，再计算真实 URL/散列并提交。新增包还没有可访问的公开资产时保留待发布登记，不生成虚构版本或摘要。默认向中央仓库登记，由它统一提交；发布仓只在既有要求下负责触发。

应用内更新需说明实际能力。校验下载后手动替换、纯离线手动更新、安装器自动升级分别验收。新增架构时同时检查选包和缓存目录，避免跨架构复用旧包。winget upgrade 还需核对静默开关、ProductCode、Scope 和版本识别。

下载与缓存可采用 [UpdatePackage.cs](templates/UpdatePackage.cs)。它按 ProcessArchitecture 精确选择自包含 ZIP，缓存按架构和版本隔离，拒绝未知架构和不合法版本。该模板不执行联网、验签或替换，接入时继续验证 SHA256、失败清理和解包完成标记。无更新服务的离线应用保持手动更新。静态候选可运行 desktop-app-standard 的 `audit.mjs <repo> --dotnet --ci-only`，核对已知缓存、打包、英文安装器和 SDK 漂移问题。
