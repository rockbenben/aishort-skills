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

把 YAML 中草稿完整性验证步骤原样提取到 verify-draft.sh，作为显式随附文件并从 SKILL.md 链接，工作流使用 bash 调用。保留草稿状态检查、全部资产下载、GitHub 摘要读取、原资产验证 CLI 和标签移动检查。根测试同步验证复制源与共享脚本一致，并用实际 Bash 验证成功路径、已公开版本拒绝、资产校验失败中断和标签移动拒绝四种情况。46/46 测试与元数据验证通过；三个文件的本地 tool_misuse ledger 均 completed。线上结果待发布后记录。
