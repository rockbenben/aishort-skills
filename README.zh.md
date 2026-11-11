# aishort-skills

> 把手边的东西变成能交付的东西 —— 每个技能都是一个自成一体的 Agent Skill。

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

一组给 AI 编程助手用的技能 —— 适用于 [Claude Code](https://claude.com/claude-code)、[Cursor](https://cursor.com)、[OpenClaw](https://clawhub.ai)，以及任何读 `SKILL.md` 的代理。每个技能就是 [`skills/`](skills/) 下的一个目录。

[English](README.md)

## 安装

```bash
# ClawHub / OpenClaw —— 按名字装单个技能
clawhub install md-web
clawhub install deepl-translate-node
clawhub install html-shot
clawhub install wpf-desktop
clawhub install nextjs-to-tauri
clawhub install nextjs-to-electron
clawhub install desktop-app-standard

# skills.sh —— 装整个仓库（Claude Code、Cursor 等）
npx skills add rockbenben/aishort-skills
```

也可以直接克隆本仓库，复制（或链接）某个技能目录放进你的代理读技能的目录 —— Claude Code 用 `~/.claude/skills/`，Codex 和 Gemini CLI 这类跨运行时约定用 `~/.agents/skills/`，或者你的代理自己约定的地方。

## 技能

### [md-web](skills/md-web/) —— Markdown → 可分享的网页

把 Markdown 文件渲染成一份体面的、可分享的网页，而不是把大段文字倒进对话里。 `.md` 会传到你**自己**的 S3 兼容存储（Cloudflare R2、AWS S3、Backblaze B2……），由内置的零 CDN Docsify 服务渲染，你拿回一个可点开的链接。

```bash
clawhub install md-web
```

- **需要**：Node.js，以及一个开放公网访问的 S3 兼容存储。
- **文档**：[English](skills/md-web/README.md) · [中文](skills/md-web/README.zh.md)
- 零运行时依赖；凭据只留在本机 `~/.md-web/config.json`。

### [deepl-translate-node](skills/deepl-translate-node/) —— 只在拿不准时才用 DeepL

只有当你自己的翻译**可能出错、而出错要付代价**时才用 [DeepL](https://www.deepl.com/) —— 专有名词、法律/医学/技术术语、小众语言、任何高风险场合。价值在触发逻辑，不在 API 本身。

```bash
clawhub install deepl-translate-node
```

- **需要**：Node.js 18+，以及一个 `DEEPL_API_KEY`（免费额度就够；`DEEPL_API_HOST` 用于切到 Pro 端点）。
- **用法与语言代码**：[`SKILL.md`](skills/deepl-translate-node/SKILL.md)

### [html-shot](skills/html-shot/) —— 设计进去，图片资产出来

把 HTML 文件、URL 或 SVG 变成一张静态图：og:image 和社交卡、应用图标和 logo 主图、把设计导出成 PNG、整页截图。用无头 Chromium（Playwright）意味着 **完整 CSS 保真，中文与 emoji 直接走系统字体** —— 不用打包字体、不用裁字体、不用第三方渲染服务。本地文件通过一次性的 `127.0.0.1` 服务提供，字体、图片、`@import` 和 `srcset` 都按真实站点的方式解析 —— 项目开发服务器没开也能把卡片渲对。输出尺寸从 `body` 读取，所以改尺寸是改 CSS，不是改命令； `--palette` 还能把扁平卡片压到原来的一半左右。第二个入口 `icons.mjs` 把一份源文件变成 favicon 或应用图标集（`.ico`/`.icns`/apple-touch/PWA），文件名按 Docusaurus、Next、Electron 或 Tauri 各自的约定给出 —— 目标要几个就给几个，从文档站只要一个 `favicon.ico` 到可安装的 PWA 给全套五个。它也不造假：需要栅格图标时非正方形源直接拒绝（纯 SVG 透传是例外），源图比平台要求的尺寸小时会直接拒绝并把两个尺寸都报出来 —— 不会悄悄加黑边，也不会放大后打 ✔，除非你显式加 `--allow-upscale`。

```bash
clawhub install html-shot
```

- **需要**：Node.js ≥ 20.9，glibc Linux、macOS 或 Windows（不支持 Alpine/musl）。首次安装要拉约 50 MB 依赖，外加约 190 MB 的 Chromium 下载（连 Playwright 一并装的 headless shell 约 300 MB）、约 700 MB 磁盘占用，按 Playwright 版本缓存一次。
- **文档**：[English](skills/html-shot/README.md) · [中文](skills/html-shot/README.zh.md)
- **参考**：[`SKILL.md`](skills/html-shot/SKILL.md) · 起步模板：[`template.example.html`](skills/html-shot/template.example.html)（og 卡）· [`icon.example.html`](skills/html-shot/icon.example.html)（透明图标 / 主图）

### [wpf-desktop](skills/wpf-desktop/) —— .NET 上的 WPF 桌面应用

只给 WPF 项目时，全面检查 SDK、NuGet、启动、窗口、DPI、托盘和发布配置，并修复可验证的问题。新建或整体升级对齐 **.NET 10**。局部修复检查受影响路径，只做必要的配套升级。只读评估交付发现与证据。

```bash
clawhub install wpf-desktop
```

- **需要**：Windows 上的 .NET 10 SDK；发版流水线需要 GitHub Actions。
- **语言**：英文入口，中文起手指南、依赖升级、故障排查和发布参考。
- **参考**：[`SKILL.md`](skills/wpf-desktop/SKILL.md)

### [nextjs-to-tauri](skills/nextjs-to-tauri/) —— Next.js 16 → Tauri 2 桌面应用

把纯客户端的 Next.js 16（App Router）应用包进一层薄薄的 Tauri 2 原生外壳 —— 发布一个约 3–10 MB 的桌面/便携版 `.exe`（Electron 约 150 MB），自带自动更新、系统托盘、单实例和窗口状态，全部在 GitHub Actions 里构建（本地不需要 Rust）。价值在那些踩过的坑：静态导出时 `trailingSlash` 导致的白屏、next-intl 的 i18n 路由、updater 签名密钥，以及跨平台 CI。

```bash
clawhub install nextjs-to-tauri
```

- **需要**：可静态导出的 Next.js 16 应用；构建需要 GitHub Actions。
- **参考**：[`SKILL.md`](skills/nextjs-to-tauri/SKILL.md)

### [nextjs-to-electron](skills/nextjs-to-electron/) —— Next.js → Electron 桌面应用

把纯客户端的 Next.js（App Router）静态导出包进一层薄薄的 Electron 外壳 —— 给**完全离线 / 内网**、缺 WebView2 运行时的 Windows 机器用，那种机器上 Tauri 起不来。 Electron 自带 Chromium（约 150 MB），所以直接能跑。优先用 `electron/` 主进程承接语言持久化、窗口状态、单实例和系统托盘，必要时调整静态导出或桌面集成代码，保留 Web 构建行为。价值在那些坑：`file://` 白屏陷阱、自定义 `app://` 协议、next-intl 静态导出 i18n，以及 electron-builder 打包。

```bash
clawhub install nextjs-to-electron
```

- **需要**：可静态导出的 Next.js 应用；Windows 构建需要 GitHub Actions。
- **参考**：[`SKILL.md`](skills/nextjs-to-electron/SKILL.md)

### [desktop-app-standard](skills/desktop-app-standard/) —— 按 house style 建与升 Tauri/Electron 桌面应用，并审计 .NET 运行时/SDK

**建**：这套 house style 以十个短章节和 workflow 模板交付，覆盖六个目标（Windows/macOS/Linux × x64/arm64）、npm 和锁文件、Action 大版本或精确版本标签、不装 Dependabot、git tag 作为版本源、测试和打包后直接公开、内置 updater、计算摘要和上传前完成签名，以及由 winget-manifests 统一维护 winget 清单。

只给项目时，全面检查版本、安全配置、性能、打包和更新链路，并修复可验证的问题。新建或整体升级按技能的[目标大版本表](skills/desktop-app-standard/references/version-targets.json)更新依赖及锁文件。局部修复只做必要的配套升级。只读评估交付发现与证据。

符合 house style 的发现按 `notice` 报，不计入 P0/P1/P2；已经做过的取舍写进 `.desktop-policy.json` 的 `deviations`（带 reason 与 revisitWhen），此后那条发现按"已接受"处理，不再每周来烦你。

.NET 运行时/SDK 生命周期现在由 `audit.mjs --dotnet` **自动审计**：读取 TargetFramework 与 `global.json`，按官方 release metadata 检查支持阶段/EOL，并判断 SDK pin 的 `rollForward` 能否到最新。WPF 的构建/发布实现（XAML、DPI、托盘、单文件发布）仍在 `wpf-desktop`。

```bash
clawhub install desktop-app-standard
```

- **需要**：Node.js 22+（脚本自身的下限；桌面项目按当前 Active LTS 那条线构建）、能访问 GitHub API（`GITHUB_TOKEN` 可选，只是提高限流）；`--dotnet` 还需要 .NET release-metadata 端点（或用 `--offline` 只取本地事实）。
- **参考**：[`SKILL.md`](skills/desktop-app-standard/SKILL.md) · [`references/house-style.md`](skills/desktop-app-standard/references/house-style.md)（全貌 + 我们的立场）· [`references/release-flow.md`](skills/desktop-app-standard/references/release-flow.md) · [`references/adopt-checklist.md`](skills/desktop-app-standard/references/adopt-checklist.md)

## 仓库结构

```
skills/
├── md-web/                # Markdown → 可分享的网页（S3 + Docsify）
├── deepl-translate-node/  # 只在拿不准时才用的 DeepL 兜底翻译
├── html-shot/             # HTML/SVG/URL → og:image、社交卡、截图、favicon/应用图标集
├── wpf-desktop/           # .NET 上的 WPF 桌面应用 —— 依赖、坑、调试开关、发版 CI
├── nextjs-to-tauri/       # Next.js 16 → Tauri 2 桌面应用迁移
├── nextjs-to-electron/    # Next.js → Electron 桌面应用（离线 / 无 WebView2）
└── desktop-app-standard/ # Tauri/Electron house style —— 骨架、巡检，以及 .NET 运行时/SDK 审计
assets/               # 仓库社交预览图 + html-shot 首屏图（HTML 源文件与渲染出的 PNG），放在 skills/ 之外，装技能时不会带上
scripts/              # validate-skills.mjs —— CI 卡发布用的 frontmatter、打包文件与体积检查
.github/workflows/    # CI：校验、跑 md-web / html-shot / desktop-app-standard 的测试，然后在 push 时把变动的技能自动发布到 ClawHub
```

仓库维护在根目录执行 `npm ci`、`npm test` 和 `npm run validate`。根目录包清单及锁文件只用于维护工具，不是单个 skill 的运行依赖。校验与发布共用锁定的 ClawHub 文件收集逻辑。`npm test` 默认检查全部 skill 的隔离安装和自测；CI 按变更 skill 选择对应测试，在 html-shot 的隔离安装中运行浏览器测试，仅 WPF 相关变更运行 Windows 打包测试。修改根工具或工作流时跑全套，PR 只测试不发布。触发描述可按[路由示例](docs/skill-routing.md)人工复核。

## 经验回传与维护

技能版本统一写为 `metadata.version` 下的字符串。发布工具保留对历史顶层 `version` 字段的读取支持。修改已发布技能时递增补丁版本，并同步技能内的包清单与锁文件版本。

回传用于改进 skill。收到使用反馈后，结合现有内容判断是否存在可复用的缺口，直接修改相应指导、脚本、模板或测试，也可以删减无效或重复内容。没有值得改的地方就不改，无需单独编写经验记录。

- 优先修改已有位置。同一决策只保留一处指导，不把单个项目的做法升级为通用要求。
- 按改动验证效果；修复脚本或模板缺陷时，优先补能复现问题的回归测试。验证投入与改动相称。
- `SKILL.md` 保留通用入口与关键指导，较长的专项细节按需放入参考文件。
- 项目经过、测试总数、耗时和版本快照留在源项目。只有影响后续使用判断的环境限制或未验证范围才需简要保留；不要求创建或逐次更新 `VALIDATION.md`。
