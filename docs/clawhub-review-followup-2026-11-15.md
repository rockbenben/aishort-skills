# ClawHub 最新扫描复核（2026-11-15，第二轮）

本轮修复前检查的已发布版本为 md-web 1.3.10、html-shot 1.2.7、nextjs-to-tauri 1.1.19，不是旧缓存或 pending scan。三者当时 security.status 均为 suspicious，但 isPendingScan、isMalwareBlocked、isHiddenByMod、isRemoved 均为 false。上传成功与安全扫描通过是两件事。md-web 与 html-shot 的重新发布结果见末节。

## 结论

| Skill | Skillspector 条目 | 当前核实与本地处理 |
| --- | --- | --- |
| md-web 1.3.10 | 9 | 先前已确认的搜索 HTML 注入、缺少可执行共享写入确认、凭据复制后才 chmod 等告警已不再被确认。当前 TM3 命中的是调用私密迁移函数的代码，审查结果为 disagreed。另将 README 的模糊分享示例改为明确公开上传范围，本地版本 1.3.11。 |
| html-shot 1.2.7 | 15 | 两条安装器示例不指定版本的告警被确认；中英文 README 改为 skills@1.8.1（npm 当前稳定版本），说明它只固定安装器，不固定 skill 内容。本地版本 1.2.8。测试假凭据、loopback 请求和依赖范围的其他告警审查为 disagreed。 |
| nextjs-to-tauri 1.1.19 | 19 | 剩余重点是静态解析限制和对正常源码/说明的覆盖缺口；其余应用版本修改、checksum 清理、上游查询与 Linux runner 的 sudo 告警均被审查否定。保持源码及必要引用，未为消警删除功能或拆散测试。 |

ClawHub 发布工具的自动 latest 策略不变。这与 html-shot 面向使用者的可复现安装示例是不同的入口；无需把发布工具重新锁回旧版本。

三个扫描报告的 A.I.G results 均为空。解析覆盖不足没有等同于安全通过，也不能据此认定有恶意代码。md-web 的公开范围文字存在改进空间，但该条扫描自身 review 为 disagreed，故按文档澄清处理，不宣称发现新执行漏洞。

## 当前剩余审查项

- md-web 的 README 已执行固定版本安装示例；RP1 命中的是解释未固定命令风险的反例。AS3 指向审阅本 skill 的版本文件，不是枚举他人技能。配置文件持久化是用户已声明的桶连接信息；它不安装后台持久化程序。
- html-shot 的凭据和本地网络命中来自隔离集成测试，目的为验证本地文件隔离、拒绝跨域及错误信息保密，不是读取用户真实凭据。package.json 使用版本范围，但随包提供锁文件并通过 npm ci 安装，原报告也否定了相应告警。
- nextjs-to-tauri 的 AE1 包含 static_parse_limit、opaque_content 和 obfuscated_instruction_text；这些是扫描器未能完成解析的理由，不是已确认的指令注入。引用的 tauri-files.md 包含配置、Rust、updater 签名等说明，不能通过删除必要内容来虚构“覆盖完整”。
- 缺少 allowed-tools 不能证明越权。该字段在部分宿主提供工具预授权，不能作为跨宿主权限上限；保留正文的用途和数据范围说明，不加入宽泛预授权来追求分数。

## 完整条目索引

定位行号属于上述已发布版本。下表保留所有规则，不把被审查否定或覆盖不足的条目隐藏。review 为 disagreed 仅是扫描内部复核意见；本地还需按实际代码判断，不能把它当作全面安全证明。

### md-web 1.3.10

来源：[原始报告](https://clawhub.ai/api/v1/skills/md-web/verify?version=1.3.10)。完整静态覆盖 46.7%。

| # | 规则 | 位置 | 扫描复核 | 本地判断 |
| --- | --- | --- | --- | --- |
| 1 | AE1 | SKILL.md:48 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 2 | RP1 | README.md:19 | disagreed | 反例文字，不是执行未固定安装器 |
| 3 | RP1 | README.zh.md:19 | disagreed | 反例文字，不是执行未固定安装器 |
| 4 | AS3 | README.md:26 | disagreed | 审阅本技能源码，不是枚举其他技能 |
| 5 | AS3 | README.zh.md:24 | disagreed | 审阅本技能源码，不是枚举其他技能 |
| 6 | SQP-1 | README.md:125 | disagreed | 明确公开上传触发范围，文档已澄清 |
| 7 | LP3 | SKILL.md:1 | disagreed | 宿主权限边界，不能用预授权字段消警 |
| 8 | RA2 | SKILL.md:104 | disagreed | 用户声明的本地连接配置，不是自启动 |
| 9 | TM3 | upload.js:281 | disagreed | 私密迁移调用；未发现先复制后收紧权限的旧实现 |

### html-shot 1.2.7

来源：[原始报告](https://clawhub.ai/api/v1/skills/html-shot/verify?version=1.2.7)。完整静态覆盖 64.7%。

| # | 规则 | 位置 | 扫描复核 | 本地判断 |
| --- | --- | --- | --- | --- |
| 1 | AE1 | SKILL.md:52 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 2 | AE1 | SKILL.md:59 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 3 | AE1 | SKILL.md:110 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 4 | AE1 | SKILL.md:53 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 5 | AE1 | SKILL.md:59 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 6 | PE3 | test/integration.test.mjs:333 | disagreed | 隔离测试夹具，不读取真实凭据 |
| 7 | PE3 | test/integration.test.mjs:335 | disagreed | 隔离测试夹具，不读取真实凭据 |
| 8 | RP1 | README.md:23 | confirmed | 示例供应链边界已修正，待发布后复扫 |
| 9 | RP1 | README.zh.md:23 | confirmed | 示例供应链边界已修正，待发布后复扫 |
| 10 | LP3 | SKILL.md:1 | disagreed | 宿主权限边界，不能用预授权字段消警 |
| 11 | SSRF2 | test/integration.test.mjs:893 | disagreed | 隔离测试夹具，不读取真实凭据 |
| 12 | PE1 | SKILL.md:86 | disagreed | 文字要求不提权，非提权指令 |
| 13 | SC1 | package.json:12 | disagreed | 随包锁文件与 npm ci；保留用户选定依赖策略 |
| 14 | SC1 | package.json:13 | disagreed | 随包锁文件与 npm ci；保留用户选定依赖策略 |
| 15 | SC1 | package.json:14 | disagreed | 随包锁文件与 npm ci；保留用户选定依赖策略 |

### nextjs-to-tauri 1.1.19

来源：[原始报告](https://clawhub.ai/api/v1/skills/nextjs-to-tauri/verify?version=1.1.19)。完整静态覆盖 20%。

| # | 规则 | 位置 | 扫描复核 | 本地判断 |
| --- | --- | --- | --- | --- |
| 1 | AE1 | SKILL.md:46 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 2 | AE1 | SKILL.md:58 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 3 | AE1 | SKILL.md:109 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 4 | AE1 | SKILL.md:104 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 5 | AE1 | SKILL.md:116 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 6 | AE1 | SKILL.md:136 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 7 | AE1 | SKILL.md:139 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 8 | AE1 | SKILL.md:143 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 9 | AE1 | SKILL.md:106 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 10 | AE1 | SKILL.md:107 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 11 | AE1 | SKILL.md:109 | 覆盖不足 | 解析覆盖缺口，保留待人工复核 |
| 12 | RA1 | SKILL.md:139 | disagreed | 目标项目/应用更新，不修改 skill 本体 |
| 13 | RA1 | desktop-build.yml:198 | disagreed | 目标项目/应用更新，不修改 skill 本体 |
| 14 | TM1 | desktop-build.yml:311 | disagreed | 固定路径的摘要重算清理 |
| 15 | LP3 | SKILL.md:1 | disagreed | 宿主权限边界，不能用预授权字段消警 |
| 16 | E1 | SKILL.md:53 | disagreed | 官方上游版本查询 |
| 17 | PE2 | desktop-build.yml:19 | disagreed | Linux runner 安装构建系统库 |
| 18 | PE2 | desktop-build.yml:114 | disagreed | Linux runner 安装构建系统库 |
| 19 | PE2 | desktop-build.yml:118 | disagreed | Linux runner 安装构建系统库 |

## 后续与验证边界

本轮为 README 澄清和安装示例修改，未改动渲染、上传或 Tauri 构建执行代码。本地根测试 45/45 通过，技能校验为 0 failure / 0 warning。不用本地测试替代远端扫描结论；本次已实际提交、推送并完成新版本扫描。nextjs-to-tauri 本轮未改动或重新发布；其解析覆盖缺口和误报仍可能需要人工复核。尚未代用户发送申诉。

## 重新发布与扫描结果

2026-11-15，修复提交 [ed69ac6](https://github.com/rockbenben/aishort-skills/commit/ed69ac64f67ebbb3c9da33f69ae62ece0f6c5f0a) 已推送到 main。[发布 CI](https://github.com/rockbenben/aishort-skills/actions/runs/43713068809) 中两个发布 job 均成功，随后等待并读取指定版本的扫描结果，核对官方审计页面。

| Skill | 新版本 | 最终安全判定 | 官方审计页 | 底层 Skillspector 条目 |
| --- | --- | --- | --- | --- |
| md-web | 1.3.11 | clean / benign，security.passed=true | [Pass](https://clawhub.ai/rockbenben/skills/md-web/security-audit) | 9 → 8 |
| html-shot | 1.2.8 | clean / benign，security.passed=true | [Pass](https://clawhub.ai/rockbenben/skills/html-shot/security-audit) | 15 → 13 |

结果来自对应版本的 scan 与 verify API，而非旧版本缓存。两个审计页显示的版本分别为 1.3.11 和 1.2.8。html-shot 的最终安装机制维度为 OK；md-web 的指令范围维度为 OK。底层仍有解析覆盖不足和未被最终审核确认的提示，因此 Pass 不等于所有扫描器零告警或完整安全证明。

verify API 的总 decision 仍为 fail，唯一 reason 为 card.missing；这与其中 security.passed=true 是不同字段。该 reason 表示生成卡片缺失，不是安全审计失败，官方安全审计页已明确显示 Pass。本轮未将卡片生成作为额外发布动作处理。
