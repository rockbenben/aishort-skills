# Skill 路由验收

修改触发描述时，将输入类型、用户目标和外部动作一起核对。以下示例供人工或代理评估使用，文本匹配测试无法证明代理实际选路正确。

| 请求 | 预期入口与范围 |
| --- | --- |
| “翻译这句日常问候”，译文明确且错误代价低 | 直接翻译。 |
| “用 DeepL 翻译这段” | deepl-translate-node，先检查密钥及内容外发范围。 |
| “这个合同术语有两个可能含义，帮我核对译法” | deepl-translate-node，结合上下文和高风险歧义判断；受限内容需要相应外发授权。 |
| “把这份 Markdown 做成本地预览” | 使用本地预览工具。 |
| “把这份 Markdown 发布为公开分享链接” | md-web，当前文档上传已获授权；查看器部署和保留策略分别核对授权范围。 |
| “在这个桶初始化 md-web 查看器” | md-web 的 setup，说明共享根文件覆盖范围后执行已获授权的初始化。 |
| “把 Python 程序打包成 exe” | 根据 Python 项目选择打包方案。 |
| “把 Next.js 静态导出做成 Windows Electron，运行环境没有 WebView2” | nextjs-to-electron。 |
| “把 Next.js 16 App Router 静态导出迁移到 Tauri 2” | nextjs-to-tauri。 |
| “给依赖运行时 SSR 的 Next.js 服务做桌面版” | 先评估服务端依赖和静态导出阻碍，再选实现路线。 |
| “只读检查已有 Tauri/Electron 应用的依赖、打包和更新” | desktop-app-standard，保持只读范围。 |
| “只查 WPF 项目的 SDK/TFM 支持期” | desktop-app-standard --dotnet，静态审计。 |
| “修复 WPF 多显示器 DPI 错位” | wpf-desktop，验证受影响窗口和依赖。 |
| “导出这个 HTML 卡片为透明 PNG” | html-shot 的 render.mjs。 |
| “从现有 SVG 生成应用图标” | html-shot 的 icons.mjs。 |

仍有歧义时核对项目文件和用户目标，再进入对应任务模式。
