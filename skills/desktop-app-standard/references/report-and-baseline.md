# 报告与审阅基线

## 输出模板

```text
任务模式 / 已完成的升级或只读巡检结论 / 剩余阻碍
核验时间（UTC）、项目路径或 commit、模式、扫描/网络限制

1. 版本矩阵
组件 | 原解析版 → 实际解析版与位置 | 上游稳定版 | 技能目标 major / 该线稳定版与来源 | 是否对齐 / 阻碍和复查条件
Node 工具链 | CI node-version / node-version-file（.nvmrc 仅提示） | Active/Maintenance/EOL | latest LTS（官方 schedule） | 发现

1b. .NET 运行时与 SDK（--dotnet）
项目 | TFM | global.json pin/rollForward | 支持阶段/EOL | latest SDK/runtime | 发现
（TFM/EOL 来自官方 release metadata；global.json 语义按官方文档；不执行 dotnet/MSBuild）

2. 框架 P0 / P1（版本、支持窗口、配对、上游 breaking/security）
风险 | confirmed/heuristic/unknown | 文件:行 | 官方来源 | 影响 | 处理与验证
（无证据时写未确认，不把静态候选直接判漏洞；`.desktop-policy.json` 的偏离也可接受 framework finding id，已接受的单列，不计入 P0/P1/P2）

2b. 上游变更候选：classifyNotes 的 suggestedPriority 只是候选，读原文后再定级

3. 新特性采用建议
特性 | 解决的应用问题 | 平台/版本门槛 | 预期收益 | 风险成本 | 采用/暂缓/不适用

4. House style 差距
当前做法 | 项目约束或偏离 | 本次修改（只读巡检填写建议动作）

5. CI & Release（独立分区，单独 P0/P1/P2，不与框架风险混排）
ciFindings（references/ci-traps.md）| Action 大版本与 suggestedPin | 平台覆盖 | 草稿/签名/发布/feed
（`notice` 与 `.desktop-policy.json` 已接受的偏离单列，不计入 P0/P1/P2；已接受的要写出 reason 与 revisitWhen）

6. 优化
测量条件、前/后指标与原始记录；无数据=待测

7. 实施和验证
已读 / 已修改 / 已执行命令及结果 / 未验证环境 / 未执行的外部动作

8. 升级顺序、回滚/forward-fix、暂缓事项、下一次复查触发条件
```

简短请求可精简；P0、采集失败、未验证平台和授权边界不可省略。

新建或升级时附上锁文件或还原结果、实际运行的验证及受环境限制的检查。只读任务写明采集范围即可。

## 事实与推断

- 目标表内的组件按技能规定的 major 核对。npm 的上游 latest 指 dist-tag，Cargo 的上游稳定版排除 yanked 和预发布。报告的 targetStable 用于寻找该 major 的最新稳定候选，实际采用值以应用锁文件和兼容验证为准。

- 当前版本由锁文件/实际安装/已发布产物分别提供，不以声明下界冒充实际版本。
- `usageHints` 是代码形字符串命中，不是调用图、漏洞可达性或语义证明；无匹配不等于无影响。
- `ciFindings` 不能解析完整 YAML（`confidence: heuristic`）；可能命中字符串或脚本文本。必须人工阅读上下文，追踪 reusable workflows。
- `latestReleaseTag` 取自 `releases/latest`；拿不到时 `latestMajor` 退回前 100 个 Action tags 里最高的 `vN`，**不是确认的最新可用版本**；`tagListingTruncated`（tags 满 100）必须保留。需要时分页核验并读取 action metadata。
- `collectionComplete` 只描述脚本的有界事实采集，不包括插件所有 changelog、CVE 数据库、构建、签名、性能或真实更新测试。
- `.NET` 的 TFM/EOL 来自官方 release metadata；`global.json` 的 `rollForward` 结论按官方语义（只有 `latest*` 保证选到最新，默认是 `patch`）。脚本不执行 `dotnet`/MSBuild，项目旁最近的 global.json 只是静态线索；CLI 从命令的工作目录向上查找，用实际构建目录里的 `dotnet --version` 核验；`netstandard` 是库 TFM、`net4x` 是 .NET Framework，都不走 .NET 运行时 EOL 数据。
- 扫描跳过符号链接或不可读目录时，那些子树没有被审计：`collectionComplete` 为 false、退出码 2，文本报告的 Heads-up 会逐条列出（JSON 的 `scan.skipped` 保留完整清单）。
- Node 的 Active/Maintenance/EOL 来自 nodejs/Release 官方 schedule；`node-version-*` 的 pin 位置是行扫描（heuristic），CI 是否真的按该版本执行仍需读 `setup-node` 步骤。P 级只针对 CI 的 `node-version` / `node-version-file`；`.nvmrc`/`.node-version` 是可选本地文件，过期只作 Heads-up。Node 是构建工具，不是应用运行时（Electron 内置 Node）。

## 基线策略

使用 `.desktop-app-standard-review-YYYYMMDD.json` 作为新基线文件；先审阅 audit JSON，再显式 `--confirm-reviewed`。脚本拒绝离线/采集失败/截断的报告和覆盖现有文件；不同项目路径不能复用。

基线储存已审阅 release ID，不储存“已修复”。`--since-baseline` 只标注 reviewed=true/false；仍计算当前依赖、上游、CI 和兼容性。不要只输出未读 release 而隐藏长期未处理风险。

在项目 decision log/issue 另记：风险 ID、决定、原因、负责人、复查条件、已安装版本、已验证平台、已发布版本。旧版（`desktop-version-watch`）`.desktop-version-watch.json` 的“见过的最高版本”语义不可自动迁移为新版“已审阅”。

## 定期运行

建议每周只读检查、每月集中做功能采用决策；已确认高危安全公告和 EOL 提前触发。频率与载体由用户决定，本技能不安装调度任务。本仓不用 Dependabot——升级多半要连带改代码并做一次真实更新验证，自动开 PR 反而添乱。

如用户要 CI 自动报告：先确认目标仓库、权限与报告载体，用最小只读权限采集并保留失败状态，不自动改锁文件/合并 PR/发布。脚本退出 2 是不完整而非成功，应让维护者看到而非 `|| true` 静默吞掉。
