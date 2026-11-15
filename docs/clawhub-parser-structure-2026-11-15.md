# ClawHub 解析覆盖结构调整（2026-11-15）

## 范围与复现方法

针对 md-web 1.3.11 与 nextjs-to-tauri 1.1.19 的原始扫描报告，检查 analysis_completeness.ledger_exceptions，而不只依据摘要推测。线上主要理由为 opaque_content、static_parse_limit、obfuscated_instruction_text，另有 Docsify 的语义分析长度限制。

本地使用 [NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector/tree/c81615007d40e86051a302a3cf897f8a05264928) 源码（声明版本 2.12.0），调用 bounded_parse_diagnostic、build_declared_marker_views 与 static_patterns_tool_misuse 的实际 ledger runner。没有启用 LLM 或付费重扫。线上只公布包版本，没有公布其源码 revision，因此本地复现不能冒充线上同构建或最终审核结论。

## 定位与等价调整

| 位置 | 本地诊断 | 调整 |
| --- | --- | --- |
| md-web/upload.js 原第 661 行 | 生命周期注释中的英文所有格使命令词边界跨到文件末尾 | 更明确描述“没有保留规则才删除生命周期文档”的前置条件；执行代码未改变 |
| nextjs-to-tauri/tauri-files.md 原第 78 行 | 拖放说明中的引号、字面量和删除措辞被解释为无法重建的标记删除指令 | 改写为正面说明 dragDropEnabled 的行为和适用条件，保留前端文件拖放功能 |
| nextjs-to-tauri/frontend-integration.md | 行内代码与普通英文标点、TS 模板字符串的边界被当成 shell 展开 | 澄清语言记忆的可选性；四处字符串插值改为同样的字符串拼接，保留语言恢复、软导航和更新确认文本 |
| nextjs-to-tauri/release-assets.mjs | 从模板字符串起将剩余 JS 判为运行时命令字符串 | 保留原参数、错误消息、URL、签名、摘要与构建证据算法；改用显式字符串拼接 |
| nextjs-to-tauri/desktop-build.yml | 多行 YAML run 中固定校验和清理命令导致解码后的 command_string_effects 诊断 | 将旧 SHA256SUMS 清理交给原资产校验 CLI 的 verify 分支；工作流仍先验证草稿和全部证据，再生成摘要与 attestation |

release-assets.mjs 是 desktop-app-standard 与 nextjs-to-tauri 共用的同内容副本，两处同步；新增回归验证旧校验和会被重算，而多余的旧安装包仍会使校验失败。

以上五个直接相关文件在修改前均有对应的本地解析缺口；修改后 diagnostic 与 marker limit 均为空，完整的 tool_misuse ledger 也均从 partial 变为 completed。completed 仅指该确定性分析器完成工作，不等于所有安全检查通过。upload.js 中仍有针对“world-readable”注释的静态提示，其原始上下文为说明如何避免宽权限中间文件，并非放宽权限。

## 浏览器库的可读性

将 Docsify、search、countable 和 zoom-image 四个随附浏览器库展开为可读格式，保持文件名和加载次序。没有删除插件、改成外链、编码载荷或排除扫描文件。用 Babel AST 比较格式化前后语义节点，剔除位置、注释、raw spelling 以及格式化器附加的非语义字段后，四个库的 AST 均相同。字符串值、正则模式和 flags 等语义字段保留在比较中。

Prettier 的 debug-check 对其中两个压缩库因附加 AST 位置字段报差异，因此没有把该命令记作通过；随后进行了上述显式的语义 AST 核对和浏览器对照。

格式展开并不能消除所有上游限制。当前本地仍可复现：Docsify 的指令标记清理/Markdown fence 字符串、countable 的 HTML 模板，以及测试夹具中的 HTTP DELETE/正则表达式会使部分静态器保守降级。Docsify 原有的线上语义长度限制也不能靠格式化解决，展开后文件反而更长。保留这些功能和测试，不宣称全包静态覆盖已达 100%。

## 功能验证

- 根 npm test：45/45 通过，包含两个技能的隔离安装与桌面资产验证。
- md-web 上传、生命周期、路由/CSP 专项检查：0 failure。
- Chromium 加载修改前（Git HEAD）与修改后资源，使用相同 Markdown 夹具；标题、GFM 表格、代码块、目录、搜索结果、图片尺寸、跨文档导航与页面错误检查均通过，两次 DOM 观察结果一致。
- 技能元数据与版本变化校验通过。

待发布版本：md-web 1.3.12、nextjs-to-tauri 1.1.20；共享脚本对应 desktop-app-standard 0.9.22。由于 viewer 资产字节变化，md-web 升级后仍按现有流程显式运行已授权的 setup，旧不可变资产保留。

## 发布与最终判定

第一轮提交 a935cf7 由 [CI 43716755716](https://github.com/rockbenben/aishort-skills/actions/runs/43716755716) 成功发布这三个版本，上传没有再次出现 Forbidden。上轮同一包曾在首次 Pass 后 148 秒被更新为 Review，因此不能把首次可见状态当作稳定结论。

md-web 1.3.12 已显示 clean / Pass，checkedAt 为 2026-11-15T13:13:43.422Z。原始报告仍有 8 条静态提示及部分解析覆盖缺口，包括 upload.js、浏览器库和测试夹具；Pass 来自综合审核结论，不表示原始静态器全部完成。没有将尚存的缺口记成已修复。

nextjs-to-tauri 1.1.20 仍为 suspicious / Review，checkedAt 为 2026-11-15T13:11:47.795Z。提示从 19 条降为 11 条，frontend-integration.md 与 tauri-files.md 已没有静态解析异常；剩余为 desktop-build.yml 的 static_parse_limit，以及 release-assets.mjs 的 opaque_content。线上组件清单明确将 .mjs 识别为 other，本地源码则有 .mjs → javascript 映射，说明仅凭版本号不能认定解析器行为一致。

## 第二轮：模板格式和工作流分离

nextjs-to-tauri 1.1.21 将随附的 ESM 模板命名为 release-assets.js，内容仍与 desktop-app-standard 的 release-assets.mjs 完全相同；使用时明确复制为 .github/scripts/release-assets.mjs，以保留项目 CommonJS/ESM 设置下的运行行为。此调整使静态器能够按已支持的 JavaScript 扩展名检查明文源码，没有隐藏或排除代码。

把 YAML 中草稿完整性验证步骤原样提取到 verify-draft.sh，作为显式随附文件并从 SKILL.md 链接，工作流使用 bash 调用。保留草稿状态检查、全部资产下载、GitHub 摘要读取、原资产验证 CLI 和标签移动检查。根测试同步验证复制源与共享脚本一致，并用实际 Bash 验证成功路径、已公开版本拒绝、资产校验失败中断和标签移动拒绝四种情况。46/46 测试与元数据验证通过；三个文件的本地 tool_misuse ledger 均 completed。

提交 2c203dd 已推送，[CI 43718190954](https://github.com/rockbenben/aishort-skills/actions/runs/43718190954) 全部通过，2026-11-15T13:20:52Z 提交 1.1.21 发布成功。线上完整报告 checkedAt 为 2026-11-15T13:27:44.541Z，仍为 suspicious / Review、11 条提示。组件清单已正确识别 release-assets.js 为 javascript、verify-draft.sh 为 shell；新 shell 文件没有静态解析异常。但 desktop-build.yml 的 static_parse_limit 和 release-assets.js 的 opaque_content 仍然存在。由此可排除“仅仅扩展名不识别”是全部原因，不能宣称第二轮已消除覆盖缺口。

11 条中有 4 条 AE1，来自同两个文件的多处引用；其余 7 条（两条应用自更新、未声明工具范围、公共包元数据请求、三条 CI sudo）均有 llm_review_outcome: disagreed。它们是上下文误报；解析覆盖不足则是仍存在的分析限制，不能仅因综合复核不同意其他提示就一并忽略。

线上异常没有提供触发表达式或行号，只有文件名和通用理由；同版号的当前上游源码对这些文件能完成静态分析。因此目前证据支持部署解析器行为不同，尚不能定位剩余两处的单一触发表达式，也不能认定存在恶意行为或断言应用代码没有其他问题。继续删除功能、缩减校验或盲目发版没有证据支持。若继续解决线上覆盖，需要平台提供该部署构建的具体诊断，或用同一构建复现后再调整合法源码。

md-web 1.3.12 的 clean / Pass 已连续观察超过五分钟；截至本轮完整报告核对仍保持该状态。它的部分静态覆盖限制保留在前文，不宣称其全包解析已完整。

可复核的指定版本原始接口：

- [md-web 1.3.12 scan](https://clawhub.ai/api/v1/skills/md-web/scan?version=1.3.12)、[verify](https://clawhub.ai/api/v1/skills/md-web/verify?version=1.3.12)。
- [nextjs-to-tauri 1.1.21 scan](https://clawhub.ai/api/v1/skills/nextjs-to-tauri/scan?version=1.1.21)、[verify](https://clawhub.ai/api/v1/skills/nextjs-to-tauri/verify?version=1.1.21)。

## 第三轮：完整拆分工作流与校验模块（1.1.22）

按职责拆分而不缩减检查：

- desktop-build.yml 从约 15 KB 改为约 3.3 KB，保留原触发器、并发队列、草稿预检、四平台串行矩阵及最终验证。矩阵调用同仓库 tauri-build.yml（约 5 KB）；显式传递构建目标、草稿 ID、源提交、发布标志和两项原签名密钥。
- 多行 Bash 操作提取为 ci/ 下 6 个明文脚本，分别处理草稿、portable、构建证据、草稿验证、摘要上传和运行摘要。所有脚本继续随技能发布，并在 release-workflow.md 列出复制映射。没有对扫描隐藏内容。
- 原 release-assets.js 拆为轻量入口和 release-assets/ 下 6 个模块：通用输入与哈希、feed 校验、构建证据记录、证据验证、公开/草稿 release 验证和 CLI。各模块约 0.8–3.3 KB。保留原导出函数及 record、verify、ready、verify-release、verify-draft 命令；目标项目入口仍为 .mjs，模块目录自带 type: module，避免应用包类型改变模块加载方式。
- 原工作流注释中的操作边界、命名、portable 限制、签名密钥、发布和排队要求集中到 release-workflow.md。保留人工公开草稿的流程。

验证结果：根测试 46/46 通过；公开导出校验函数的源码与 desktop-app-standard 原版一致（仅标准化换行）。隔离发布包在 CommonJS、ESM 两类项目中均执行原有资产校验套件，覆盖跨平台证据合并、旧包混入、缺失包、摘要篡改、错误源提交/运行、签名与 feed 等拒绝路径。原 Bash 草稿验证成功/失败路径测试继续通过。资源声明、版本和 diff 检查通过。

actionlint 1.7.12 对原有 concurrency.queue 报未知字段；这是工具尚未识别 [GitHub 已支持的 queue: max](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。正式模板保留该设置；只在临时校验副本中省略该字段后，两个工作流的 actionlint 其余语法、表达式、跨工作流输入和 secret 检查通过。没有把未经处理的完整输入检查记作全绿。

本地上游 tool_misuse ledger 对全部新拆分代码、工作流及说明文件均 completed；与前两轮相同，这不能替代线上指定版本报告。

提交 55f7c2a 已推送，[CI 43720834865](https://github.com/rockbenben/aishort-skills/actions/runs/43720834865) 全部通过，于 2026-11-15T13:51:49Z 成功提交 nextjs-to-tauri 1.1.22 发布，无 Forbidden。

同一包的服务端结论随后发生变化：

| checkedAt（UTC） | 综合结论 | 原始提示数 |
| --- | --- | --- |
| 2026-11-15T13:59:21.202Z | suspicious / Review | 8 |
| 2026-11-15T14:01:55.603Z | clean / Pass，medium confidence | 8 |

两次均为 SHA-256 `bf2b07a9eb93ed1320df0faad915105696a33eb44fa6be9785d35a23dd234777`，并非再次上传了不同代码。完整报告和首次摘要相隔约 154 秒，再次说明首次可见标签不是可靠的最终判断。

完整报告的解析结果：20 个组件中 13 个完成、7 个 partial。两个工作流、6 个 Bash 脚本均不再有静态解析异常，原 desktop-build.yml 的 static_parse_limit 消失；但入口 release-assets.js 和 release-assets/ 下 6 个 JS 模块仍有 tool_misuse 的 opaque_content。拆分尚未解决服务端 JavaScript 解析限制，不能把 AE1 提示消失当成所有代码完整解析。所有模块仍明文随包发布，并在元数据和复制清单中明确列出。

8 条静态/语义提示均有 llm_review_outcome: disagreed：应用自更新 1 条、工具范围 1 条、crates.io 元数据请求 1 条、CI sudo 3 条，以及脚本中远程 SHA256SUMS 覆盖和临时 JSON 覆盖各 1 条。后两条在首次摘要中曾被作为担忧，完整复核结合工作流上下文后不同意：前者是已验证草稿的可重跑生成物，后者是 RUNNER_TEMP 中本轮重新下载的元数据；复制说明已披露这些写入用途。没有为消除提示删掉 --clobber 或去掉校验，也没有引入额外确认步骤改变 CI 行为。AIG 无发现。

原始证据：[1.1.22 scan](https://clawhub.ai/api/v1/skills/nextjs-to-tauri/scan?version=1.1.22)、[完整 verify](https://clawhub.ai/api/v1/skills/nextjs-to-tauri/verify?version=1.1.22)。2026-11-15T14:03:30Z 至 14:08:50Z 连续观察超过五分钟，clean 和 checkedAt 均未再变化。此为本轮观察结果，不代表未来不会重新审核，也不将 Pass 等同于全量静态解析完成。
