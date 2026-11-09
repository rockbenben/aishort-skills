# WPF 验证覆盖范围

下表归并截至 2026-11-09 的既有验证记录。Windows 实机记录来自 x64 环境；样例或应用验证结果受当时的代码与环境限制，变更后按受影响项复验。

| 能力 | 验证方式与证据入口 | 仍需验证的范围 |
| --- | --- | --- |
| SDK、TFM 与 NuGet 升级 | WPF 样例曾迁到 .NET 10，核对 MSBuild 实际 TFM；隔离 NuGet 源验证跨 major 更新、中央包版本、锁文件、locked restore、Release 构建和窗口启动。方法见[依赖升级](upgrade-dependencies.md)。 | 目标机器与 CI 的 SDK 解析和所用第三方包兼容性。 |
| 测试执行与 WPF 宿主 | Windows 样例验证 MTP 最低测试数量门槛；Clockwork 通过共享 STA/Application 宿主执行真实编辑保存、持久化重读与资源加载。证据在源项目 `app.Tests/Views/StepEditingRoundTripTests.cs`、`app.Tests/Views/WpfHost.cs`。方法见[测试宿主](dev-switches.md#wpf-回归测试staapplication-与入口程序集资源)。 | Clockwork 真实发键因未取得前台而跳过，接收端输入链路需补验。 |
| 配置、启动项与更新缓存恢复 | Clockwork 的 `app.Tests/Core/ConfigRecoveryTests.cs`、`ViewModels/StartupTakeoverTests.cs`、`Engine/UpdateDeliveryTests.cs` 以隔离文件、替身和假 HTTP 覆盖备份失败、接管回滚、缓存损坏、并发及失败重试。 | 真实登录任务的普通用户/管理员/提权目标矩阵及真实更新服务。 |
| 目录分类性能 | Clockwork 的 `app.Tests/Engine/PortProjectScanTests.cs` 用注入的慢探测验证后台分类与同目录结果复用，后续过滤不重复探测。 | 真实网络盘、设备与数据量下的耗时。 |
| 发布包、安装器与草稿核验 | Windows 样例执行四份 x64/ARM64、框架依赖/自包含 profile；x64 包运行 smoke，ARM64 检查 PE 架构。Inno Setup 6 曾在含空格路径编译。提取 workflow 步骤，以本地 API 替身验证资产缺失、散列错误、构建摘要、tag 移动与发布顺序。入口见[发布参考](github-actions.md)。 | ARM64 真机启动、托管 runner UI、真实签名、公开发布、attestation、winget 和 Inno Setup 7。 |
| 提权、确认与恢复 | StashBay 在实际 ACL 夹具中验证普通令牌拒绝、管理员令牌重试及撤销，独立 worker 终止后重启恢复；应用确认框批准与取消核对业务数据。方法见[提权探针](dev-switches.md)。 | 系统策略下 UAC 同意框未出现，系统提示的接受/拒绝、断电、UNC 与 ARM64 需单独验收。 |
| 拖放、布局与资源 | StashBay 实机验证 Explorer 拖出同名文件与嵌套目录、源数据保留、暂存清理，以及双语、浅深主题和窄窗口；早期记录另含图标、WindowChrome、热键与 resx 键集合检查。方法见[故障参考](pitfalls.md)和[调试开关](dev-switches.md)。 | 其余设备、语言与 DPI 组合，以及自带 Fluent 主题实机效果。 |
| 旧版升级再卸载 | StashBay 用隔离 AppId 和路径执行旧包安装、升级、卸载与全新安装卸载，核对用户文件哨兵及受管文件残留，复现并修复旧卸载日志沿用的问题。方法见[卸载日志](github-actions.md#修了卸载规则旧版升级后仍会删除用户文件)。 | 正式 Shell 注册及其他历史安装器的迁移。 |

新增经验按仓库[回传规则](../../README.zh.md#经验回传与维护)筛选。表中源项目路径供定位原始证据，使用本技能时按目标应用重新验证。
