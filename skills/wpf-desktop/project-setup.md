# WPF 项目起手：装什么、建什么、怎么发布

本技能的 WPF 目标是 .NET 10。新建和升级时按[依赖升级](upgrade-dependencies.md)取得 10.0 通道的最新稳定 SDK，并安装可用于该框架的依赖。

这页只管起手选型和发布配置；撞过的坑在 `pitfalls.md`，验证工具在 `dev-switches.md`，CI 与发版流水线在 `github-actions.md`。

## 第一个项目装什么

下表用于选择组件。.NET 10 是目标大版本，示例中的具体 SDK 和 NuGet 补丁号在执行时重新解析。

| 位置       | 选它                                          | 什么时候才该换                                                        |
| ---------- | --------------------------------------------- | --------------------------------------------------------------------- |
| 目标框架 | `net10.0-windows` | 新建与升级统一对齐 .NET 10，保留实际需要的 Windows 最低版本。 |
| SDK 版本 | global.json 记录完整 SDK 版本及 rollForward 策略 | 构建环境安装并验证目标稳定 SDK。项目需兼容较低开发 SDK 时，在 CI 单独安装目标补丁。 |
| 依赖锁 | 示例使用精确 PackageReference；已有锁文件保留 | 单文件发布时验证 SDK 隐式依赖与锁文件是否一致，见下文「NuGet 锁文件与单文件发布」。 |
| 开发环境   | VS 2026 Community 加「.NET 桌面开发」工作负载 | 手里已经有 Rider 就用 Rider。面向 net10.0 的 IDE 至少需要 VS 18.0，见下文的 SDK 对应表 |
| 编辑器扩展 | 先用 IDE 已有能力 | 按实际缺口增加，例如多语言资源管理。 |
| MVVM       | `CommunityToolkit.Mvvm`                       | 窗口少、状态简单的小工具，直接 code-behind 也成立                     |
| 托盘图标   | `H.NotifyIcon.Wpf`                            | 工程本来就开了 `UseWindowsForms` 时，用内建的 NotifyIcon              |
| 界面主题 | 可先试自带 Fluent 与语义资源 | 按所需控件、导航和维护成本选择库，保留已有主题方案。 |
| 配置文件 | 默认 System.Text.Json | 已有格式和迁移兼容性优先。 |
| 日志       | 自己往文件里追加一行                          | 需要多个输出目标或结构化查询时上 Serilog                              |
| 依赖注入   | 不用                                          | 服务多到互相依赖、构造顺序开始绕时再上                                |
| Win32 调用 | 少量调用可手写 DllImport | 结构体与签名维护复杂时考虑 Microsoft.Windows.CsWin32。 |
| 测试 | 新项目可用 xunit.v3 和内置 Assert | 已有 runner 沿用；增加断言库前核对许可与实际价值。 |
| 多语言 | resx 与绑定包装 | 沿用已验证的资源方案；LocBaml 是[示例工具](https://learn.microsoft.com/dotnet/desktop/wpf/advanced/how-to-localize-an-application)，采用前核对生产适用性。 |
| 发布 | pubxml 按 x64/ARM64、自包含/框架依赖分开 | 按分发矩阵和实际原生依赖验证，各 profile 独立输出。 |
| 自动更新   | 启动后（或设置页里）查一次 GitHub `releases/latest`，比本地版本新就提示并打开 Release 页；零依赖，几十行 | 真需要静默下载替换时上 `Velopack`。`releases/latest` 不含草稿和预发布，所以发版流程必须真的把它切到新 tag（直接发布后按 `github-actions.md` 验收 latest 和下载入口） |
| 代码签名   | 有资格就签：[Azure Artifact Signing](https://azure.microsoft.com/products/artifact-signing)（前身 Trusted Signing），`github-actions.md` 里的签名步骤配好仓库变量就生效。签名前按服务当前的身份、地区与证书配置要求核对发布者资格。 | 没资格就不签：变量留空，签名步骤自动跳过；release 说明里提前写明 SmartScreen 会提示「未知发布者」，并给 SHA256（attestation 按项目需要添加） 让人能验（`github-actions.md`） |

按需要引入依赖，不为采用本技能替换已有可用组件。

### 开发环境

Visual Studio 安装“.NET 桌面开发”工作负载即可获得 SDK、XAML 设计器和调试工具。已有 Rider 或命令行工作流可以继续使用；VS Code 的 XAML 可视化能力与完整 IDE 不同。

目标 net10.0 的 IDE/MSBuild 支持需按 [SDK 与 MSBuild/VS 对应表](https://learn.microsoft.com/dotnet/core/porting/versioning-sdk-msbuild-vs) 核对；仅安装 SDK 不代表旧 IDE 已支持该目标。

### 托盘图标：看工程里有没有 WinForms

分界线不是菜单长短，是工程有没有已经拖进 WinForms。

纯 WPF 工程可选 H.NotifyIcon.Wpf。在项目的 NuGet 源查询支持目标 TFM 的最新稳定版，安装并验证创建、显示和销毁托盘图标。托盘和菜单可放进 `App.xaml` 的资源中，在启动时用 `FindResource` 取出。切换语言时同步刷新菜单标题。[H.NotifyIcon.Wpf](https://www.nuget.org/packages/H.NotifyIcon.Wpf)

**放在资源字典里就必须手动 `ForceCreate()`，否则整个应用没有托盘图标。**

```csharp
_tray = (TaskbarIcon)FindResource("Tray");
if (!_tray.IsCreated)
    _tray.ForceCreate(enablesEfficiencyMode: false);   // 资源里的 TaskbarIcon 不进可视树，永远不 Loaded
// …OnExit 里 _tray?.Dispose()，把 shell 图标交还回去
```

按响应要求选择该参数：[官方签名](https://github.com/HavenDV/H.NotifyIcon)是 `ForceCreate(bool enablesEfficiencyMode = true)`，默认开启效率模式。对热键响应敏感的应用可显式关闭，并测量实际影响。

资源字典中的 `TaskbarIcon` 不进入可视树，不能依赖 `Loaded` 自动创建。需要覆盖托盘初始化时，用独立检查验证 `ForceCreate`、`IsCreated`、图标资源和 `Dispose`，常规窗口 smoke 不一定经过该路径。

已有 WinForms 的工程也可沿用 `NotifyIcon`，同时处理菜单样式、语言更新和 DPI。不要仅为托盘或剪贴板无条件增加/移除一套 UI 框架。

### MVVM：`CommunityToolkit.Mvvm`，或者干脆 code-behind

WPF 自带的 `INotifyPropertyChanged` 要手写一堆 `OnPropertyChanged(nameof(X))`，`ICommand` 还得自己实现一个类。`CommunityToolkit.Mvvm` 是微软官方维护的 MVVM 工具包，用源生成器减少通知与命令样板；仍需验证项目实际绑定与发布行为：

```csharp
public partial class MainViewModel : ObservableObject
{
    [ObservableProperty]
    private string _keyword = "";

    [RelayCommand]
    private async Task SearchAsync() { /* ... */ }
}
```

`_keyword` 生成公开的 `Keyword`，`SearchAsync` 生成 `SearchCommand`，XAML 直接绑这两个名字。窗口少、状态简单的小工具直接 code-behind 加事件处理也完全成立——别为了模式而模式，等绑定和通知的手写量超过引包的成本再换。

同一套 `Microsoft.Extensions.*` 里的依赖注入可以先不上。小工具三五个服务，窗口互相 `new`、配置做成静态单例完全撑得住。等到出现「设置被五个窗口读、其中两个还要在设置改了之后刷新」这种关系再引。

### 界面主题与控件库

先检查项目已有主题。新项目可试 WPF 自带 Fluent 的 `ThemeMode`，再用 `Theme.xaml` 补语义画刷与未覆盖样式；需要运行时切换的资源使用 `DynamicResource`，`StaticResource` 不会随资源字典替换重新求值。[WPF 资源](https://learn.microsoft.com/dotnet/desktop/wpf/systems/xaml-resources-overview)

按实际控件、导航、可访问性与维护成本选择控件库，不把“零依赖”当目标。已有库不为风格重写，避免在同一应用保留两套互不协调的主题控制。代码编辑器可考虑 AvalonEdit；自定义 `.xshd` 作为 EmbeddedResource 发布，并在安装版验证加载。

### 按边界组织工程与测试

```
src/Xxx.App/          net10.0-windows, UseWPF   只放窗口和交互
src/Xxx.Core/         net10.0                   业务逻辑
tests/Xxx.Core.Tests/ net10.0, OutputType=Exe   xunit.v3
```

`src/` 和 `tests/` 这两层不是洁癖，`github-actions.md` 里的每一条路径都按这个约定写；换成扁平布局记得同步改 CI。

下面是 App 工程的起点；保留项目所需的其他属性，发布专用配置放入 profile：

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net10.0-windows</TargetFramework>
    <UseWPF>true</UseWPF>
    <Nullable>enable</Nullable>
    <AssemblyName>Xxx</AssemblyName>
    <ApplicationManifest>app.manifest</ApplicationManifest>
    <VersionFallback>0.0.1</VersionFallback>
    <Version>$(VersionFallback)</Version>
  </PropertyGroup>
</Project>
```

配置要点：

- `AssemblyName` 决定产物叫 `Xxx.exe` 而不是 `Xxx.App.exe`：默认取工程名，不设这行发版脚本里的文件名全对不上。
- `VersionFallback` 是那个 target 的 Condition 判据，必须定义，否则 target 永不触发；真正的版本从 git tag 取，见 pitfalls.md「版本号发出去还是上一版」。
- 这里故意没有 `RuntimeIdentifier(s)`、`SelfContained`、`PublishSingleFile`（全在 pubxml），锁文件按下文「NuGet 锁文件与单文件发布」选择。

将不依赖 Windows API、WPF 或 Windows 专用包的业务逻辑放在普通 net10.0 库，便于跨平台测试；平台边界按实际 API/包依赖判断，不只看命名空间。UI 行为需要 Windows/WPF 宿主测试，见 [自查工具](dev-switches.md)。

更小的工具可以压成两个工程：Core 做成 app 工程里的一个文件夹，测试工程直接引用 app 工程、配合 `InternalsVisibleTo` 测 internal。代价是测试工程也得跟着 `net10.0-windows` 加 `UseWPF`（好处是测试里能构造真窗口）。

新项目选择适配目标 SDK 的 xUnit v3/MTP 模板，已有工程保留自己的 runner 和适配器。包名与 NuGet 版本号是两件事，不根据版本大号猜包名。断言库按许可和需求选择，默认使用框架内置 Assert。

使用支持 MTP 的 xUnit v3 模板（测试平台 1.7 或更高），并设置下一节的 `global.json`，可为运行的测试数设下限。

```bash
dotnet test --project tests/Xxx.Core.Tests -c Release --minimum-expected-tests 1
```

适配器没加载好的时候，`dotnet test` 会一个用例不跑却退出 0，CI 显示绿色，这个参数就是防它的。

### SDK 固定：global.json 一处说了算

在选定的 10.0 SDK 下创建 `dotnet new wpf -n MyApp -f net10.0`，再按需用 `dotnet add MyApp/MyApp.csproj package <包名> --version <稳定版本>` 添加依赖。已有工程保留自己的测试 runner。下例的 test 段仅适用于选择 MTP 的项目。[Microsoft 测试运行模式](https://learn.microsoft.com/dotnet/core/testing/unit-testing-with-dotnet-test)

```json
{
  "sdk": {
    "version": "10.0.100",
    "rollForward": "latestFeature",
    "allowPrerelease": false
  },
  "test": { "runner": "Microsoft.Testing.Platform" }
}
```

- **写完整版本**。新项目把示例里的 `10.0.100` 换成本次选定的稳定 SDK。升级时先让本地和 CI 能安装目标 SDK，再更新所需 pin 并运行 `dotnet --version` 核验。
- **`latestFeature` 让本机可选已安装的补丁**：本机在已安装的 SDK 里挑最新的 10.0.x（VS 2026 自己升级后不会编不过）。CI 侧要单独看：`setup-dotnet` 的 `global-json-file` 读的是 `sdk.version`，不要假设它会替你执行 `rollForward`（升级 action 前核对其 README/源码）。CI 实际拿到的补丁取决于 action 版本与 runner 预装的 SDK；要保证 CI 也带上最新运行时补丁，定期抬 `global.json` 的下限，或显式安装目标 SDK。自包含版把运行时打进 exe，CI 用哪个 SDK 就带哪个运行时补丁。
- CI 可以通过 `global-json-file` 安装项目指定的 SDK。若 global.json 必须保留更低的开发下限，在 CI 单独安装期望的 SDK 并记录实际选择。
- **迁到 .NET 10** 时，同步修改实际消费 TFM 的项目、pubxml、运行时安装说明、CI 和 `needs-dotnet10` 产物名。只有技能目标或用户明确要求变化时，再迁往其他大版本。

#### SDK 下限与测试模式

`global.json` 的 version 与 rollForward 共同决定 SDK 选择，`disable` 要求精确版本；允许前滚时提高下限仍可能使贡献者的旧 feature band 无法构建。下限应覆盖所需能力，CI 另外核验实际 SDK 和自包含产物的运行时补丁，不为兼容旧 SDK 静默放弃能力要求。

使用 MTP 的 `dotnet test` 模式时保留 `"test": {"runner":"Microsoft.Testing.Platform"}`；缺少它可能切回 VSTest，使 MTP 专用参数失败。怀疑 SDK 能力或配置未生效时，在隔离目录用指定 SDK 运行目标命令，并比较开启/关闭该配置的行为，避免只凭源码位置或成功退出码推断。

### NuGet 锁文件与单文件发布

单文件发布会启用 `EnableSingleFileAnalyzer`，可能隐式引用 `Microsoft.NET.ILLink.Tasks`；普通 restore 生成的锁文件不一定覆盖 publish 所需依赖。遇到 `NU1004` 时，比较还原与发布的 SDK、RID、profile 和 `EnableSingleFileAnalyzer`，检查锁文件中的隐式依赖，而非直接删除锁文件。

已有锁文件沿用原策略。若 SDK 补丁变化导致 `Microsoft.NET.ILLink.Tasks` 等隐式包版本不匹配，可固定完整 SDK 并在升级时同步刷新锁文件，或按项目可复现性要求调整策略。执行 `dotnet restore --force-evaluate` 后，验证各 profile 的 locked restore/publish。[SDK 隐式依赖与锁文件讨论](https://github.com/dotnet/sdk/issues/48795)

### 发布：四份 pubxml（x64 / arm64 × 自包含 / 框架依赖），csproj 一个发布属性都不放

放 `src/Xxx.App/Properties/PublishProfiles/` 下，文件名就是 `-p:PublishProfile=` 要用的名字。为什么不能放 csproj，见 `pitfalls.md`「测试工程引用 App 就报 NETSDK1151」。

`win-x64.pubxml`（自包含，下载即用）：

```xml
<Project>
  <PropertyGroup>
    <Configuration>Release</Configuration>
    <TargetFramework>net10.0-windows</TargetFramework>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <SelfContained>true</SelfContained>
    <PublishSingleFile>true</PublishSingleFile>
    <IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>
    <EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>
    <DebugType>none</DebugType>
    <PublishDir>bin\Release\publish-x64\</PublishDir>
  </PropertyGroup>
</Project>
```

四份必须各给一个目录，否则连着发布会互相覆盖；CI 打包脚本按这四个路径取文件。

`win-x64-needs-dotnet10.pubxml`（框架依赖，体积小得多）：只把 `SelfContained` 改成 `false`、`PublishDir` 改成 `bin\Release\publish-x64-needs-dotnet10\`，并删除 `EnableCompressionInSingleFile`，该压缩选项要求自包含。`IncludeNativeLibrariesForSelfExtract` 则按实际原生依赖选择：需要嵌入并提取原生 DLL 时可保留；留作外置文件时删除，并随 ZIP 完整打包。框架依赖不等于没有应用自己的原生 DLL。[单文件原生库](https://learn.microsoft.com/dotnet/core/deploying/single-file/overview#native-libraries)

arm64 两份是上面两份的复制，只改两行：

| 文件 | `RuntimeIdentifier` | `SelfContained` | `PublishDir` |
| --- | --- | --- | --- |
| `win-x64.pubxml` | `win-x64` | `true` | `bin\Release\publish-x64\` |
| `win-x64-needs-dotnet10.pubxml` | `win-x64` | `false` | `bin\Release\publish-x64-needs-dotnet10\` |
| `win-arm64.pubxml` | `win-arm64` | `true` | `bin\Release\publish-arm64\` |
| `win-arm64-needs-dotnet10.pubxml` | `win-arm64` | `false` | `bin\Release\publish-arm64-needs-dotnet10\` |

x64 runner 可交叉发布 ARM64，但构建和 PE 架构检查不证明 ARM64 能运行。用可用的 Windows ARM64 runner 或设备验证启动、原生库与更新；缺少环境时明确标为待验证。

P/Invoke 要过一遍：`IntPtr`/`nint` 写法本来就和架构无关，但手写的结构体布局、写死的 `x64` 路径、只带 x64 原生 DLL 的第三方包，到了 arm64 才会暴露。

`PublishDir` 特意写成短路径而不是默认的 `bin\Release\net10.0-windows\win-x64\publish\`，因为发版脚本要按名字取这四个 exe；改了这里记得同步 `github-actions.md` 里的打包步骤。

调整 profile 名称或输出目录时同步修改本地和 CI 打包入口。ZIP 保留资源与原生库，从解包目录运行 smoke。


### 发布包组织：三轨分发矩阵（安装包 + 便携 ZIP + 框架依赖精简版）

推荐发布安装包、自包含便携 ZIP 和框架依赖精简 ZIP，便携与精简包覆盖 x64 和 ARM64。现有包型较少的项目按此矩阵补齐；已经打入 ZIP 的同一份 exe 通常无需再作为独立下载项。

| 渠道 | 产物命名 | 内核形态 | 适用受众与优势 |
| :--- | :--- | :--- | :--- |
| **1. 官方安装包（主力推荐）** | `Xxx-<tag>-setup.exe` | Inno Setup 6 封装自包含 x64 exe | **普通大众首选**：安装无需装 .NET 运行时；自动接管桌面/开始菜单快捷方式；控制面板支持标准干净卸载并清理右键菜单与临时目录；支持 winget 命令行无感静默部署。 |
| **2. 自包含便携包（极客必备）** | `Xxx-<tag>-win-x64.zip`<br>`Xxx-<tag>-win-arm64.zip` | 单文件自包含 exe 打包进 zip | **便携党/移动办公**：U 盘即插即用、解压即跑，不写全局注册表、不进 Program Files，自由存放。 |
| **3. 框架依赖精简包（开发者通道）** | `Xxx-<tag>-win-{x64,arm64}-needs-dotnet10.zip` | 框架依赖单文件 exe 打包进 zip | **高阶/小体积追求者**：在 release 说明中注明「需预装 .NET 10 Desktop Runtime」。 |

#### Inno Setup 6 最佳实践配置要点

写 `.iss` 脚本时有以下配置要点：

1. **免管理员提权（避免黄色 UAC 弹窗）**：
   ```ini
   PrivilegesRequired=lowest
   DefaultDirName={localappdata}\Programs\{#MyAppName}
   ```
   默认按用户安装到 `AppData\Local\Programs`。需要机器级部署时，按项目要求选择受保护目录与提升流程，不把按用户方案套到所有安装器。
2. **支持 winget 静默安装与企业部署**：
   脚本必须兼容 Inno Setup 标准开关 `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-`，供 winget、Chocolatey、Scoop 或企业批量脚本自动化推送。
3. **卸载时干扫尾**：
   仅清理安装器管理的文件、确认可丢弃的缓存和本应用注册的 Shell 关联。用户文件与配置按产品约定保留；旧版升级再卸载也需验证，见 [卸载日志](github-actions.md#修了卸载规则旧版升级后仍会删除用户文件)。
4. **安装包图标绑定与旧指令规避**：
   Inno Setup 6.0+ 起，旧的 `UninstallIconFile` 指令已正式废弃并会触发编译告警。统一在 `[Setup]` 段声明 `SetupIconFile=app.ico`，并在 `[Icons]` 节中为各个快捷方式指定具体图标文件。
5. **安装与卸载界面统一英文**：
   在现有 `.iss` 对应节中合并以下配置，`[Languages]` 仅保留英文：
   ```ini
   [Setup]
   ShowLanguageDialog=no

   [Languages]
   Name: "english"; MessagesFile: "compiler:Default.isl"
   ```
   自定义页面、任务选项、按钮、`[Messages]` / `[CustomMessages]` 和代码弹窗也使用英文，不随系统或应用语言切换。生成安装包后，在中文 Windows 上检查安装及卸载向导均为英文。[Inno Setup 语言配置](https://jrsoftware.org/ishelp/topic_languagessection.htm)

CI 记录实际调用的 ISCC.exe 路径，从编译横幅核对 6.x。runner 预装的是其他大版本时，安装本技能指定的 6.x 稳定编译器再生成安装包。[Inno Setup 编译器参数](https://jrsoftware.org/ishelp/topic_compilercmdline.htm)

### 应用原生图标

在 App 的 csproj 设置 `<ApplicationIcon>Resources\app.ico</ApplicationIcon>`；XAML 的窗口 Icon 不会替代 EXE 的 PE 图标。编译后检查发布 exe、安装快捷方式及 Shell 条目的实际图标来源。故障机制见 [白纸图标](pitfalls.md#右键菜单和外壳扩展项显示-windows-默认白纸图标)。
