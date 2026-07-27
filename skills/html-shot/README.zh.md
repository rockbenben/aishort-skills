# html-shot

> 一份设计进去，一套可直接交付的图出来 —— HTML、网址或 SVG 皆可，像素级还原，
> 中文与 emoji 一并搞定。

[![365 开源计划 #030](https://img.shields.io/badge/365%20%E5%BC%80%E6%BA%90%E8%AE%A1%E5%88%92-%23030-1f6feb)](https://github.com/rockbenben/365opensource)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/rockbenben/aishort-skills/blob/main/LICENSE)

[English](README.md) · **简体中文**

![html-shot —— 任意 HTML，拍成像素级还原的图片](https://raw.githubusercontent.com/rockbenben/aishort-skills/main/assets/html-shot/hero.png)

<sub>那张卡不是效果图，是这个 skill 自己从
<a href="https://github.com/rockbenben/aishort-skills/blob/main/assets/html-shot/hero.html">assets/html-shot/hero.html</a>
渲出来的 —— 一条命令，没打包任何字体。</sub>

一个 **agent skill**（适用于 Claude Code、Cursor、OpenClaw，以及任何能读 `SKILL.md`
格式的 agent），用无头 Chromium 把设计稿变成图片。渲染交给浏览器，浏览器周边的麻烦事
—— 路径、尺寸、锐度、体积 —— 由它兜住，让你不用离开 CSS。

## 用来做什么

- **og:image / 社交预览卡** —— 站点或仓库那张 1200×630 的卡。
- **用 HTML/CSS 写的设计稿** —— 徽章、横幅、示意图、证书 —— 导出成 PNG。
- **应用图标与 logo 母版** —— 来源可以是 HTML，也可以直接是 SVG，尺寸精确、背景透明。
  （SVG 要有 `viewBox` 才能缩放到画框；根标签声明了尺寸时会替它补一个，`viewBox`
  存在但读不出来时会就地改写，而不是放任那个坏的继续生效。）
- **截图** —— 整页，或页面里的某一个元素，来源可以是网址也可以是本地文件。
- **一张总表出多个物料** —— 把所有标记摆在同一页上，用 `--selector` 逐个拍，
  再用 `--style` 把总表自身的边框底色去掉。
- **任何中日韩、emoji 或混排的内容** —— 系统字体直接顶上，没有字体要裁剪或打包。

- **一套 favicon / 应用图标** —— `icons.mjs` 把一个源变成站点 / Electron / Tauri
  各自真正会读的那几个文件，文件名也按各自的约定。出几个由你定：文档页或内部工具
  用 `--only ico`（一个文件，不用接线），正式站点用默认的三个，可安装应用加 `--pwa`。
  源图请给**正方形**且分辨率够用的 —— 1024 px，或者带 `viewBox` 的矢量图。横版
  wordmark 会被直接拒绝；64 px 的小图会老老实实出 64 px 的 PNG 并给出提示，
  而不是给你一张软塌塌的 512。用
  `--preset next` 时，PWA 那两个文件要单独出一遍到 `public/`：manifest 是从站点根目录
  取它们的，而 `app/` 不是站点根目录。

## 为什么用无头 Chromium

既轻量、又能把任意 HTML 连中文一起渲染出来的方案并不存在，这是一个真实的取舍，
本 skill 选了一边：

| 方案 | 取舍 |
|---|---|
| **本 skill** —— 本地 Playwright | CSS 完全保真，中文走系统字体，不经第三方渲染服务。代价是要装一个 Chromium —— 或用 `--channel chrome` 借用本机已有的浏览器。 |
| **Satori / @vercel/og** | 不需要浏览器，最轻 —— 但只支持 CSS 子集，且**中文字体要你自己提供**。 |
| **托管 API**（html2png、hcti 等） | 无需安装，但有速率限制，且**你的内容会离开本机**。 |
| **wkhtmltoimage** | 老牌 CLI，已停止维护。 |

## 安装

```bash
# ClawHub / OpenClaw
clawhub install html-shot

# skills.sh（Claude Code、Cursor 等）—— 整个仓库一起装
npx skills add rockbenben/aishort-skills
```

或者 clone 本仓库，把 `skills/html-shot/` 拷贝（或软链）进 agent 的 skills 目录，
例如 `~/.claude/skills/html-shot`。

**仅首次运行** —— 装引擎：

```bash
npm --prefix ~/.claude/skills/html-shot install
node ~/.claude/skills/html-shot/node_modules/playwright/cli.js install chromium
```

- **需要：** Node.js ≥ 20.9，glibc Linux / macOS / Windows。**不支持 Alpine/musl** ——
  Playwright 没有 musl 版 Chromium。
- **占用：** 约 50 MB 依赖，外加约 150 MB 的 Chromium（全局缓存，多项目共用）。
  首次安装需要几分钟。
- **Linux 上**还多两步（Chromium 的共享库，以及中文/emoji 系统字体），见
  [`SKILL.md`](SKILL.md#first-run-install-the-engine-once)。

不用先去探测装没装 —— 直接跑，它会告诉你，并给出该执行的命令。

## 快速开始

`template.example.html` 是一张现成的 1200×630 卡片，只用系统字体：

```bash
cp ~/.claude/skills/html-shot/template.example.html og.html
node ~/.claude/skills/html-shot/render.mjs og.html og.png
```

整个循环就这些。改 `og.html`，重跑，看 PNG。

要做透明的标记或应用图标，改从 `icon.example.html` 起手，并加上 `--transparent`。
它是围绕那个人人都会踩一次的坑写的：`body` 上的背景会传播到根画布，而画布不受
`body` 的 `border-radius` 裁剪 —— 圆角徽章这么写，不管加什么参数，四角都是不透明的。
形状必须放在子元素上。

或者在 agent 里直接说要什么 —— 「把这个设计出成 2 倍图的 og 图」「截一下那个页面的
hero 区域」「生成 og 图」—— skill 会自动触发。

## 它替你处理掉的事

- **尺寸由 CSS 决定。** 不传 `--width/--height` 时会实测 `body` 的渲染盒（含默认 margin
  的偏移）。改卡片尺寸是改一行 CSS，不是改命令行。
- **中文与 emoji 走系统字体。** 没有字体要裁剪，也没有字体要打包。
- **本地资源按真实站点的方式解析。** 输入文件由一个临时的 `127.0.0.1` 服务器提供，
  所以相对路径、站点绝对路径 `/xxx`、`@import`、`srcset`、以及写在样式表里的字体
  全都正常 —— 项目的开发服务器关着也照样出图。
- **资源缺失会喊出来。** 它会打印请求的路径并以非零码退出，CI 不会闷声发出一张带窟窿的卡。
- **产出可复现。** 动画会在测量前和拍摄前各稳定一次，同一份 HTML 跑两遍结果一致。
- **不会拿假结果糊弄你。** 单张图一律不会超过源图放大 —— 母版能撑多大就写多大，
  并且如实说出来，manifest 片段也一样。透明的 `--bg` 会被拒绝（那会把
  apple-touch 图标压成纯黑），缩放不到方形画框的图标源也会当场失败，而不是让一个
  缩在角落里的标记带着退出码 0 发出去。
- **交付体积可控。** `--palette` 把平涂画面量化成调色板 PNG —— 一张 1200×630 的中文卡
  338 KB → 134 KB，`--colors 16` 则到 37 KB，肉眼无差别。（调色板 png 存的是位深，
  所以档位只有 `2`/`4`/`16`/`256`，没有中间值。）
- **影响面收得很窄。** 只有两个目录对外提供，路径先做完全解析（`/../` 和软链都跑不出去），
  且每个请求都必须带上本次运行的随机 token —— 其他本地进程就算找到端口也只会拿到 403。

HTML 是在本地 Chromium 里真正执行的，包含 JavaScript 与对外请求。
**不要拿它去渲染你不信任的 HTML。**

## 参数

完整参数表、安全边界，以及「症状 → 成因」排错表在 [`SKILL.md`](SKILL.md) —— 那份是给
agent 读的。简版：

```bash
node render.mjs <input.html|input.svg|url> <output.(png|jpg|webp)> [options]
node icons.mjs  <源文件> <输出目录> [--preset web|docusaurus|next|electron|tauri] [--only ico,svg,apple,pwa] [--pwa] [--bg COLOR] [--small SRC]
```

`--dpr` 出高分图 · `--transparent` 做透明徽章 · `--palette` / `--colors 2|4|16|256` 给平涂
画面瘦身 · `--only` 决定图标出几个 · `--bg` 指定 apple-touch 的底色（必须不透明）·
`--small` 给 16/32 px 换一版简化画法 ·
`--scheme dark` 出 `prefers-color-scheme` 暗色卡 · `--selector` 只拍一个元素 ·
`--style` 把总表的边框底色从它身上剥掉 · `--full` 拍整页 ·
`--channel chrome` 改用本机已装的浏览器。

## 由来

它来自给 [Idea Hub](https://github.com/rockbenben/idea-hub)（同一计划的 #028）做品牌物料
的过程 —— 那边的 logo 和 og 卡也是从 HTML 渲染的，用一个 shell 脚本驱动裸的
`chrome --headless --screenshot`。那个脚本能用，而且还留着。但每次走到那一步都要撞同样
几堵墙：Git Bash 给出的 MSYS 路径（`/d/…`）Chrome 的 `file://` 处理器打不开、每个尺寸
都要在 `--window-size` 和 `--force-device-scale-factor` 里各写一遍、降采样还得另找工具。

html-shot 就是把这几堵墙一次性拆掉：本地文件走临时 HTTP 服务器，路径和相对引用不再是问题；
输出尺寸从 `body` 实测得出；超采样与降采样内建。

后来又回头梳理了散落在好几个仓库里的品牌脚本，把它们各自单独解决过的问题收了进来：
那个 shell 脚本用 Pillow 做的调色板量化（`--palette`/`--colors`，现在能逐字节复现它的
产物）、用浏览器而不是轻量 SVG 引擎去栅格化 SVG（`feTurbulence` 这类滤镜两边渲染结果
肉眼可辨）、借用本机已装的 Chrome（`--channel`），以及注入 CSS 把单个标记从设计总表上
干净地揭下来（`--style`）。

## 关于 365 开源计划

[365 开源计划](https://github.com/rockbenben/365opensource)的第 **#030** 号项目 ——
一个人 + AI，一年做 300+ 个开源项目。
[提交你的创意 →](https://365.aishort.top/) ·
[Discord](https://discord.gg/PZTQfJ4GjX) ·
[Telegram](https://t.me/aishort_top)
