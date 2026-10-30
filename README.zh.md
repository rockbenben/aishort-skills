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

用 WPF 构建、调试和发布**原生** Windows 桌面工具（托盘程序、单文件 `.exe` 便携版）—— 不掺 web 技术栈。讲清了哪些依赖值得加（多数不值得）、为什么发布设置该写在 `pubxml` 而不是 `csproj`、WPF 默认会做错的窗口行为（DPI 感知、深色标题栏、打开时的白闪），以及带 SHA256 校验和、artifact attestation 和 winget 提交的标签触发式 GitHub Actions 发版流程。价值在那份按症状写的坑清单，每条都是自己撞过而不是抄来的：长文案下控件被整个裁掉、点不着，一次库调用多花约 770 ms 启动时间，还有把"有时就是不行"变成可执行结论的探针 —— 多语言与 DPI 下的离屏截图扫描、相位计时器、像素采样，以及从进程外面驱动界面。

```bash
clawhub install wpf-desktop
```

- **需要**：Windows 上的 .NET 10 SDK；发版流水线需要 GitHub Actions。
- **语言**：`SKILL.md` 是英文，后面的四份参考文档是**中文**。代理靠症状标题两条路都能路由，但不读中文的人只能拿到索引，读不到正文。
- **参考**：[`SKILL.md`](skills/wpf-desktop/SKILL.md)

### [nextjs-to-tauri](skills/nextjs-to-tauri/) —— Next.js 16 → Tauri 2 桌面应用

把纯客户端的 Next.js 16（App Router）应用包进一层薄薄的 Tauri 2 原生外壳 —— 发布一个约 3–10 MB 的桌面/便携版 `.exe`（Electron 约 150 MB），自带自动更新、系统托盘、单实例和窗口状态，全部在 GitHub Actions 里构建（本地不需要 Rust）。价值在那些踩过的坑：静态导出时 `trailingSlash` 导致的白屏、next-intl 的 i18n 路由、updater 签名密钥，以及跨平台 CI。

```bash
clawhub install nextjs-to-tauri
```

- **需要**：可静态导出的 Next.js 16 应用；构建需要 GitHub Actions。
- **参考**：[`SKILL.md`](skills/nextjs-to-tauri/SKILL.md)

### [nextjs-to-electron](skills/nextjs-to-electron/) —— Next.js → Electron 桌面应用

把纯客户端的 Next.js（App Router）静态导出包进一层薄薄的 Electron 外壳 —— 给**完全离线 / 内网**、缺 WebView2 运行时的 Windows 机器用，那种机器上 Tauri 起不来。 Electron 自带 Chromium（约 150 MB），所以直接能跑。`src/` 一行不动；所有桌面行为（语言持久化、窗口状态、单实例、系统托盘）都放在一层被动接线的 `electron/` 主进程里。价值在那些坑：`file://` 白屏陷阱、自定义 `app://` 协议、next-intl 静态导出 i18n，以及 electron-builder 打包。

```bash
clawhub install nextjs-to-electron
```

- **需要**：可静态导出的 Next.js 应用；Windows 构建需要 GitHub Actions。
- **参考**：[`SKILL.md`](skills/nextjs-to-electron/SKILL.md)

### [desktop-app-standard](skills/desktop-app-standard/) —— 按 house style 建与升 Tauri/Electron 桌面应用，并审计 .NET 运行时/SDK

**建**：这套 house style 以十个短章节 + 随之而来的 workflow 模板的形式交付。最要紧的几条：六个目标（Windows/macOS/Linux × x64/arm64）、npm 且锁文件是唯一事实来源、Action 钉大版本标签（要更紧就钉精确版本，绝不钉完整 SHA）、不装 Dependabot、git tag 是唯一版本号、草稿 → 校验 → 审批 → 发布、必须内置 updater、公开后再签名、winget 清单归 winget-manifests 仓管而不是发布仓。

**升**：把它指向一个已有的应用，它会读上游发布说明、逐条比对你自己的源码，产出按优先级排好的"该做什么"清单 —— 你暴露在哪些破坏性变更上、哪些功能值得跟进、哪些版本差会静默出事。它也覆盖 **CI 与发版链路**：钉住的 Actions（对着各 action 实际发布的 major 比）以及那些**悄悄**失效的发版套路 —— 没人发布的草稿、没人上传的 updater manifest、GitHub 没动的 `latest` 指针。每条结论都带着能证明它的文件与行号。

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
