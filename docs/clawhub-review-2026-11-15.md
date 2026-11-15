# ClawHub 扫描复核与 md-web 上传故障（2026-11-15）

对照当前工作区代码复核，不把远端旧版扫描当作本地新版结论。本报告没有提交申诉、发布新包或触发付费重扫。

## 结论与实际修复

| Skill | 已扫描版本 | 本地修复版本 | 修复 |
| --- | --- | --- | --- |
| desktop-app-standard | 0.9.15 | 0.9.20 | 未记录的平台缩减只报告漂移，不再缩减检查覆盖；Tauri 全平台草稿校验后自动公开，失败保留草稿；拒绝覆盖已公开版本，发布前复核 tag，稳定版显式更新 latest。 |
| nextjs-to-tauri | 1.1.16 | 1.1.19 | 更正 workflow 写入边界：项目、系统包、缓存、临时目录和 GitHub 草稿资产；npm 示例只执行已安装的 Tauri；同步共用资产校验脚本。 |
| md-web | 1.3.2 | 1.3.10 | 搜索参数转义 HTML 属性；凭据以 wx/0600 创建后再写，POSIX 目录 0700，拒绝符号链接和错误所有者，权限失败停止；共享 setup 必须显式传入确认参数。 |

md-web 共享写入命令变为：

```sh
node "{SKILL_DIR}/upload.js" --setup --confirm-shared-writes
```

此参数记录任务中已有的 setup/retention 授权，不证明某个人已点击确认；代理仍须遵守 SKILL.md 的授权范围。普通上传不需要该参数。旧版中 viewer 条件写入、不可变资产目录及生命周期保留其他规则等问题，当前代码已另有实现和回归测试，保留不回退。

Windows 的文件 mode 不能代替 ACL。本次验证了私密模式创建顺序、独占创建、拒绝符号链接及错误处理；POSIX chmod/uid 分支有故障注入覆盖，但未在真实 Linux 文件系统上运行。Windows 请使用用户私有目录或环境凭据，未声称修复任意共享 Windows 目录的 ACL。

## Forbidden 的证据

[失败 CI job](https://github.com/rockbenben/aishort-skills/actions/runs/43200191940/job/131122905754) 在发布 md-web@1.3.7 时收到带 Vercel 请求标识的纯文本 Forbidden。

2026-11-15 对官方 POST /api/v1/skills 做无凭据请求，不发送任何 Token，因未认证无法发布。相同 multipart 路径、公开源码内容分组测试得到：

| 请求内容 | 状态 | 关键响应头 / 结果 |
| --- | --- | --- |
| wpf-desktop 完整包 | 401 | 到达应用认证检查，缺少 API Token |
| md-web 完整包 | 403 | x-vercel-mitigated: deny，纯文本 Forbidden |
| md-web 不含触发文件的一组内容 | 401 | 到达认证检查 |
| docsify-server/assets/docsify.min.js 单个文件 | 403 | x-vercel-mitigated: deny |
| 相邻 config.js、countable.min.js，及另一组 search/toc/vue 文件 | 401 | 到达认证检查 |

单个文件复现请求标识：sfo1::x6h2w-1794732909597-97845729915b；完整包复现标识：sfo1::vmgln-1794732333672-66eed94e92a7。CI 请求标识：cle1::z7fdf-1794479312644-585f7ab910f5。

触发文件 SHA256：4d157ba792c951cba8dcad871ea200ee3cf2571ef2d4d82ab684dcb342baf28c。该文件与失败 CI 提交 886930f 的内容一致（归一化换行比较），未通过删文件、改名、编码或改写第三方代码绕过防护。ClawHub CLI 0.8.0 将所有文件作为 multipart POST 上传；响应来自 Vercel 防护层而非业务鉴权错误。由此确认 md-web 上传被该文件内容触发的边缘防护拒绝，不是这次请求的 Token/包所有权/needs-review 认证失败。Vercel 具体规则编号、为何命中、历史 CI 同一时刻的防护日志需 ClawHub 管理方查询，客户端无法取得，不能推断成已证明的具体规则漏洞。

三个包的公开 scan API 均返回 isMalwareBlocked=false、isHiddenByMod=false、isSuspicious=false；security.status=suspicious 是扫描判定，与 moderation 字段不同。不能用 needs review 标签推导发布禁令。

处理路径：向 ClawHub 提交以上时间、请求标识、文件散列和正常第三方库的复现证据，请其检查防护误拦截，或确认官方支持的上传路径。尚未发送申诉。重新生成 Token 或无条件重试不能解决这个已复现的内容触发问题；实际发布成功与新版本审核状态仍待上游解除拦截后验证。

## 误报、正常能力及扫描覆盖缺口

- 网络读取：审计脚本读取官方发布元数据与 changelog；requestJson 只允许列出的 HTTPS 上游，GitHub Token 仅给 api.github.com，拒绝重定向。测试中的 URL/Token 是固定假数据，不能算真实外传。路径和依赖名可能随查询发送，不能声称完全无外部元数据。
- sudo 与多条命令：仅在选择的 Linux CI runner 安装打包所需系统库，不是在用户主机偷偷提权；顺序 apt 命令不构成绕过安全检查。
- 工具安装：测试和正则中的 npx 是被检查的字符串；实际 Electron 模板先 npm ci，已有锁定依赖。npm 的 npx 仍可能在包缺失时下载，因此这是需要维护的供应链边界；本次没有伪造版本 pin 或删除测试来消警。nextjs-to-tauri 的执行示例已改为 npm exec --no -- tauri。
- md-web 安装器：实际执行示例固定 skills@1.7.2；被扫描命中的不带版本语句是在解释不应使用的写法。它不是 MCP 服务。
- 自我修改：nextjs-to-tauri 修改的是目标项目的 package.json / tauri.conf.json；updater 更新用户安装的目标应用，不是修改已安装 skill。
- setup 持久化：md-web 保存用户明确配置的连接信息和部署提示，不创建启动项、cron、服务或后台代理。明文凭据存储仍是实际设计，目录权限与环境凭据说明保留。
- 安装/卸载英文界面：这是所选 house style 的显式产品默认，用户当前要求优先；它不是秘密改写应用 UI 语言或恶意载荷。保持该默认，不为扫描分数删除用户选择的规范。
- allowed-tools 缺失：三个技能已用正文、环境变量元数据与文件列表声明用途。allowed-tools 在部分宿主表示预授权，不是跨宿主的权限沙箱；不为消警加入宽泛工具预授权。宿主实际权限仍需由宿主控制。
- AE1 分析不完整：原始报告给出 static_parse_limit、opaque_content、reference_missing 等理由；三个报告的 entirely_uninspected_files 均为 0。它们说明静态解析覆盖有限，不证明恶意逃逸，也不能当作扫描全通过。保留源码/测试/必要引用，等待解析器改进或人工复核。

## 逐项索引

以下按官方 verify API 的原始 issues 顺序列出全部 84 条 Skillspector 反馈，以及 md-web 的 2 条 A.I.G 反馈。定位行号属于已发布旧版本；当前行号因改动而变化。网页会隐藏部分低置信度卡片，不能用网页卡片数代替 issues 总数；原 audit-warnings.mjs 的网页解析会因此误报抓取不完整，本次已改为版本固定的原始 API，同时核验版本与条目总数，并包含 A.I.G 条目。

### desktop-app-standard

来源：[扫描摘要](https://clawhub.ai/api/v1/skills/desktop-app-standard/scan) · [原始扫描报告](https://clawhub.ai/api/v1/skills/desktop-app-standard/verify?version=0.9.15)。远端 0.9.15，本地 0.9.20；静态完整覆盖 62.2%。

| # | 规则 | 旧版位置 | 核实结果 | 依据 / 处理 |
| --- | --- | --- | --- | --- |
| 1 | AE1 | SKILL.md:13 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 2 | AE1 | SKILL.md:14 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 3 | AE1 | SKILL.md:15 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 4 | AE1 | SKILL.md:16 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 5 | AE1 | SKILL.md:18 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 6 | AE1 | SKILL.md:19 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 7 | AE1 | SKILL.md:94 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 8 | AE1 | SKILL.md:20 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 9 | AE1 | SKILL.md:21 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 10 | TM2 | templates/workflows/ci.yml:33 | 正常 CI 能力 | Linux runner 系统库安装，测试样本不执行提权。 |
| 11 | TM2 | templates/workflows/release-tauri.yml:43 | 正常 CI 能力 | Linux runner 系统库安装，测试样本不执行提权。 |
| 12 | TM2 | templates/workflows/release-tauri.yml:101 | 正常 CI 能力 | Linux runner 系统库安装，测试样本不执行提权。 |
| 13 | LP3 | SKILL.md:1 | 权限边界说明 | 不是 MCP 权限清单；不扩大宿主工具预授权来消警。 |
| 14 | SQP-3 | SKILL.md:91 | 显式产品规范 | 英文安装向导默认有意保留，用户请求可覆盖。 |
| 15 | SQP-3 | references/bootstrap.md:74 | 显式产品规范 | 英文安装向导默认有意保留，用户请求可覆盖。 |
| 16 | SQP-3 | references/house-style.md:27 | 显式产品规范 | 英文安装向导默认有意保留，用户请求可覆盖。 |
| 17 | SDI-4 | scripts/audit.mjs:201 | 真实问题，已修复 | 保留全平台默认覆盖。 |
| 18 | E1 | scripts/audit.mjs:540 | 误报（非秘密外传） | 官方上游元数据读取；Token 限定 api.github.com。 |
| 19 | E1 | tests/release-assets.test.mjs:72 | 误报（非秘密外传） | 测试假 URL/模拟网络响应。 |
| 20 | E1 | scripts/audit.mjs:575 | 误报（非秘密外传） | 官方上游元数据读取；Token 限定 api.github.com。 |
| 21 | E1 | scripts/audit.mjs:576 | 误报（非秘密外传） | 官方上游元数据读取；Token 限定 api.github.com。 |
| 22 | RP1 | scripts/ci-traps.mjs:143 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 23 | E1 | scripts/core.mjs:181 | 误报（非秘密外传） | 官方上游元数据读取；Token 限定 api.github.com。 |
| 24 | E1 | tests/cli.test.mjs:665 | 误报（非秘密外传） | 测试假 URL/模拟网络响应。 |
| 25 | E1 | tests/core.test.mjs:63 | 误报（非秘密外传） | 测试假 URL/模拟网络响应。 |
| 26 | E1 | tests/core.test.mjs:71 | 误报（非秘密外传） | 测试假 URL/模拟网络响应。 |
| 27 | E1 | tests/core.test.mjs:75 | 误报（非秘密外传） | 测试假 URL/模拟网络响应。 |
| 28 | E1 | tests/release-assets.test.mjs:113 | 误报（非秘密外传） | 测试假 URL/模拟网络响应。 |
| 29 | SQP-3 | scripts/delivery-checks.mjs:29 | 显式产品规范 | 英文安装向导默认有意保留，用户请求可覆盖。 |
| 30 | PE2 | templates/workflows/ci.yml:34 | 正常 CI 能力 | Linux runner 系统库安装，测试样本不执行提权。 |
| 31 | PE2 | templates/workflows/ci.yml:35 | 正常 CI 能力 | Linux runner 系统库安装，测试样本不执行提权。 |
| 32 | E1 | templates/workflows/ci.yml:35 | 误报（非秘密外传） | 安装 Linux 编译系统依赖。 |
| 33 | RP1 | templates/workflows/release-electron.yml:105 | 工具供应链边界 | npm ci 先安装锁定构建依赖；后续打包命令不是 MCP，保留包缺失时的 npx 下载风险说明。 |
| 34 | PE2 | templates/workflows/release-tauri.yml:44 | 正常 CI 能力 | Linux runner 系统库安装，测试样本不执行提权。 |
| 35 | PE2 | templates/workflows/release-tauri.yml:45 | 正常 CI 能力 | Linux runner 系统库安装，测试样本不执行提权。 |
| 36 | PE2 | templates/workflows/release-tauri.yml:102 | 正常 CI 能力 | Linux runner 系统库安装，测试样本不执行提权。 |
| 37 | PE2 | templates/workflows/release-tauri.yml:103 | 正常 CI 能力 | Linux runner 系统库安装，测试样本不执行提权。 |
| 38 | PE2 | tests/core.test.mjs:259 | 正常 CI 能力 | Linux runner 系统库安装，测试样本不执行提权。 |
| 39 | SDI-4 | templates/workflows/release-tauri.yml:129 | 真实问题，已修复 | 全部草稿资产验证后才自动公开。 |
| 40 | RP1 | tests/cli.test.mjs:145 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 41 | RP1 | tests/cli.test.mjs:146 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 42 | RP1 | tests/cli.test.mjs:224 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 43 | RP1 | tests/cli.test.mjs:494 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 44 | RP1 | tests/cli.test.mjs:501 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 45 | RP1 | tests/cli.test.mjs:501 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 46 | RP1 | tests/cli.test.mjs:531 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 47 | RP1 | tests/core.test.mjs:214 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 48 | EA2 | tests/cli.test.mjs:238 | 误报 | CI 陷阱测试样本，不执行高影响决策。 |
| 49 | E1 | tests/core.test.mjs:70 | 误报（非秘密外传） | 测试假 URL/模拟网络响应。 |
| 50 | RP1 | tests/core.test.mjs:217 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 51 | RP1 | tests/core.test.mjs:217 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 52 | RP1 | tests/core.test.mjs:224 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 53 | RP1 | tests/core.test.mjs:224 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 54 | RP1 | tests/core.test.mjs:217 | 工具供应链边界 | 测试/检查正则中的字符串不执行外部 MCP。 |
| 55 | SQP-3 | tests/delivery-checks.test.mjs:43 | 显式产品规范 | 英文安装向导默认有意保留，用户请求可覆盖。 |

### nextjs-to-tauri

来源：[扫描摘要](https://clawhub.ai/api/v1/skills/nextjs-to-tauri/scan) · [原始扫描报告](https://clawhub.ai/api/v1/skills/nextjs-to-tauri/verify?version=1.1.16)。远端 1.1.16，本地 1.1.19；静态完整覆盖 20%。

| # | 规则 | 旧版位置 | 核实结果 | 依据 / 处理 |
| --- | --- | --- | --- | --- |
| 1 | AE1 | SKILL.md:42 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 2 | AE1 | SKILL.md:54 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 3 | AE1 | SKILL.md:104 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 4 | AE1 | SKILL.md:99 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 5 | AE1 | SKILL.md:155 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 6 | AE1 | SKILL.md:162 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 7 | AE1 | SKILL.md:101 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 8 | AE1 | SKILL.md:102 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 9 | AE1 | SKILL.md:104 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 10 | RA1 | SKILL.md:158 | 误报 | 目标项目版本/目标应用更新，不改 skill 本体。 |
| 11 | RA1 | desktop-build.yml:196 | 误报 | 目标项目版本/目标应用更新，不改 skill 本体。 |
| 12 | TM1 | desktop-build.yml:309 | 正常清理步骤 | 删除 dist/SHA256SUMS 后重算，固定文件路径。 |
| 13 | LP3 | SKILL.md:1 | 权限边界说明 | 不是 MCP 权限清单；不扩大宿主工具预授权来消警。 |
| 14 | RP1 | SKILL.md:42 | 工具供应链边界 | 改为 npm exec --no -- tauri，缺少本地工具即失败。 |
| 15 | E1 | SKILL.md:49 | 误报（非秘密外传） | 官方依赖版本查询。 |
| 16 | PE2 | desktop-build.yml:112 | 正常 CI 能力 | Linux runner 系统库安装，测试样本不执行提权。 |
| 17 | PE2 | desktop-build.yml:116 | 正常 CI 能力 | Linux runner 系统库安装，测试样本不执行提权。 |
| 18 | SDI-4 | desktop-build.yml:15 | 文档不准确，已修复 | 声明系统包、临时文件、缓存及远程资产写入。 |

### md-web

来源：[扫描摘要](https://clawhub.ai/api/v1/skills/md-web/scan) · [原始扫描报告](https://clawhub.ai/api/v1/skills/md-web/verify?version=1.3.2)。远端 1.3.2，本地 1.3.10；静态完整覆盖 50%。

| # | 规则 | 旧版位置 | 核实结果 | 依据 / 处理 |
| --- | --- | --- | --- | --- |
| 1 | AE1 | SKILL.md:35 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 2 | AE1 | SKILL.md:54 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 3 | AE1 | SKILL.md:126 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 4 | AE1 | SKILL.md:130 | 扫描覆盖限制 | 未完整解析的证据，不能归类为恶意或已安全。 |
| 5 | RP1 | README.md:19 | 误报 | 实际安装示例已固定版本，命中的是反例文字。 |
| 6 | RP1 | README.zh.md:19 | 误报 | 实际安装示例已固定版本，命中的是反例文字。 |
| 7 | AS3 | README.md:26 | 误报 | 指导审阅本技能源码和版本，不枚举其他技能。 |
| 8 | AS3 | README.zh.md:24 | 误报 | 指导审阅本技能源码和版本，不枚举其他技能。 |
| 9 | LP3 | SKILL.md:1 | 权限边界说明 | 不是 MCP 权限清单；不扩大宿主工具预授权来消警。 |
| 10 | RA2 | SKILL.md:109 | 正常用户配置 | 存储已声明的凭据/部署状态，不是后台自启动。 |
| 11 | TM3 | upload.js:181 | 真实问题，已修复 | 凭据先私密创建，再写入；失败停止。 |
| AIG | T09 | docsify-server/assets/search.min.js | 真实问题，已修复 | 转义 URL 搜索参数的 HTML 属性。 |
| AIG | T09 | upload.js | 真实问题，已修复 | setup 增加显式共享写入确认参数。 |

## 验证边界

本地根测试 44/44 通过，包含隔离安装、桌面审计/资产验证、WPF 打包回归及 md-web 安全回归。md-web 的 viewer、publish、lifecycle 独立检查均为 0 failure；技能校验为 0 failure / 0 warning。三个包的原始报告抓取也分别成功，取得 55、18、11 条 Skillspector 反馈及 md-web 的 2 条 A.I.G 反馈。未在真实 GitHub tag 上发布桌面应用；未执行真实 S3 写入；未对新版本取得 ClawHub 审核结论。
