# GitHub Actions：测完才能发版，一个文件两个 job

骨架来自两个上线项目的 ci.yml；SHA256、attestation 与 winget 三步按官方文档补齐（[winget-create](https://github.com/microsoft/winget-create)、[actions/attest](https://github.com/actions/attest)）。

**照抄前必须改三处**，否则第一次跑必红：把 `Xxx` 换成你的名字、确认工程路径与 `project-setup.md` 的目录约定一致（本页用 `src/` + `tests/`）、按 SKILL.md 铁律一核对四个 action 的大版本标签。

**一个 `ci.yml`，`test` + `release` 两个 job，别拆成两个文件**：`needs:` 不能跨 workflow 文件，拆开就丢了「红的树发不出 Release」这层保险，而且 `needs` 复用同一次运行的测试，不多花一分钟。

```yaml
name: CI
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:

jobs:
  test:
    runs-on: windows-latest        # WPF 只能在 Windows 上构建
    timeout-minutes: 15            # 卡死就快点红，别挂到 6 小时上限
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0           # 浅克隆不带 tag，csproj 里从 git tag 取版本的 target 会拿不到
      - uses: actions/setup-dotnet@v6
        with:
          dotnet-version: 10.0.x
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

  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: test                    # ← 这行就是「测不过发不了版」
    runs-on: windows-latest
    timeout-minutes: 20
    permissions:
      contents: write              # 建 Release 要写权限；只给这个 job，PR 触发时它不跑
      id-token: write              # 下面 attest 那步要的：换取 OIDC 令牌去签署来源证明
      attestations: write          # 同上：把证明写回仓库
    env:
      # 提到 job 级是为了让最后那步的 if 能判它：secrets 上下文在 step 的 if 里用不了，env 才行
      WINGET_TOKEN: ${{ secrets.WINGET_TOKEN }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0           # 同上：没有它 git describe 取不到 tag
      - uses: actions/setup-dotnet@v6
        with:
          dotnet-version: 10.0.x
      # 标签 v1.2.0 → 版本 1.2.0 注入 exe；csproj 里 VersionFromGitTag 那个 target 的
      # Condition 保证这里传进来的 -p:Version 不会被旧 tag 顶掉（见 pitfalls.md「版本号发出去还是上一版」）
      - name: Publish (both profiles)
        shell: pwsh
        run: |
          $v = "${{ github.ref_name }}" -replace '^v', ''
          dotnet publish src/Xxx.App -c Release -p:PublishProfile=win-x64 -p:Version=$v --nologo
          # 原生命令的非零退出不会中断 pwsh，而 runner 只在最后一行之后看 $LASTEXITCODE：
          # 不显式判一次，第一次发布失败 + 第二次成功 = 绿灯少一个资产
          if ($LASTEXITCODE) { exit $LASTEXITCODE }
          dotnet publish src/Xxx.App -c Release -p:PublishProfile=win-x64-needs-dotnet10 -p:Version=$v --nologo
          if ($LASTEXITCODE) { exit $LASTEXITCODE }
      - name: Package + SHA256
        shell: pwsh
        run: |
          Compress-Archive -Path src/Xxx.App/bin/Release/publish/Xxx.exe -DestinationPath "Xxx-${{ github.ref_name }}-win-x64.zip"
          Compress-Archive -Path src/Xxx.App/bin/Release/publish-needs-dotnet10/Xxx.exe -DestinationPath "Xxx-${{ github.ref_name }}-win-x64-needs-dotnet10.zip"
          # 每一个要发出去的资产都要有行：这份清单同时也是下一步 attestation 的输入
          # 格式必须是 shasum 那套「十六进制摘要 + 空格 + 模式标志 + 文件名」，
          # 下面的两个空格 = 一个分隔空格 + 文本模式标志，attest 认这个格式
          Get-FileHash *.zip, src/Xxx.App/bin/Release/publish-needs-dotnet10/Xxx.exe -Algorithm SHA256 |
            ForEach-Object { "{0}  {1}" -f $_.Hash.ToLower(), (Split-Path $_.Path -Leaf) } |
            Set-Content SHA256SUMS.txt -Encoding ascii
      # 官方来源证明：比 SHA256SUMS 强一档，用户拿 `gh attestation verify` 能验到
      # 「这个文件确实由本仓库这条 workflow 构建」，而不只是「文件没被改过」。
      # 喂 SHA256SUMS.txt 而不是再抄一遍文件清单：清单只存在于上面那句 Get-FileHash，
      # 加资产时改一处，attestation 自动跟着覆盖到，不会出现「漏签一个还不报错」。
      - uses: actions/attest-build-provenance@v4
        with:
          subject-checksums: SHA256SUMS.txt
      - name: Release
        uses: softprops/action-gh-release@v3
        with:
          # 逐个写死不用通配：和 Package 步骤一一对应，不会漏、也不会把同一个文件传两遍
          files: |
            Xxx-${{ github.ref_name }}-win-x64.zip
            Xxx-${{ github.ref_name }}-win-x64-needs-dotnet10.zip
            src/Xxx.App/bin/Release/publish-needs-dotnet10/Xxx.exe
            SHA256SUMS.txt
          body: |
            **Which package? / 下载哪个？**

            - `…-win-x64.zip` — .NET runtime included; unzip and run. / 内含运行时，解压即用，拿不准就选它。
            - `…-win-x64-needs-dotnet10.zip` — needs the .NET 10 Desktop Runtime. / 不带运行时，需已装 .NET 10 桌面运行时。
            - `Xxx.exe` — the small build, unzipped: run, or drop over the old exe to update. / 小包的裸 exe，点开即用或直接覆盖更新。
          generate_release_notes: true
      # 只在配了 token 时才跑：没配 secret 的仓库（刚照抄这份文件的每一个）会静默跳过，
      # 而不是在 Release 已经发出去之后把整个 job 弄红。
      # 首个版本必须先手动 `wingetcreate new` 让包进 winget-pkgs，否则 update 必然失败——
      # 收录之前把这一步整段注释掉，或者给它 continue-on-error: true
      - name: Submit to winget
        if: env.WINGET_TOKEN != ''
        shell: pwsh
        run: |
          $v = "${{ github.ref_name }}" -replace '^v', ''
          Invoke-WebRequest https://aka.ms/wingetcreate/latest -OutFile wingetcreate.exe
          .\wingetcreate.exe update Publisher.Xxx --version $v `
            --urls "https://github.com/OWNER/REPO/releases/download/${{ github.ref_name }}/Xxx-${{ github.ref_name }}-win-x64.zip" `
            --token "$env:WINGET_TOKEN" --submit
```

## 承重的几处，别顺手「优化」掉

- **`softprops/action-gh-release` 而不是 `gh release create`**：它对已存在的 release 是覆盖更新，上传中途断了重跑一次就好；`gh release create` 会直接撞「release already exists」。
- **action 一律只钉大版本标签**（上面的 `@v7` / `@v6` / `@v4` / `@v3`）：补丁随标签漂移自动到手，出破坏性大版本时 Dependabot 会提 PR。**这些数字一定会过期**，抄之前按 SKILL.md 的 "Three iron rules" 第一条逐个验证：`gh api repos/actions/checkout/releases/latest --jq .tag_name`。
- **资产逐个写死不用通配**：两个 zip（版本形态写在 zip 名里，解压出来永远是干净的 `Xxx.exe`）、框架依赖版的裸 exe（点开即用、可覆盖更新——只有小包这么发；自带运行时的裸 exe 体积大、无签名、直接可执行三样占齐，实测最容易被浏览器和 SmartScreen 拦下）、`SHA256SUMS.txt`。加资产要同时改 `files:` 和那句 `Get-FileHash`（后者会连带把 attestation 覆盖到）。
- **校验值放生成的文件里，不放 README**：文档里的数字会腐烂，`SHA256SUMS.txt` 每版随构建重新生成，永远和资产一致。

## 校验：SHA256SUMS 与 attestation 串起来用，不是二选一

**每一个发出去的资产都要有一行，不是挑一个。** 两种形态是给两拨人的（拿不准的人下自带运行时的、装了运行时的人下小包），只给其中一个出校验值，另一拨人手里就是个没法验的文件。上面脚本里 `*.zip` 加那个裸 exe 正好覆盖全部三个可下载物。

**`SHA256SUMS.txt` 单独用有个绕不过去的弱点**：它和它校验的文件放在同一个 release 页上。能替换资产的攻击者同样能替换这份 sums——它挡得住传输损坏和 CDN 缓存串味，挡不住上游被攻破。补这一层的是 **GitHub 官方的 artifact attestation**：构建时用 OIDC 换令牌签一份来源证明，存在 GitHub 那边而不是你的 release 里，用户验的是「这个文件确实由 `OWNER/REPO` 的这条 workflow 构建出来」：

```bash
gh attestation verify Xxx-v1.2.0-win-x64.zip -R OWNER/REPO
```

**两者是串起来的。** attestation 的 `subject-checksums` 输入直接吃 `SHA256SUMS.txt`（[官方 README](https://github.com/actions/attest) 的 "Identify Subjects with Checksums File" 一节，本来就是为 goreleaser 这类会生成校验文件的工具准备的），于是：

- **文件清单只存在一处**——那句 `Get-FileHash`。加资产改一行，attestation 自动跟着覆盖到，不会出现「漏签一个还不报错」；换成 `subject-path` 逐个列文件就有这个风险。
- **两拨用户都照顾到**：装了 `gh` 的验来源证明（强，能识破上游被攻破）；没有任何工具的用 `certutil -hashfile` / `Get-FileHash` / `sha256sum` 对一下（弱，但零依赖、离线可用）。
- **格式**：shasum 那套「摘要 + 空格 + 模式标志（`*` 二进制 / 空格 文本）+ 文件名」。上面脚本输出的两个空格正好是「分隔空格 + 文本模式标志」，直接符合。编码显式写死 `ascii`：内容本来全是 ASCII，而两代 PowerShell 的 `Set-Content` 默认值并不相同（5.1 是系统 ANSI 代码页，7.x 是 `utf8NoBOM`），写死就不吃这个差异。注意常见的说法「5.1 默认带 BOM」并不成立——`Set-Content` 两代都不写 BOM，真正会写 BOM 的是显式 `-Encoding UTF8`（5.1）以及 `Out-File` / `>` 默认的 UTF-16LE。

**要砍就砍逐个列文件那种写法，别砍 `SHA256SUMS.txt`。** 只留 attestation 的代价是：没装 `gh` 的用户完全无从校验——而下载一个托盘小工具的人，多数不会为验签去装 GitHub CLI。

**不建议为算哈希再引第三方 action**：`Get-FileHash` 是 PowerShell 内建，三行写完，而校验环节多一个第三方依赖恰好是它想防的那类风险。

**顺带**：winget 那条路不需要你操心哈希——manifest 里本来就带 `InstallerSha256`，`wingetcreate update` 会自己下载安装包算好填进去。SHA256SUMS 和 attestation 是给直接从 release 页下载的人用的。

**选包说明写在 release body，别写在 README**：选包这件事发生在下载页；GitHub 会把自动 changelog 接在 body 后面。体积数字一个都不写，资产列表旁边本来就有。

## winget 提交（按官方文档，未在示例项目实测）

工具用微软官方的 [wingetcreate](https://github.com/microsoft/winget-create)，别的包装 action 都是社区二传手。

- **首次收录要人跑一次，但它是向导**：`wingetcreate new <安装包URL>` 会自己下载安装包、提取元数据，逐步引导你确认/编辑 `PackageIdentifier`（`发布者.应用名` 格式）和必填字段，最后问一声就直接帮你把 PR 提到 [winget-pkgs](https://github.com/microsoft/winget-pkgs)（带 `--token` 免登录）。人工+机器人审核通过后才有「更新」可言，CI 里只放 `update`。
- **`update` 会自己算 SHA256**：给它带版本号的安装包 URL，它下载、算哈希、改 manifest、提 PR 一条龙（`--submit`）。
- **URL 必须每版唯一**：zip 名里带 tag 正好；裸 exe 那个无版本文件名不能当 winget 的安装器 URL。portable 类型的 zip winget 直接支持（manifest 里 `InstallerType: zip` 套 `portable`）。
- **`WINGET_TOKEN` 是 GitHub PAT**，存 repo secret，给 fork/提 PR 到 winget-pkgs 用；所需最小权限见官方 [token.md](https://github.com/microsoft/winget-create/blob/main/doc/token.md)，别直接给全量 repo 权限。
- 提交后是**人工+机器人混合审核**，不是发出去立刻可 `winget install`；发版脚本不要依赖它同步完成。

## 和本 skill 其他文件的接线

| 这里引用的 | 在哪 |
| --- | --- |
| 两份 pubxml 的完整内容、profile 名与 `PublishDir` | `project-setup.md`「发布：两份 pubxml，csproj 一个发布属性都不放」 |
| 为什么发布属性不能进 csproj、两份 profile 互相抄错的三个坑 | `pitfalls.md`「测试工程引用 App 就报 NETSDK1151」 |
| `--minimum-expected-tests` 的来历、xunit.v3 上 MTP | `project-setup.md`「工程分三个，测试只测 Core」 |
| `--smoke` 的实现和 CI marker 判定脚本 | `dev-switches.md`「`--smoke`：CI 里防 XAML 错误带到发版」 |
| `--shots` 批量截图（改了 UI 该跑的那个） | `dev-switches.md`「`--shots <目录>`」 |
| `VersionFromGitTag` target 与 `-p:Version` 的配合、`fetch-depth: 0` | `pitfalls.md`「版本号发出去还是上一版」 |
| 压缩开关的启动代价（决定 `EnableCompressionInSingleFile` 开不开） | `pitfalls.md`「开了 ReadyToRun 反而更慢」 |

多个文件怎么签：`subject-checksums` 喂一份校验文件是本页用的写法；官方另外支持 `subject-path` 直接给**换行分隔的多个路径或 glob 通配**（如 `dist/*.zip`），以及 `subject-digest`（手里只有摘要没有文件时用，需配 `subject-name`）。三选一、不能同时给；单次 attestation 的 subject 上限 1024 个。
