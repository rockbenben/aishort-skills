# GitHub Actions：测完才能发版，一个文件三个 job

骨架来自两个上线项目的 ci.yml；SHA256、attestation、签名与 winget 按官方文档补齐（[actions/attest](https://github.com/actions/attest)、[Artifact Signing action](https://github.com/Azure/artifact-signing-action)、[winget-create](https://github.com/microsoft/winget-create)）。1.1.0 起：全局只读权限、草稿 → 核验 → 公开并断言 latest、校验文件写 LF、x64 + arm64、可选签名。

**照抄前必须改三处**，否则第一次跑必红：把 `Xxx` 换成你的名字、确认工程路径与 `project-setup.md` 的目录约定一致（本页用 `src/` + `tests/`）、按 SKILL.md 铁律一核对每个 action 的大版本标签（那条 `grep … | while` 一次列全）。

**一个 `ci.yml`，`test` → `release` → `publish` 三个 job，别拆成多个文件**：`needs:` 不能跨 workflow 文件，拆开就丢了「红的树发不出 Release」这层保险，而且 `needs` 复用同一次运行的测试，不多花一分钟。

```yaml
name: CI
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:

permissions:
  contents: read                   # 全局只读；要写的 job 自己提权，PR 触发的 job 永远拿不到写权限

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref_type != 'tag' }}   # 分支上新推送取消旧运行；发版运行永不被中途取消

jobs:
  test:
    runs-on: windows-latest        # WPF 只能在 Windows 上跑（发布可以交叉编，smoke 不行）
    timeout-minutes: 15            # 卡死就快点红，别挂到 6 小时上限
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0           # 浅克隆不带 tag，csproj 里从 git tag 取版本的 target 会拿不到
          persist-credentials: false   # 后面没有 git push，令牌别留在 .git/config 里给后续步骤读
      - uses: actions/setup-dotnet@v6
        with:
          global-json-file: global.json   # SDK 版本唯一来源；别再并排写 dotnet-version
      # --minimum-expected-tests 防「静默 0 测试」：适配器没加载好时一个用例不跑却退出 0
      - name: Test
        run: dotnet test tests/Xxx.Core.Tests -c Release --nologo -- --minimum-expected-tests 1
      - name: Build (App)
        run: dotnet build src/Xxx.App -c Release --nologo
      # 防 XAML 错误带到发版。应用侧的 RunSmoke 实现见 dev-switches.md，这里是完整的 CI 侧
      - name: Smoke (parse every window's XAML)
        shell: pwsh
        run: |
          $exe = Get-ChildItem src/Xxx.App/bin/Release -Recurse -Filter Xxx.exe | Select-Object -First 1
          if (-not $exe) { Write-Error 'Xxx.exe not found'; exit 1 }
          # 用和应用同一个 API 解析临时目录，避免 TMP/TEMP 分歧导致两边看不同目录
          $marker = Join-Path ([System.IO.Path]::GetTempPath()) 'xxx-smoke.txt'
          Remove-Item $marker -ErrorAction SilentlyContinue
          $p = Start-Process $exe.FullName -ArgumentList '--smoke' -PassThru -Wait
          $ok = (Test-Path $marker) -and ((Get-Content $marker -Raw).Trim() -eq 'OK')
          if (-not $ok) { Get-Content $marker -Raw -ErrorAction SilentlyContinue; exit 1 }
          if ($p.ExitCode -and $p.ExitCode -ne 0) { exit 1 }

  release:                         # 构建 + 签名 + 打包 + attestation + 传到「草稿」release
    if: github.ref_type == 'tag'
    needs: test                    # ← 这行就是「测不过发不了版」
    runs-on: windows-latest
    timeout-minutes: 30
    permissions:
      contents: write              # 建草稿、传资产
      id-token: write              # attest 和 Azure 签名都靠 OIDC 换令牌，不存长期密钥
      attestations: write          # attest：把来源证明写回仓库
      artifact-metadata: write     # attest v4：写制品存储记录
    env:
      TAG: ${{ github.ref_name }}  # 进 shell 一律走 env，不把 ${{ }} 直接拼进脚本
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-dotnet@v6
        with:
          global-json-file: global.json
      # tag 是版本号的唯一来源。只收 vX.Y.Z：预发布 tag 进不了 releases/latest，
      # 走到 publish 那步的断言必红，不如在这里就拦下
      - name: Check tag
        shell: pwsh
        run: |
          if ($env:TAG -notmatch '^v\d+\.\d+\.\d+$') { Write-Error "tag '$env:TAG' is not vX.Y.Z"; exit 1 }
      # 标签 v1.2.0 → 版本 1.2.0 注入 exe；csproj 里 VersionFromGitTag 的 Condition 让这里
      # 传进来的 -p:Version 跳过整个 target（见 pitfalls.md「版本号发出去还是上一版」）
      - name: Publish (x64 + arm64, both forms)
        shell: pwsh
        run: |
          $v = $env:TAG.Substring(1)
          foreach ($p in 'win-x64', 'win-x64-needs-dotnet10', 'win-arm64', 'win-arm64-needs-dotnet10') {
            dotnet publish src/Xxx.App -c Release -p:PublishProfile=$p -p:Version=$v --nologo
            # 原生命令的非零退出不会中断 pwsh，而 runner 只在最后一行之后看 $LASTEXITCODE：
            # 不在循环里逐个判，前三次失败 + 最后一次成功 = 绿灯少三个资产
            if ($LASTEXITCODE) { exit $LASTEXITCODE }
          }
      # --- 签名（Azure Artifact Signing）-----------------------------------------------------
      # 仓库变量 AZURE_CLIENT_ID 没配 → 这两步跳过，发未签名版（release 说明里已提示 SmartScreen）。
      # 配好后自动生效。必须在打包和算哈希之前：签名会改写 exe，先算哈希再签，校验值全错。
      # 需要的仓库变量（Settings → Variables，不是 Secrets——都是标识符不是凭据）：
      #   AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_SUBSCRIPTION_ID（OIDC 联合凭据的应用）
      #   ARTIFACT_SIGNING_ENDPOINT（如 https://eus.codesigning.azure.net/，按账户所在区域）
      #   ARTIFACT_SIGNING_ACCOUNT / ARTIFACT_SIGNING_PROFILE
      - name: Azure login (for signing)
        if: vars.AZURE_CLIENT_ID != ''
        uses: azure/login@v3
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
      - name: Sign exe (Azure Artifact Signing)
        if: vars.AZURE_CLIENT_ID != ''
        uses: azure/artifact-signing-action@v2
        with:
          endpoint: ${{ vars.ARTIFACT_SIGNING_ENDPOINT }}
          signing-account-name: ${{ vars.ARTIFACT_SIGNING_ACCOUNT }}
          certificate-profile-name: ${{ vars.ARTIFACT_SIGNING_PROFILE }}
          files: |
            ${{ github.workspace }}\src\Xxx.App\bin\Release\publish-x64\Xxx.exe
            ${{ github.workspace }}\src\Xxx.App\bin\Release\publish-x64-needs-dotnet10\Xxx.exe
            ${{ github.workspace }}\src\Xxx.App\bin\Release\publish-arm64\Xxx.exe
            ${{ github.workspace }}\src\Xxx.App\bin\Release\publish-arm64-needs-dotnet10\Xxx.exe
          file-digest: SHA256
          timestamp-rfc3161: http://timestamp.acs.microsoft.com
          timestamp-digest: SHA256
      - name: Package + SHA256
        shell: pwsh
        run: |
          $pub = 'src/Xxx.App/bin/Release'
          $assets = @()
          foreach ($arch in 'x64', 'arm64') {
            foreach ($form in '', '-needs-dotnet10') {
              $zip = "Xxx-$env:TAG-win-$arch$form.zip"
              Compress-Archive -Path "$pub/publish-$arch$form/Xxx.exe" -DestinationPath $zip
              $assets += $zip
            }
          }
          # 裸 exe 只发 x64 框架依赖版（理由见下文「承重的几处」）；复制到根目录，上传名就是 Xxx.exe
          Copy-Item "$pub/publish-x64-needs-dotnet10/Xxx.exe" Xxx.exe
          $assets += 'Xxx.exe'
          # 每一个要发出去的资产都要有行：这份清单同时也是下一步 attestation 的输入。
          # 格式是 shasum 那套「十六进制摘要 + 空格 + 模式标志 + 文件名」，两个空格 = 分隔 + 文本模式标志
          $lines = Get-FileHash $assets -Algorithm SHA256 |
            ForEach-Object { "{0}  {1}" -f $_.Hash.ToLower(), (Split-Path $_.Path -Leaf) }
          # 必须 LF：Windows 上 Set-Content/Out-File 写 CRLF，Linux/macOS 的 `sha256sum -c` 会把 \r
          # 当成文件名的一部分，全部报找不到文件。路径用 $PWD 拼绝对路径：.NET 的当前目录不跟 pwsh 的 Set-Location 走
          [IO.File]::WriteAllText("$PWD/SHA256SUMS.txt", ($lines -join "`n") + "`n")
      # 官方来源证明：比 SHA256SUMS 强一档，用户拿 `gh attestation verify` 能验到
      # 「这个文件确实由本仓库这条 workflow 构建」，而不只是「文件没被改过」。
      # 喂 SHA256SUMS.txt 而不是再抄一遍文件清单：清单只存在于上面那个 $assets，
      # 加资产时改一处，attestation 自动跟着覆盖到，不会出现「漏签一个还不报错」。
      - uses: actions/attest@v4
        with:
          subject-checksums: SHA256SUMS.txt
      - name: Upload to draft release
        uses: softprops/action-gh-release@v3
        with:
          # 先进草稿：开了 immutable releases 后，release 公开的那一刻资产和 tag 就锁死，
          # 传一半就公开等于永久缺一个资产。草稿阶段重跑会复用同一份草稿、覆盖同名资产
          draft: true
          fail_on_unmatched_files: true
          # 逐个写死不用通配：和 Package 步骤一一对应，不会漏、也不会把同一个文件传两遍
          files: |
            Xxx-${{ github.ref_name }}-win-x64.zip
            Xxx-${{ github.ref_name }}-win-x64-needs-dotnet10.zip
            Xxx-${{ github.ref_name }}-win-arm64.zip
            Xxx-${{ github.ref_name }}-win-arm64-needs-dotnet10.zip
            Xxx.exe
            SHA256SUMS.txt
          body: |
            **Which package? / 下载哪个？**

            - `…-win-x64.zip` — .NET runtime included; unzip and run. / 内含运行时，解压即用，拿不准就选它。
            - `…-win-arm64.zip` — same, for Windows on Arm (Snapdragon / Surface Pro X). / 同上，ARM 版 Windows 用这个。
            - `…-needs-dotnet10.zip` — needs the .NET 10 Desktop Runtime. / 不带运行时，需已装 .NET 10 桌面运行时。
            - `Xxx.exe` — the small x64 build, unzipped: run, or drop over the old exe to update. / x64 小包的裸 exe，点开即用或直接覆盖更新。

            Verify / 校验：`sha256sum -c SHA256SUMS.txt` or `gh attestation verify <file> -R ${{ github.repository }}`
          generate_release_notes: true

  publish:                         # 核验草稿 → 公开 → 断言 latest
    needs: release
    runs-on: ubuntu-latest         # 只调 API 和 sha256sum，用 Linux 顺带验证校验文件在 Linux 上真的能用
    timeout-minutes: 10
    # 想人工把关再公开：加一行 `environment: release`，在 Settings → Environments 给它配 required reviewers
    permissions:
      contents: write              # 改草稿状态
    env:
      TAG: ${{ github.ref_name }}
      GH_TOKEN: ${{ github.token }}
      GH_REPO: ${{ github.repository }}
    steps:
      - name: Verify draft assets
        run: |
          gh release download "$TAG" --dir dl
          cd dl
          # 草稿里缺哪个资产，清单那一行就找不到文件，-c 直接失败；不用再单独数个数
          sha256sum -c SHA256SUMS.txt
      - name: Publish and mark latest
        run: |
          gh release edit "$TAG" --draft=false --latest
          latest=$(gh api "repos/$GH_REPO/releases/latest" --jq .tag_name)
          test "$latest" = "$TAG" || { echo "::error::releases/latest is $latest, expected $TAG"; exit 1; }
      # --- winget：默认什么都不做（路 A，清单流水线定时巡检）。路 B 见下文，接在这个 job 后面 ---
```

**`gh release download` 能下草稿，但 `gh release edit` 找草稿靠的是另一条路。** 实测（真实仓库上的临时草稿）：`gh release download <tag>` 走 GraphQL 按「待发布 tag 名」找草稿，所以下载得到；而 **`GET /repos/{o}/{r}/releases/tags/{tag}` 不返回草稿**（404），拿它去找草稿会扑空。要按 id 操作草稿（改它、删它）就得从列表里捞：

```bash
# releases 列表按创建时间倒序，新建的那条草稿总在第一页
id=$(gh api "repos/$GH_REPO/releases?per_page=100" \
       --jq "first(.[] | select(.tag_name == \"$TAG\") | .id)")
gh api --method PATCH "repos/$GH_REPO/releases/$id" -F draft=false -f make_latest=true
```

**`gh release edit --draft=false --latest` 与手写 PATCH 等价**：一次调用同时完成「转正」与「把 `releases/latest` 指过去」。这最后半句不能省——GitHub 在草稿转正时**不会**重算 `releases/latest` 指向谁（2026-10-20 在 rclone-deck 上撞过：release 看着已发布，`releases/latest` 却仍返回旧版本，端点于是 404）。所以转正和指指针要一起做，之后再读 API 确认指针真的挪了。

## 承重的几处，别顺手「优化」掉

- **action 一律只钉大版本标签**（`@v7` / `@v6` / `@v4` / `@v3` / `@v2`）：补丁和小版本随标签漂移自动到手；大版本不会自己来，发版前用 SKILL.md 铁律一那条命令把 `ci.yml` 里每个 action 对一遍最新 release。**本仓不用 Dependabot**（有意撤掉的），所以这一步没人替你做。取舍要知道：标签是可移动的引用，上游被入侵改标签时 `release` job 的写权限和 OIDC 会一起暴露——所以只用 `actions/*`、`azure/*` 和 `softprops` 这几家，不为省几行脚本引陌生 action。
- **全局 `contents: read`，写权限只给 `release` / `publish`**：PR 触发时这两个 job 不跑，PR 里的代码永远拿不到写令牌。
- **草稿 → 核验 → 公开，分两个 job**：`softprops/action-gh-release` 用 `draft: true` 时，重跑会找到同一份草稿、覆盖同名资产，上传中途断了重跑就好；`gh release create` 会直接撞「release already exists」。公开放在单独的 `publish` job：`sha256sum -c` 不过（缺资产或内容不符）就停在草稿，用户看不到半成品；开了 immutable releases 的仓库这一步尤其重要，公开之后资产就改不了了。
- **断言 `releases/latest` 等于本 tag**：应用内的更新检查、winget 清单流水线读的都是 `releases/latest`，它忽略草稿和预发布。只「发出去」不断言，可能出现 release 页上有新版、所有人却还被告知「已是最新」。
- **资产逐个写死不用通配**：四个 zip（版本形态和架构写在 zip 名里，解压出来永远是干净的 `Xxx.exe`）、x64 框架依赖版的裸 exe（点开即用、可覆盖更新——只有小包这么发；自带运行时的裸 exe 体积大、直接可执行，未签名时实测最容易被浏览器和 SmartScreen 拦下；arm64 用户少，只给 zip）、`SHA256SUMS.txt`。加资产要同时改 Package 步骤的 `$assets` 和 `files:` 两处：前者连带覆盖 attestation，漏了后者 `publish` job 的 `sha256sum -c` 会找不到文件而停在草稿。
- **签名在打包之前，哈希在签名之后**：顺序反了，`SHA256SUMS.txt` 和 attestation 记的是未签名文件的摘要，用户下到的签名版一个都对不上。
- **校验值放生成的文件里，不放 README**：文档里的数字会腐烂，`SHA256SUMS.txt` 每版随构建重新生成，永远和资产一致。

## 校验：SHA256SUMS 与 attestation 串起来用，不是二选一

**每一个发出去的资产都要有一行，不是挑一个。** 几种形态是给不同的人的（拿不准的人下自带运行时的、装了运行时的人下小包、ARM 设备下 arm64），只给其中一个出校验值，另一拨人手里就是个没法验的文件。上面脚本里的 `$assets` 正好覆盖全部五个要校验的产物（`SHA256SUMS.txt` 自己不在里面——它没法包含自己的摘要）。

**`SHA256SUMS.txt` 单独用有个绕不过去的弱点**：它和它校验的文件放在同一个 release 页上。能替换资产的攻击者同样能替换这份 sums——它挡得住传输损坏和 CDN 缓存串味，挡不住上游被攻破。补这一层的是 **GitHub 官方的 artifact attestation**：构建时用 OIDC 换令牌签一份来源证明，存在 GitHub 那边而不是你的 release 里，用户验的是「这个文件确实由 `OWNER/REPO` 的这条 workflow 构建出来」：

```bash
gh attestation verify Xxx-v1.2.0-win-x64.zip -R OWNER/REPO
```

**两者是串起来的。** attestation 的 `subject-checksums` 输入直接吃 `SHA256SUMS.txt`（[官方 README](https://github.com/actions/attest) 的 "Identify Subjects with Checksums File" 一节，本来就是为 goreleaser 这类会生成校验文件的工具准备的），于是：

- **文件清单只存在一处**——那个 `$assets`。加资产改一行，attestation 自动跟着覆盖到，不会出现「漏签一个还不报错」；换成 `subject-path` 逐个列文件就有这个风险。
- **两拨用户都照顾到**：装了 `gh` 的验来源证明（强，能识破上游被攻破）；没有任何工具的用 `certutil -hashfile` / `Get-FileHash` / `sha256sum` 对一下（弱，但零依赖、离线可用）。
- **格式**：shasum 那套「摘要 + 空格 + 模式标志（`*` 二进制 / 空格 文本）+ 文件名」。上面脚本输出的两个空格正好是「分隔空格 + 文本模式标志」，直接符合。
- **换行必须是 LF**：1.0.x 模板用的是 `Set-Content -Encoding ascii`，编码没问题，换行是 CRLF。Windows 上的 `certutil` / `Get-FileHash` 是人眼比对，看不出来；Linux 上 `sha256sum -c` 会把行尾的 `\r` 当成文件名的一部分，报 `'Xxx.exe'$'\r': No such file or directory`，整份清单全部 FAILED（coreutils 8.32 实测）。现在用 `[IO.File]::WriteAllText` 自己拼 `\n`，`publish` job 在 Linux 上跑一遍 `sha256sum -c` 兜底。
- **`actions/attest` 而不是 `actions/attest-build-provenance`**：后者从 v4 起只是前者的一层包装，它自己的 README 写明新接入应直接用 `actions/attest`；`actions/attest` 的 README 把 `id-token` / `attestations` / `artifact-metadata` 三个 `write` 都列为必需（最后一个用来写制品存储记录），从旧模板升上来时最容易漏的就是它。

**要砍就砍逐个列文件那种写法，别砍 `SHA256SUMS.txt`。** 只留 attestation 的代价是：没装 `gh` 的用户完全无从校验——而下载一个托盘小工具的人，多数不会为验签去装 GitHub CLI。

**不建议为算哈希再引第三方 action**：`Get-FileHash` 是 PowerShell 内建，几行写完，而校验环节多一个第三方依赖恰好是它想防的那类风险。

**顺带**：winget 那条路不需要你操心哈希——manifest 里本来就带 `InstallerSha256`，直接提交那条路里 `wingetcreate update` 会自己下载安装包算好填进去；清单归流水线管时，流水线直接取 release 资产自带的 `digest` 字段（GitHub 现在给每个 release 资产都发 sha256），也不用你算。SHA256SUMS 和 attestation 是给直接从 release 页下载的人用的。

**选包说明写在 release body，别写在 README**：选包这件事发生在下载页；GitHub 会把自动 changelog 接在 body 后面。体积数字一个都不写，资产列表旁边本来就有。

## 代码签名：有资格就签，没资格就把话说在前面

未签名的 exe 首次运行会被 SmartScreen 拦成「Windows 已保护你的电脑 / 未知发布者」，winget 渠道也不会让这个提示消失。资格和取舍见 `project-setup.md` 选型表的「代码签名」一行。

- **签了**：上面两步在配好仓库变量后自动生效。OIDC 登录（`azure/login` 用联合凭据，仓库里不存任何密钥），签名账户给这个应用注册授予 *Artifact Signing Certificate Profile Signer* 角色。单文件 exe 直接签发布产物本身即可。
- **没签**：变量留空，两步自动跳过；release body 里加一句「首次运行 SmartScreen 会提示，点『更多信息 → 仍要运行』；可用 SHA256 / attestation 校验」。工作流里有签名步骤不等于发出去的是签名版，变量为空时照样是未签名的；在 README 里写一行「当前未签名：暂无 Artifact Signing 资格」，别让人看到 workflow 就以为已经签了。

## winget 清单：两条路，只能选一条

**先看清楚归属，再动手。** winget 的清单不是发版流程的一部分，它是「对已发布产物的描述」，所以可以由另一条流水线负责——rockbenben 这个发布者下的包就是这么做的：

```
本仓发版 → rockbenben/winget-manifests → PR → rockbenben/winget-pkgs → microsoft/winget-pkgs
              （apps.json 是唯一源，巡检到新 release 就重生成 manifest 并开 PR）
```

那个仓里的触发只有一个：定时巡检（每 6 小时，错开整点）。**本仓不用为 winget 做任何事**，清单不是在这里生成的。它巡检的是 `releases/latest`，所以 `publish` job 那句 latest 断言也是在替它把关。

（它另外接受一个 `repository_dispatch` 的 `app-released` 事件，但没人发：跨仓 dispatch 要一个对 manifest 仓有 push 权限的凭据，等于把「能改 apps.json 源」的权限交给每个 app 仓的 CI，还多一个「release 都发完了这一步才红」的失败点。为 6 小时的延迟换这些不值；真嫌慢就把巡检周期调密。）

**⚠️ 两条路同时开着是最容易犯的错**：app 自己的 workflow 直接提交一份、清单流水线再提交一份，等于往 winget-pkgs 开了同一个包的两个 PR，第二个被当重复拒掉——症状看起来像「winget 坏了」，其实是自己跟自己撞。**选一条，并且写下来是选了哪条。**

### 路 A：清单归流水线管（rockbenben 发布者下的包）

**本仓什么都不用做。** 清单仓自己定时巡检各发布仓的 release，发现新版本就重生成 manifest、往 winget-pkgs 开 PR。发版流程到「`publish` job 绿了」为止。

arm64 资产加进来以后，清单那边要给这个包补一个 `arm64` 安装器节点（`apps.json` 里登记 arm64 的资产名模式），否则 winget 在 ARM 设备上照旧装 x64 版走模拟——不报错，只是慢。

### 路 B：自己直接提交（不在那个流水线里的发布者）

工具用微软官方的 [wingetcreate](https://github.com/microsoft/winget-create)，别的包装 action 都是社区二传手。**作为 `ci.yml` 的第四个 job，`needs: publish`**——草稿还没公开时提交，PR 里的安装包 URL 是 404：

```yaml
  winget:
    needs: publish                 # 只在公开、latest 断言通过之后
    runs-on: windows-latest
    timeout-minutes: 10
    env:
      TAG: ${{ github.ref_name }}
      WINGET_TOKEN: ${{ secrets.WINGET_TOKEN }}   # 提到 env：secrets 上下文在 step 的 if 里用不了
    steps:
      - name: Submit to winget
        if: env.WINGET_TOKEN != ''
        shell: pwsh
        run: |
          $v = $env:TAG.Substring(1)
          $base = "https://github.com/OWNER/REPO/releases/download/$env:TAG"
          Invoke-WebRequest https://aka.ms/wingetcreate/latest -OutFile wingetcreate.exe
          .\wingetcreate.exe update Publisher.Xxx --version $v `
            --urls "$base/Xxx-$env:TAG-win-x64.zip|x64" "$base/Xxx-$env:TAG-win-arm64.zip|arm64" `
            --token "$env:WINGET_TOKEN" --submit
          if ($LASTEXITCODE) { exit $LASTEXITCODE }
```

- **首次收录要人跑一次，但它是向导**：`wingetcreate new <安装包URL>` 会自己下载安装包、提取元数据，逐步引导你确认/编辑 `PackageIdentifier`（`发布者.应用名` 格式）和必填字段，最后问一声就直接帮你把 PR 提到 [winget-pkgs](https://github.com/microsoft/winget-pkgs)（带 `--token` 免登录）。人工+机器人审核通过后才有「更新」可言，收录之前别配 `WINGET_TOKEN`（上面那步就自动跳过），配了 `update` 必然失败。
- **`--urls` 要和现有清单里的安装器对得上**（[官方 update.md](https://github.com/microsoft/winget-create/blob/main/doc/update.md)：update 按 URL/架构去匹配现有清单里的安装器，匹配不上就不生成 manifest，命令失败）。从只有 x64 的清单第一次加 arm64，要人工 `wingetcreate update Publisher.Xxx --interactive` 加一次节点，之后 CI 里的两条 URL 才对得上。`|x64` / `|arm64` 是官方的架构覆盖写法，URL 里自带架构名时可省，写上更稳。
- **`update` 会自己算 SHA256**：给它带版本号的安装包 URL，它下载、算哈希、改 manifest、提 PR 一条龙（`--submit`）。
- **URL 必须每版唯一**：zip 名里带 tag 正好；裸 exe 那个无版本文件名不能当 winget 的安装器 URL。portable 类型的 zip winget 直接支持（manifest 里 `InstallerType: zip` 套 `portable`）。
- **`WINGET_TOKEN` 是 GitHub PAT**，存 repo secret，给 fork/提 PR 到 winget-pkgs 用；所需最小权限见官方 [token.md](https://github.com/microsoft/winget-create/blob/main/doc/token.md)，别直接给全量 repo 权限。
- 提交后是**人工+机器人混合审核**，不是发出去立刻可 `winget install`；发版脚本不要依赖它同步完成。
- **别改成 `on: release: published` 的独立 workflow**：`publish` job 用的是 `GITHUB_TOKEN`，GitHub 防递归规则下它发布的 release 不会触发任何 workflow，那个 winget workflow 会静默永不运行。

## 和本 skill 其他文件的接线

| 这里引用的 | 在哪 |
| --- | --- |
| 四份 pubxml 的完整内容、profile 名与 `PublishDir` | `project-setup.md`「发布：四份 pubxml（x64 / arm64 × 自包含 / 框架依赖），csproj 一个发布属性都不放」 |
| `global.json` 写法、为什么 CI 不写 `dotnet-version`、补丁怎么自动到手、**下限锁住什么** | `project-setup.md`「SDK 固定：global.json 一处说了算」 |
| 为什么没有 `packages.lock.json` / `--locked-mode` | `project-setup.md`「NuGet 锁文件：单文件发布先别开」 |
| 签名资格、不签时怎么说 | `project-setup.md` 选型表「代码签名」一行 |
| 为什么发布属性不能进 csproj、两种 profile 互相抄错的三个坑 | `pitfalls.md`「测试工程引用 App 就报 NETSDK1151」 |
| `--minimum-expected-tests` 的来历、xunit.v3 上 MTP | `project-setup.md`「工程分三个，测试只测 Core」 |
| `--smoke` 的实现和 CI marker 判定脚本 | `dev-switches.md`「`--smoke`：CI 里防 XAML 错误带到发版」 |
| `--shots` 批量截图（改了 UI 该跑的那个） | `dev-switches.md`「`--shots <目录>`」 |
| `VersionFromGitTag` target 与 `-p:Version` 的配合、`fetch-depth: 0` | `pitfalls.md`「版本号发出去还是上一版」 |
| 压缩开关的启动代价（决定 `EnableCompressionInSingleFile` 开不开） | `pitfalls.md`「开了 ReadyToRun 反而更慢」 |
| action 大版本、.NET 通道的核对命令 | SKILL.md 铁律一 |

多个文件怎么签 attestation：`subject-checksums` 喂一份校验文件是本页用的写法；官方另外支持 `subject-path` 直接给**换行分隔的多个路径或 glob 通配**（如 `dist/*.zip`），以及 `subject-digest`（手里只有摘要没有文件时用，需配 `subject-name`）。三选一、不能同时给；单次 attestation 的 subject 上限 1024 个。
