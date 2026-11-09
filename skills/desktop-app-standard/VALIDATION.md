# 验证覆盖范围

下表归并截至 2026-11-09 的既有验证记录。结果受当时的代码、工具链与环境限制；模板或脚本变更后按受影响项复验，并更新对应行。

| 能力 | 验证方式与证据入口 | 仍需验证的范围 |
| --- | --- | --- |
| 审计与配置解析 | [测试目录](tests/)覆盖默认、CI-only、.NET、离线、基线重放、policy、JSON5、YAML 行内与块写法，以及跳过目录时的不完整状态；入口为 `node --test skills/desktop-app-standard/tests/*.test.mjs`。 | 受限网络、私有源和目标仓库的特殊配置需按实际环境确认。 |
| 在线版本与生命周期 | 曾对真实 npm、GitHub、Electron、Node 与 .NET 元数据运行只读查询，并对本地应用仓库巡检；受控响应覆盖 dist-tag 与目标 major 候选值不同、上游进入更高 major 等情形。方法见[依赖升级](references/upgrade-dependencies.md)。 | 版本和支持阶段在执行时重新查询，历史值不作为安装目标。 |
| 依赖升级执行 | 临时 npm 项目验证 manifest、锁文件更新与干净安装；隔离 Cargo 源验证跨 major 更新、锁文件及 `cargo check --locked --offline`。 | 原生模块、插件与实际应用运行需在目标产物中验证。 |
| .NET SDK 与 TFM | 临时项目用 dotnet/MSBuild 对照父级 props、项目 TFM 覆盖与 `global.json` 的 rollForward；自动化入口为 [dotnet.test.mjs](tests/dotnet.test.mjs)。 | 审计脚本读取元数据；目标机器及 CI 的 SDK 解析、实际构建目录仍需验证。 |
| CI 陷阱与模板 | [core.test.mjs](tests/core.test.mjs)及[cli.test.mjs](tests/cli.test.mjs)覆盖规则、模板、包管理器和锁文件不匹配；合成 Tauri/Electron 仓库曾完成在线与离线巡检。模板曾经 actionlint 检查，当时 1.7.12 对 `concurrency.queue` 报未知字段，该项另经官方文档与 schema 核对。 | 首次在托管 runner 上运行时确认 ARM64 可用性、双架构打包与平台依赖。 |
| 草稿、资产与发布顺序 | 从实际模板提取 shell 步骤，用本地 Git、包源及 GitHub API 替身覆盖清单缺失、架构/散列错误、重试、残留资产、API URL 归属、tag 移动、旧版晚完成和 feed 字节比对。模板见[发布流程](references/release-flow.md)。 | 真实 GitHub 托管多平台构建、公开下载、attestation、签名/公证和 winget 提交。 |
| 依赖安全与多端同步 | 源项目 `045-life-guide/docs/依赖安全复核-2026-11-09.md`、`docs/WebDAV同步复核-2026-11-09.md` 记录消费链复核，以及桌面 HTTP、加密和隔离数据库的并发/断线回归。可复用方法已归入[依赖升级](references/upgrade-dependencies.md#安全告警与间接依赖)和[同步验证](references/verification-performance.md#多端同步与断网恢复)。 | 真实网盘及手机往返同步需设备验收。 |
| 安装版自动更新 | 模板侧已覆盖更新清单、载体与签名一致性检查，见[发布流程](references/release-flow.md)。 | Windows/macOS/Linux 从已安装 N 到 N+1 的下载、验签、重启和数据保留，以及真实签名服务接入。 |

新增经验按仓库[回传规则](../../README.zh.md#经验回传与维护)筛选。验证表维护环境与能力边界，项目级执行明细保存在源项目。
