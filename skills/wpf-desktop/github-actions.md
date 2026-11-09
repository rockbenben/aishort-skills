# GitHub Actions：测完才能发版，一个文件三个 job

本页提供 WPF 的 Windows 构建、打包和草稿发布工作流。维护多种桌面技术栈时，可对照 [desktop-app-standard 的通用发布验收](https://github.com/rockbenben/aishort-skills/blob/main/skills/desktop-app-standard/references/release-flow.md)。本页的命令和资产清单可独立使用。

**照抄前必须改三处**，否则第一次跑必红：把 `Xxx` 换成你的名字、确认工程路径与 `project-setup.md` 的目录约定一致（本页用 `src/` + `tests/`）、核对 `uses:` 的上游标签，并确认测试项目采用示例的 .NET 10 MTP 模式。

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
      - name: Verify the .NET 10 build SDK
        shell: pwsh
        run: |
          $sdk = dotnet --version
          if ($LASTEXITCODE -or $sdk -notmatch '^10\.0\.\d+$') { throw "Expected stable .NET 10 SDK, got $sdk" }
          Write-Host "Build SDK: $sdk"
      # --minimum-expected-tests 防「静默 0 测试」：适配器没加载好时一个用例不跑却退出 0
      - name: Test
        run: dotnet test --project tests/Xxx.Core.Tests -c Release --minimum-expected-tests 1
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
    outputs:
      assets: ${{ steps.package.outputs.files }}
      sums_digest: ${{ steps.package.outputs.sums_digest }}
      draft_id: ${{ steps.upload.outputs.id }}
      commit: ${{ steps.source.outputs.commit }}
    permissions:
      contents: write              # 建草稿、传资产
      id-token: write              # attest 和 Azure 签名都靠 OIDC 换令牌，不存长期密钥
      attestations: write          # attest：把来源证明写回仓库
      artifact-metadata: write     # attest v4：写制品存储记录
    env:
      TAG: ${{ github.ref_name }}  # 进 shell 一律走 env，不把 ${{ }} 直接拼进脚本
    steps:
      - uses: actions/checkout@v7
        id: source
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-dotnet@v6
        with:
          global-json-file: global.json
      - name: Verify the .NET 10 build SDK
        shell: pwsh
        run: |
          $sdk = dotnet --version
          if ($LASTEXITCODE -or $sdk -notmatch '^10\.0\.\d+$') { throw "Expected stable .NET 10 SDK, got $sdk" }
          Write-Host "Build SDK: $sdk"
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
            $tfm = dotnet msbuild src/Xxx.App/Xxx.App.csproj -p:Configuration=Release -p:PublishProfile=$p -getProperty:TargetFramework
            if ($LASTEXITCODE -or $tfm -notmatch '^net10\.0-windows(?:\d+(?:\.\d+)*)?$') {
              throw "Profile $p must target .NET 10 Windows. Evaluated TFM: $tfm"
            }
            dotnet publish src/Xxx.App -c Release -p:PublishProfile=$p -p:Version=$v --nologo
            # 原生命令的非零退出不会中断 pwsh，而 runner 只在最后一行之后看 $LASTEXITCODE：
            # 不在循环里逐个判，前三次失败 + 最后一次成功 = 绿灯少三个资产
            if ($LASTEXITCODE) { exit $LASTEXITCODE }
          }
      # --- 签名（Azure Artifact Signing）-----------------------------------------------------
      # 仓库变量 AZURE_CLIENT_ID 未配时跳过签名；在发布说明中注明该版本的签名状态。
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
      # --- 安装包编译（Inno Setup）---------------------------------------------------
      # 编译免 UAC 安装包（三轨分发的主力推荐）。
      # 单脚本项目可放在 tools/installer 下；有多个 .iss 时显式选择当前发行版。
      - name: Build Installer (Inno Setup)
        id: installer
        shell: pwsh
        run: |
          $scripts = @(Get-ChildItem tools/installer/*.iss -File -ErrorAction SilentlyContinue)
          if ($scripts.Count -eq 0) { return }
          if ($scripts.Count -gt 1) { throw 'Select the installer script for this edition' }
          function Find-Inno6 {
            $PSNativeCommandUseErrorActionPreference = $false  # ISCC /? returns 1 after printing usage
            $candidates = @(
              "${env:ProgramFiles(x86)}/Inno Setup 6/ISCC.exe"
              "$env:ProgramFiles/Inno Setup 6/ISCC.exe"
              (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
            )
            foreach ($file in $candidates) {
              if ($file -and (Test-Path $file -PathType Leaf)) {
                # ISCC /? emits the compiler major in its banner and returns 1 for usage.
                $banner = & $file '/?' 2>&1
                if ($banner -match '^Inno Setup 6 Command-Line Compiler') { return $file }
              }
            }
          }
          $compiler = Find-Inno6
          if (-not $compiler) {
            $versions = choco search innosetup --exact --all-versions --limit-output
            if ($LASTEXITCODE) { exit $LASTEXITCODE }
            $version = $versions | ForEach-Object {
              if ($_ -match '^innosetup\|(6\.\d+\.\d+)$') { [version]$Matches[1] }
            } | Sort-Object -Descending | Select-Object -First 1
            if (-not $version) { throw 'No stable Inno Setup 6.x available from the package source' }
            choco install innosetup --version="$version" --allow-downgrade --no-progress -y
            if ($LASTEXITCODE) { exit $LASTEXITCODE }
            $compiler = Find-Inno6
          }
          if (-not $compiler) { throw 'Inno Setup 6 compiler not found' }
          Write-Host "Inno Setup 6 compiler: $compiler"
          $name = "Xxx-$env:TAG-setup"
          & $compiler "/DAppVersion=$($env:TAG.Substring(1))" "/O$PWD" "/F$name" $scripts[0].FullName
          if ($LASTEXITCODE) { exit $LASTEXITCODE }
          if (-not (Test-Path "$name.exe" -PathType Leaf)) { throw "Missing $name.exe" }
          "asset=$name.exe" >> $env:GITHUB_OUTPUT
      - name: Sign the installer before hashing
        if: vars.AZURE_CLIENT_ID != '' && steps.installer.outputs.asset != ''
        uses: azure/artifact-signing-action@v2
        with:
          endpoint: ${{ vars.ARTIFACT_SIGNING_ENDPOINT }}
          signing-account-name: ${{ vars.ARTIFACT_SIGNING_ACCOUNT }}
          certificate-profile-name: ${{ vars.ARTIFACT_SIGNING_PROFILE }}
          files: ${{ github.workspace }}/${{ steps.installer.outputs.asset }}
          file-digest: SHA256
          timestamp-rfc3161: http://timestamp.acs.microsoft.com
          timestamp-digest: SHA256
      - name: Package + SHA256
        id: package
        shell: pwsh
        env:
          INSTALLER: ${{ steps.installer.outputs.asset }}
        run: |
          $pub = 'src/Xxx.App/bin/Release'
          $assets = @()
          if ($env:INSTALLER) { $assets += $env:INSTALLER }

          # 2. 便携与框架依赖包
          foreach ($arch in 'x64', 'arm64') {
            foreach ($form in '', '-needs-dotnet10') {
              $zip = "Xxx-$env:TAG-win-$arch$form.zip"
              Compress-Archive -Path "$pub/publish-$arch$form/Xxx.exe" -DestinationPath $zip -Force
              $assets += $zip
            }
          }
          # 每一个要发出去的资产都要有行：这份清单同时也是下一步 attestation 的输入。
          # 格式是 shasum 那套「十六进制摘要 + 空格 + 模式标志 + 文件名」，两个空格 = 分隔 + 文本模式标志
          $lines = Get-FileHash $assets -Algorithm SHA256 |
            ForEach-Object { "{0}  {1}" -f $_.Hash.ToLower(), (Split-Path $_.Path -Leaf) }
          # 必须 LF：Windows 上 Set-Content/Out-File 写 CRLF，Linux/macOS 的 `sha256sum -c` 会把 \r
          # 当成文件名的一部分，全部报找不到文件。路径用 $PWD 拼绝对路径：.NET 的当前目录不跟 pwsh 的 Set-Location 走
          [IO.File]::WriteAllText("$PWD/SHA256SUMS.txt", ($lines -join "`n") + "`n")
          $digest = (Get-FileHash -LiteralPath SHA256SUMS.txt -Algorithm SHA256).Hash.ToLowerInvariant()
          $output = @("sums_digest=$digest", 'files<<END_ASSETS') + $assets + @('SHA256SUMS.txt', 'END_ASSETS')
          [IO.File]::AppendAllText($env:GITHUB_OUTPUT, ($output -join "`n") + "`n")
      # 官方来源证明：比 SHA256SUMS 强一档，用户拿 `gh attestation verify` 能验到
      # 「这个文件确实由本仓库这条 workflow 构建」，而不只是「文件没被改过」。
      # 喂 SHA256SUMS.txt 而不是再抄一遍文件清单：清单只存在于上面那个 $assets，
      # 加资产时改一处，attestation 自动跟着覆盖到，不会出现「漏签一个还不报错」。
      - uses: actions/attest@v4
        with:
          subject-checksums: SHA256SUMS.txt
      - name: Require a new release or an existing draft
        shell: bash
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
        run: |
          set -euo pipefail
          gh api --paginate --slurp "repos/$GH_REPO/releases?per_page=100" |
            jq -e --arg tag "$TAG" '[.[][] | select(.tag_name == $tag)] | length == 0 or (length == 1 and .[0].draft)'
      - name: Upload to draft release
        id: upload
        uses: softprops/action-gh-release@v3
        with:
          # 先进草稿：开了 immutable releases 后，release 公开的那一刻资产和 tag 就锁死，
          # 传一半就公开等于永久缺一个资产。草稿阶段重跑会复用同一份草稿、覆盖同名资产
          draft: true
          fail_on_unmatched_files: true
          files: ${{ steps.package.outputs.files }}
          body: |
            **Which package? / 下载哪个？**

            - `…-setup.exe` — Installer, when included in this edition; no admin rights required, desktop shortcut & clean uninstallation. / 提供安装包的版本可选它，支持快捷方式与卸载。
            - `…-win-x64.zip` — Portable edition with .NET runtime included; unzip and run. / 自包含便携版（含运行环境），解压即用，拿不准就选它。
            - `…-win-arm64.zip` — Same portable edition for Windows on Arm (Snapdragon / Surface Pro). / 同上，ARM 版 Windows 便携版。
            - `…-win-{x64,arm64}-needs-dotnet10.zip` — Compact edition (needs .NET 10 Desktop Runtime). / 框架依赖精简版，需已装 .NET 10 桌面运行时。

            Verify / 校验：`sha256sum -c SHA256SUMS.txt` or `gh attestation verify <file> -R ${{ github.repository }}`
          generate_release_notes: true

  publish:                         # 核验草稿 → 公开 → 断言 latest
    needs: release
    concurrency:
      group: desktop-release-promotion
      queue: max
    outputs:
      latest: ${{ steps.promote.outputs.latest }}
    runs-on: ubuntu-latest         # 只调 API 和 sha256sum，用 Linux 顺带验证校验文件在 Linux 上真的能用
    timeout-minutes: 10
    # 想人工把关再公开：加一行 `environment: release`，在 Settings → Environments 给它配 required reviewers
    permissions:
      contents: write              # 改草稿状态
    env:
      TAG: ${{ github.ref_name }}
      GH_TOKEN: ${{ github.token }}
      GH_REPO: ${{ github.repository }}
      DRAFT_ID: ${{ needs.release.outputs.draft_id }}
      COMMIT: ${{ needs.release.outputs.commit }}
    steps:
      - name: Verify draft assets
        shell: bash
        run: |
          set -euo pipefail
          gh api "repos/$GH_REPO/releases/$DRAFT_ID" | jq -e --arg tag "$TAG" '.draft and .tag_name == $tag'
          gh release download "$TAG" --dir dl
          cd dl
          printf '%s  SHA256SUMS.txt\n' "$EXPECTED_DIGEST" | sha256sum --strict -c -
          diff -u <(printf '%s\n' "$EXPECTED_ASSETS" | sort) <(find . -maxdepth 1 -type f -printf '%f\n' | sort)
          diff -u <(printf '%s\n' "$EXPECTED_ASSETS" | grep -vxF SHA256SUMS.txt | sort) <(cut -c67- SHA256SUMS.txt | sort)
          sha256sum --strict -c SHA256SUMS.txt
        env:
          EXPECTED_ASSETS: ${{ needs.release.outputs.assets }}
          EXPECTED_DIGEST: ${{ needs.release.outputs.sums_digest }}
      - name: Publish and mark latest
        id: promote
        shell: bash
        run: |
          set -euo pipefail
          current=$(gh api "repos/$GH_REPO/commits/$TAG" --jq .sha)
          [[ "$current" == "$COMMIT" ]] || { echo "::error::Tag moved since build"; exit 1; }
          latest=true
          # A slower older tag may reach this job after a newer stable release.
          if [[ "$TAG" != *-* ]]; then
            published=$(gh api --paginate "repos/$GH_REPO/releases?per_page=100" \
              --jq '.[] | select(.draft == false and .prerelease == false) | .tag_name | select(test("^v[0-9]+[.][0-9]+[.][0-9]+$"))')
            newest=$(printf '%s\n' "$TAG" "$published" | sort -V | tail -n 1)
            [[ "$newest" == "$TAG" ]] || latest=false
          fi
          gh api -X PATCH "repos/$GH_REPO/releases/$DRAFT_ID" -F draft=false -F prerelease=false -f make_latest="$latest" >/dev/null
          echo "latest=$latest" >> "$GITHUB_OUTPUT"
          if [[ "$latest" == false ]]; then exit 0; fi
          latest=$(gh api "repos/$GH_REPO/releases/latest" --jq .tag_name)
          test "$latest" = "$TAG" || { echo "::error::releases/latest is $latest, expected $TAG"; exit 1; }
      # --- winget：默认什么都不做（路 A，清单流水线定时巡检）。路 B 见下文，接在这个 job 后面 ---
```

按 tag 下载草稿时使用对仓库有权限的 GitHub CLI。publish job 排队核验。新稳定版公开并取得 latest，随后查询 API 核对 tag。后到的旧版本作为历史 release 公开，winget 跟随取得 latest 的版本。这个模板只接受稳定版 tag，预发布渠道需要自己的版本匹配与验收。

## 承重的几处，别顺手「优化」掉

- 新项目默认使用上游 Action 的大版本标签。复制模板或升级仓库时，查明当前稳定 release 与 runner 要求，实际更新 `uses:` 以及受影响的输入和权限，再验证工作流。沿用已有项目的标签、精确版本或 SHA 策略。
- **记录实际编译器**。有安装包时，按 ISCC 横幅核对 6.x；runner 缺失时从配置的包源选稳定的 6.x 安装。
- **全局 `contents: read`，写权限只给 `release` / `publish`**：PR 触发时这两个 job 不跑，PR 里的代码永远拿不到写令牌。
- **草稿 → 核验 → 公开，分两个 job**：`softprops/action-gh-release` 用 `draft: true` 时，重跑会找到同一份草稿、覆盖同名资产，上传中途断了重跑就好；`gh release create` 会直接撞「release already exists」。公开放在单独的 `publish` job：`sha256sum -c` 不过（缺资产或内容不符）就停在草稿，用户看不到半成品；开了 immutable releases 的仓库这一步尤其重要，公开之后资产就改不了了。
- **断言 `releases/latest` 等于本 tag**：应用内的更新检查、winget 清单流水线读的都是 `releases/latest`，它忽略草稿和预发布。只「发出去」不断言，可能出现 release 页上有新版、所有人却还被告知「已是最新」。
- **发布资产取自同一份清单**。打包步骤列出四个 ZIP 和本次实际构建的安装包，上传与草稿核验复用该清单。重跑后草稿中如有上次遗留的资产，文件集合比对会报出文件名。
- **签名在打包之前，哈希在签名之后**：顺序反了，`SHA256SUMS.txt` 和 attestation 记的是未签名文件的摘要，用户下到的签名版一个都对不上。
- **校验值放生成的文件里，不放 README**：文档里的数字会腐烂，`SHA256SUMS.txt` 每版随构建重新生成，永远和资产一致。

## 校验：SHA256SUMS 与 attestation 串起来用，不是二选一

**每一个发出去的资产都要有一行，不是挑一个。** 几种形态是给不同的人的（拿不准的人下自带运行时的、装了运行时的人下小包、ARM 设备下 arm64），只给其中一个出校验值，另一拨人手里就是个没法验的文件。上面脚本里的 `$assets` 覆盖四个 ZIP 和本次可选的安装包（`SHA256SUMS.txt` 自己不在里面——它没法包含自己的摘要）。

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

- **签了**：配置仓库变量后先签应用 exe，再签编译好的安装包，最后计算摘要。OIDC 登录（`azure/login` 用联合凭据，仓库里不存任何密钥），签名账户给这个应用注册授予 *Artifact Signing Certificate Profile Signer* 角色。单文件 exe 直接签发布产物本身即可。
- **没签**：变量留空时签名步骤自动跳过；release body 里加一句「首次运行 SmartScreen 会提示，点『更多信息 → 仍要运行』；可用 SHA256 / attestation 校验」。工作流里有签名步骤不等于发出去的是签名版，变量为空时照样是未签名的；在 README 里写一行「当前未签名：暂无 Artifact Signing 资格」，别让人看到 workflow 就以为已经签了。

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
    needs: publish
    if: needs.publish.outputs.latest == 'true'
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

## 修了卸载规则，旧版升级后仍会删除用户文件

Inno Setup 的旧卸载日志可能在升级时继续沿用。仅把当前 `[UninstallDelete]` 的递归删除改为 `dirifempty`，不能证明旧安装升级后已安全。本次新装卸载通过，旧包升级再卸载却仍删除了安装目录里的哨兵文件。

当问题确为历史危险记录，且本版完整重新安装并登记全部当前受管文件时，可评估 [`UninstallLogMode=overwrite`](https://jrsoftware.org/ishelp/topic_setup_uninstalllogmode.htm)。这不是所有安装器的默认建议：替换日志可能让已从本版清单移除的旧受管文件失去卸载记录，需要盘点旧文件及补充迁移规则。

复验要实际安装旧包、保留同一测试 AppId 升级到新包，再运行新卸载器；另测一次全新安装后卸载。测试身份和用户路径与真实产品隔离，但保留所验证的文件及卸载规则。在各分发目录和邻接位置放用户文件哨兵，核对版本、所有受管文件移除及哨兵完整，不能只看主 EXE 消失。卸载器退出后的辅助进程可能还在自清理；用有超时的轮询检查残留，超时后列出具体文件，而不是无限等待或立即误报。

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
| Action 引用和 .NET 通道 | [依赖升级](upgrade-dependencies.md) |

多个文件怎么签 attestation：`subject-checksums` 喂一份校验文件是本页用的写法；官方另外支持 `subject-path` 直接给**换行分隔的多个路径或 glob 通配**（如 `dist/*.zip`），以及 `subject-digest`（手里只有摘要没有文件时用，需配 `subject-name`）。三选一、不能同时给；单次 attestation 的 subject 上限 1024 个。
