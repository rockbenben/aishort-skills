# MD Web

[English](README.md) · 本文档为中文版，术语与英文版一致。

将任意内容转为网页并生成可分享的链接。上传 Markdown 到 S3 兼容存储桶，由 Docsify 自动渲染。

## 安装

按你使用的 agent / CLI 任选其一：

```bash
# ClawHub / OpenClaw
clawhub install md-web

# skills.sh（Vercel skills CLI —— 适用于 Claude Code、Cursor 等）
npx skills@1.7.2 add rockbenben/aishort-skills
```

请像上面那样固定 CLI 版本：不带版本的 `npx skills add …` 会在安装时解析到仓库当时的版本，
也就是你审过的安装器和真正跑起来的那个可能不是同一个。

或手动安装 —— clone 本仓库，把 `skills/md-web/` 目录拷贝（或软链）进你的 agent 读取的
skills 目录即可，只要是一个名为 `md-web` 的目录，具体路径按你的 agent 文档来。

## 快速开始

1. 安装 skill（见上方）
2. 首次使用时，AI 会引导你填写存储桶配置
3. 之后 AI 会先做一次「初始化站点」——把页面外壳部署到你的桶，skill 升级后需要再做一次
4. 再之后，告诉 AI「用网页展示」即可将内容分享为链接

## 存储桶配置

本 skill 需要一个 **S3 兼容的对象存储桶**并开启公共访问。以下以 Cloudflare R2 为例。

### 第一步：创建存储桶

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧菜单选择 **R2 对象存储**
3. 点击 **创建存储桶**，填写名称（如 `md-web`），区域选默认即可
4. 创建完成后进入桶的 **设置** 页面
5. 找到 **公开访问**，点击 **允许访问**，勾选 **R2.dev 子域**
6. 开启后会显示公共 URL，格式为 `https://pub-XXXX.r2.dev`
   → 这就是配置中的 **public_url**

### 第二步：创建 API 令牌

1. 在 R2 页面点击 **管理 R2 API 令牌**
2. 点击 **创建 API 令牌**
3. 权限选择 **对象读和写**（Object Read & Write）。只有设置 `expire_days`（要管理桶的生命周期规则）时才需要 **管理员读和写**（Admin Read & Write）
4. 范围可选 **仅限指定桶** → 选择刚才创建的桶
5. 创建后会显示：
   - **Access Key ID** → 配置中的 **access_key**
   - **Secret Access Key** → 配置中的 **secret_key**
   - **S3 端点** 格式为 `https://ACCOUNT_ID.r2.cloudflarestorage.com`
     → 去掉 `https://`，剩余部分就是 **endpoint**

### 第三步：告诉 AI

首次使用 skill 时，AI 会询问以下信息：

| 字段        | 必填 | 说明                                                     | 示例                                  |
| ----------- | ---- | -------------------------------------------------------- | ------------------------------------- |
| access_key  | 是   | API 访问密钥 ID                                          | `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4`    |
| secret_key  | 是   | API 秘密访问密钥                                         | `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6...` |
| endpoint    | 是   | S3 端点（不含 https://）                                 | `ACCOUNT_ID.r2.cloudflarestorage.com` |
| bucket      | 是   | 存储桶名称                                               | `md-web`                              |
| public_url  | 是   | 公共访问 URL（推荐自定义域名）                           | `https://pub-XXXX.r2.dev`             |
| region      | 否   | S3 区域（R2 用 `auto`，AWS S3 填实际区域如 `us-east-1`） | `auto`                                |
| expire_days | 否   | 上传文件 N 天后自动删除。**留空 = 本 skill 完全不碰桶的生命周期配置**（默认） | `30` |

> **提示**：R2.dev 子域有速率限制，生产环境建议为桶绑定自定义域名作为 `public_url`。

AI 会自动将配置写入 `~/.md-web/config.json`，之后不再需要重复配置。

不想把长期密钥写在文件里？可以不填 `access_key` / `secret_key`，改用环境变量
`MD_WEB_ACCESS_KEY` / `MD_WEB_SECRET_KEY`。两者都存在时以配置文件为准，老配置不受影响。

## 使用方式

上传的内容通过生成的 URL **公开可访问**。仅在你明确要求时触发，AI 也会在上传前告诉你链接是公开的：

```text
做成网页
预览 README.md
/md-web path/to/file.md
分享为链接
```

AI 会返回一个链接，点击即可在浏览器中阅读渲染后的文档。

> **注意**：Markdown 中的图片引用（如 `![](image.png)`）不会被上传，仅上传 `.md` 文件本身。如文档包含图片，请使用绝对 URL。

## 自动过期（`expire_days`）

留空时本 skill 不会发出任何桶级请求 —— 只需要 **对象读和写** 权限，桶里的生命周期配置原样不动。

填一个天数，则只维护一条限定在 `md-web/` 前缀下的规则；填 `0` 则移除这条规则。两种情况下
桶根目录的站点文件和其它对象都不会被波及，而且**你自己设的规则会保留**：脚本先读取桶的生命周期
配置，只丢弃自己那一条，再把其余规则原样写回。

管理它需要 **管理员读和写** 权限的令牌。令牌权限更窄时上传照常成功，只是输出里会一闪而过一条
警告 —— 这时去控制台手动设置规则即可。改过之后重跑一次「初始化站点」。

## 安全须知

- **上传的内容通过返回的 URL 公开可访问，且无法撤销** —— 切勿上传密钥、API token、个人隐私等敏感内容。
- 凭证以**明文**保存在 `~/.md-web/config.json`（也可放在 `MD_WEB_ACCESS_KEY` / `MD_WEB_SECRET_KEY` 环境变量里）。无论哪种方式都请保护好它 —— 不要提交到仓库或外泄。
- **使用专用存储桶。** 上传与过期规则都限定在 `md-web/` 前缀下，但专用桶能保证本 skill 的桶管理权限远离你真正在意的数据。
- **查看器会把 Markdown 当作 HTML 渲染**，所以 `<details>`、对齐写法、行内图片都能正常工作。让它保持安全的有两道防线：路由守卫只加载 `md-web/` 下的同源路径（构造的链接无法让查看器从其他源拉取文档），以及不含 `'unsafe-inline'` 的 CSP（文档里的 HTML 无法执行脚本）。无论如此，都请把这个域名当作公开域看待。

## 文件结构

```yaml
md-web/                     # Skill 目录（由 ClawHub 管理，升级时可能被替换）
├── SKILL.md              # AI 指令文件
├── upload.js             # 上传脚本（纯 Node.js，零依赖）
├── README.md             # 英文文档
├── README.zh.md          # 本文档
└── docsify-server/       # 查看器文件（由「初始化站点」步骤上传）
    ├── index.html
    ├── README.md
    ├── .nojekyll
    └── assets/           # JS/CSS 资源（本地打包，无 CDN 依赖）
        ├── config.js     # 查看器配置 + 文档路由守卫
        ├── docsify.min.js
        ├── vue.css
        └── ...

~/.md-web/                  # 用户数据目录（升级时保留）
├── config.json           # 存储桶凭证与配置（首次使用时创建）
└── .deployed             # 部署指纹（跟踪服务端部署状态）
```

`.nojekyll` 到不了安装出来的那份：ClawHub 打包时会跳过所有点号开头的文件，所以它只存在于本仓库的工作副本里。`upload.js` 是把整个 `docsify-server/` 目录喂进哈希来生成 `.deployed` 里的指纹的，于是工作副本与安装副本的指纹不同——在两者之间切换时，需要再跑一次「初始化站点」。这不损失什么：`.nojekyll` 只对 GitHub Pages 有意义，而本 skill 发布到 R2 或其他 S3 兼容存储桶。

## 其他 S3 兼容服务

除 Cloudflare R2 外，本 skill 也支持任何 S3 兼容的对象存储：

- **AWS S3**：endpoint 为 `s3.REGION.amazonaws.com`
- **Backblaze B2**：endpoint 为 `s3.REGION.backblazeb2.com`
- **DigitalOcean Spaces**：endpoint 为 `REGION.digitaloceanspaces.com`
- **Wasabi**：endpoint 为 `s3.REGION.wasabisys.com`
- **腾讯云 COS**：endpoint 为 `cos.REGION.myqcloud.com`

只要能提供 S3 兼容 API 和公共访问 URL，都可以使用。
