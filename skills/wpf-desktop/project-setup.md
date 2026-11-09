# WPF 项目起手：装什么、建什么、怎么发布

本技能的 WPF 目标是 .NET 10。新建和升级时按[依赖升级](upgrade-dependencies.md)取得 10.0 通道的最新稳定 SDK，并安装可用于该框架的依赖。

这页只管起手选型和发布配置；撞过的坑在 `pitfalls.md`，验证工具在 `dev-switches.md`，CI 与发版流水线在 `github-actions.md`。

## 第一个项目装什么

下表用于选择组件。.NET 10 是目标大版本，示例中的具体 SDK 和 NuGet 补丁号在执行时重新解析。

| 位置       | 选它                                          | 什么时候才该换                                                        |
| ---------- | --------------------------------------------- | --------------------------------------------------------------------- |
| 目标框架 | `net10.0-windows` | 新建与升级统一对齐 .NET 10，保留实际需要的 Windows 最低版本。 |
| SDK 版本 | global.json 记录完整 SDK 版本及 rollForward 策略 | 构建环境安装并验证目标稳定 SDK。项目需兼容较低开发 SDK 时，在 CI 单独安装目标补丁。 |
| 依赖锁     | 不开 `packages.lock.json`；`PackageReference` 写精确版本，net10 起 NuGetAudit 默认连传递依赖一起查漏洞 | 团队能把 SDK 锁死到补丁级（`rollForward: disable`）时才开，原因见下文「NuGet 锁文件：单文件发布先别开」 |
| 开发环境   | VS 2026 Community 加「.NET 桌面开发」工作负载 | 手里已经有 Rider 就用 Rider。面向 net10.0 的 IDE 至少需要 VS 18.0，见下文的 SDK 对应表 |
| 编辑器扩展 | 一个都不装                                    | 语言数超过五六种时装 ResXManager                                      |
| MVVM       | `CommunityToolkit.Mvvm`                       | 窗口少、状态简单的小工具，直接 code-behind 也成立                     |
| 托盘图标   | `H.NotifyIcon.Wpf`                            | 工程本来就开了 `UseWindowsForms` 时，用内建的 NotifyIcon              |
| 界面主题   | WPF 自带的 Fluent 主题（`ThemeMode`，.NET 9 起）叠一份自己的 `Theme.xaml`：语义 token 加未覆盖控件的模板 | 官方自述自带 Fluent 样式仍未做完；要 Win11 原生标题栏壳子（Mica / `NavigationView`）才引 `WPF-UI`      |
| 配置文件   | 运行时自带的 `System.Text.Json`               | 不换                                                                  |
| 日志       | 自己往文件里追加一行                          | 需要多个输出目标或结构化查询时上 Serilog                              |
| 依赖注入   | 不用                                          | 服务多到互相依赖、构造顺序开始绕时再上                                |
| Win32 调用 | 手写 `DllImport`                              | P/Invoke 攒到十几个时上 `Microsoft.Windows.CsWin32`                   |
| 测试       | `xunit.v3` 加它自带的 `Assert`                | 不换。别引 FluentAssertions，它从 8.0 起商用收费                      |
| 多语言     | resx 加一个几十行的索引器包装                 | 不换。WPF 专属的 x:Uid + LocBaml 路线，[官方自己标注](https://learn.microsoft.com/dotnet/desktop/wpf/advanced/how-to-localize-an-application)是「非生产就绪的示例工具」 |
| 发布       | pubxml 里自包含和框架依赖各一份单文件，`win-x64` 与 `win-arm64` 各一套，共四份 | 不换。arm64 不发的话，ARM 笔记本上跑的是 x64 模拟 |
| 自动更新   | 启动后（或设置页里）查一次 GitHub `releases/latest`，比本地版本新就提示并打开 Release 页；零依赖，几十行 | 真需要静默下载替换时上 `Velopack`。`releases/latest` 不含草稿和预发布，所以发版流程必须真的把它切到新 tag（`github-actions.md` 的 publish job 会断言） |
| 代码签名   | 有资格就签：[Azure Artifact Signing](https://azure.microsoft.com/products/artifact-signing)（前身 Trusted Signing），`github-actions.md` 里的签名步骤配好仓库变量就生效。签名前按服务当前的身份、地区与证书配置要求核对发布者资格。 | 没资格就不签：变量留空，签名步骤自动跳过；release 说明里提前写明 SmartScreen 会提示「未知发布者」，并给 SHA256 + attestation 让人能验（`github-actions.md`） |

表里不少格子是「不装」「不用」「不做」。实测下来，一个应用工程可以做到零第三方运行时依赖，功能一点没少，所以默认值就该是空的。

### 开发环境：勾一个工作负载，扩展一个不装

装 Visual Studio 2026 Community，在安装器里勾「.NET 桌面开发」，结束。SDK、XAML 设计器、XAML 热重载、Live Visual Tree 全在这个工作负载里。

**版本别将就 VS 2022**：.NET 的 SDK 特性 band 与 VS 大版本一一对应。官方表里 VS 17.14 能装 10.0.1xx SDK，但它能 target 的最高框架是 net9.0；target net10.0 的官方最低版本是 MSBuild / VS **18.0**（即 VS 2026，见[官方版本对应表](https://learn.microsoft.com/dotnet/core/porting/versioning-sdk-msbuild-vs)）。命令行装个 .NET 10 SDK 能编，但 IDE 侧不受支持。

扩展一个都别装。XAML 格式化、界面树查看这些事工作负载已经覆盖，多装一个就多一层出问题时要排除的变量。唯一的例外是 ResXManager，等语言数量多到没法肉眼比对 resx 时再说。

已经在用 Rider 的直接用 Rider，开箱支持 WPF 和 XAML。VS Code 也能写能编译能断点，但没有 XAML 可视化设计器，第一个 WPF 项目不建议从它开始。

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

那个参数不能省：[官方签名](https://github.com/HavenDV/H.NotifyIcon)是 `ForceCreate(bool enablesEfficiencyMode = true)`，裸调用会顺手把进程标成 Windows 效率模式（EcoQoS 降频）——托盘工具常驻后台但靠热键抢响应，被降频不是你想要的。

H.NotifyIcon 把 shell 图标的创建挂在 `Loaded` 上，而 `App.xaml` 资源里的 `TaskbarIcon` 从不进可视树、这个事件一辈子不触发。Hardcodet 是在构造函数里就创建的，所以「写进资源字典」这个写法在旧库时代不需要额外动作——**换库的人最容易在这里翻车**，症状是应用照常跑、热键照常用，就是托盘里什么都没有。

顺带：这个失败模式 `--smoke` 默认抓不到，因为那两个开关按惯例挂在托盘初始化之前就 `return` 了。值得在 smoke 里补一句断言（取出资源、`ForceCreate()`、判 `IsCreated`、`Dispose()`）——顺便也覆盖了 `IconSource` 那个 pack URI 哪天解析不到的情况。写完记得反向验证一次：临时删掉 `ForceCreate()`，smoke 必须失败，否则这条断言是空跑的。

工程已经因为剪贴板、`SendKeys` 之类开了 `UseWindowsForms`，就用系统自带的 `NotifyIcon`，第三方包一个不装——长菜单加自绘配色（`ToolStripProfessionalRenderer`）也撑得住。代价是菜单样式和 WPF 那套完全分家、文案要手写同步，还会撞上 `pitfalls.md`「副屏上窗口位置算错」里说的 `WFO0003` 分析器警告。

**但「为了剪贴板才拖进 WinForms」这条前提在 net10 上弱了不少**：.NET 10 起 WPF 与 Windows Forms 用同一套剪贴板 API（官方把两边统一了），同时废弃了依赖 `BinaryFormatter` 的那几个方法、并在补走 JSON 序列化的替代方法。新项目直接用 WPF 的 `Clipboard` 就够了，不必为此开 `UseWindowsForms`；为了托盘而回炉已有工程也不划算——这条只在「WinForms 已经因为别的原因在里面」时成立。

### MVVM：`CommunityToolkit.Mvvm`，或者干脆 code-behind

WPF 自带的 `INotifyPropertyChanged` 要手写一堆 `OnPropertyChanged(nameof(X))`，`ICommand` 还得自己实现一个类。`CommunityToolkit.Mvvm` 是微软官方维护的 MVVM 工具包，用源生成器把这两件事收成属性上的一个特性——只做 MVVM、不走反射，单文件发布不会出意外：

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

### 界面主题：先别引控件库

小工具的界面元素来来去去就是按钮、输入框、列表、复选框，八到十个控件。建一份 `Theme.xaml` 放语义化的 brush token（`Brush.Surface`、`Brush.TextPrimary`、`Brush.Accent` 这类命名）加这几个控件的 `ControlTemplate`；要深浅两套主题时，把浅色做成一份只含覆盖键的小字典，运行时换字典。token 一律走 `DynamicResource` 引用——`StaticResource` 在 XAML 加载时解析一次、之后不再求值，运行时换字典它不跟；`DynamicResource` 每次用到时现查，换主题才换得动（这是[官方文档](https://learn.microsoft.com/dotnet/desktop/wpf/systems/xaml-resources-overview)写明的两者语义差别）。前期花一两天，之后每次改设计都只是改 token，不会因为库升级导致样式漂移。

**先试运行时自带的 Fluent 主题，再决定要不要动手做深浅两套。** WPF 从 .NET 9 起自带 Fluent 主题（Windows 11 观感，含明暗两套与系统强调色），两条启用路径：在 `Application` 或单个 `Window` 上设 `ThemeMode`（`Light` / `Dark` / `System`，默认 `None`），或把资源字典 `pack://application:,,,/PresentationFramework.Fluent;component/Themes/Fluent.xaml` 合进 `App.xaml`（也可以只合到某个窗口）。官方在 .NET 10 的说明里仍写着「Fluent UI style support is still in progress」，但那一版把可主题化的控件补齐了不少（DatePicker、GridSplitter、GridView、GroupBox、Hyperlink、Label、NavigationWindow、RichTextBox、TextBox），修了 Expander 的动画、HighContrast 相关的崩溃，并修好 `MenuItem` / `Expander` / `TreeViewItem` 的**从右到左布局**——阿拉伯语界面要靠这三句才不歪，所以「目标框架不低于 net10」对多语言项目是有具体依据的。自带主题没覆盖的部分继续用你自己的 token 与模板补：上层的 `DynamicResource` 那套语义 brush 照常成立，只是不再需要连按钮的基础样式都自己画。

引控件库反而是负债，库的设计意见会和你自己的视觉方向一直打架，最后花在拆掉它默认动效上的时间比自己写模板还多。

值得引库的情况只剩一种：你要的是 Win11 的**窗口壳子**本身——`FluentWindow`（`ExtendsContentIntoTitleBar` 自绘标题栏、可选 Mica 背板）和 `NavigationView`。深浅色不再是引它的理由：自带的 `ThemeMode="System"` 就做了，一个界面里不要同时留两套主题开关（`ApplicationThemeManager` 只在借壳之后才需要讨论）。配色可以覆盖它的画刷资源，也可以只借壳、内容继续走自己的 token——买壳不必连整套设计语言一起买。

要在应用里放带行号和语法高亮的编辑框，用 `AvalonEdit`，WPF 原生控件，不是套壳 WebView。它不带 YAML、INI、Shell 的高亮定义，得自己写 `.xshd` 并作为 `EmbeddedResource` 打进程序集，否则单文件发布之后加载不到。

### 工程分三个，测试只测 Core

```
src/Xxx.App/          net10.0-windows, UseWPF   只放窗口和交互
src/Xxx.Core/         net10.0                   业务逻辑
tests/Xxx.Core.Tests/ net10.0, OutputType=Exe   xunit.v3
```

`src/` 和 `tests/` 这两层不是洁癖，`github-actions.md` 里的每一条路径都按这个约定写；换成扁平布局记得同步改 CI。

App 工程的 csproj 最少要有这些（其余留空，别把发布属性写进来）：

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

上面几行容易忘的原因，写在这里而不是 csproj 注释里——代码块里的注释对读文档的人是隐形的，ClawHub 的安全扫描也正是把这类注释判成「隐藏指令」：

- `AssemblyName` 决定产物叫 `Xxx.exe` 而不是 `Xxx.App.exe`：默认取工程名，不设这行发版脚本里的文件名全对不上。
- `VersionFallback` 是那个 target 的 Condition 判据，必须定义，否则 target 永不触发；真正的版本从 git tag 取，见 pitfalls.md「版本号发出去还是上一版」。
- 这里故意没有 `RuntimeIdentifier(s)`、`SelfContained`、`PublishSingleFile`（全在 pubxml），也没有 `RestorePackagesWithLockFile`（见下文「NuGet 锁文件：单文件发布先别开」）。

Core 的目标框架能不带 `-windows` 就不带，判断标准是里面有没有出现 `System.Windows` 开头的类型。纯 `net10.0` 的 Core，几百个测试能在一秒出头跑完。热键这类场景用 `uint` 虚拟键码表示就不用碰 `System.Windows.Input.Key`，Core 就能保持纯净——Win32 P/Invoke 本身不需要 `-windows`。

更小的工具可以压成两个工程：Core 做成 app 工程里的一个文件夹，测试工程直接引用 app 工程、配合 `InternalsVisibleTo` 测 internal。代价是测试工程也得跟着 `net10.0-windows` 加 `UseWPF`（好处是测试里能构造真窗口）。

测试工程用 `dotnet new install xunit.v3.templates` 之后的 `xunit3` 模板建，`dotnet new xunit` 给的还是 v2。包名和版本号在这里是分开的两件事：包一直叫 `xunit.v3`，而它的版本号已经走到 4.x（2026-08 发布的 4.0.0），别看到 4 就以为装错了包、回头去找不存在的 `xunit.v4`。v3 的测试程序集是自执行的 exe，跑在 Microsoft Testing Platform 上，`Microsoft.NET.Test.Sdk`、`xunit.runner.visualstudio`、`coverlet.collector` 全都不需要，四个包变一个。断言用它自带的 `Assert`，别引 [FluentAssertions](https://www.nuget.org/packages/FluentAssertions)，那个库从 8.0 起换成了商用收费许可证（NuGet 页的 License 一栏可核）。

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

#### 下限的作用，以及它锁住什么

**下限 = 「低于这个版本不许用」，同时 `rollForward` 允许往上走。** 两者是一对：`latestFeature` 在本机已装的 SDK 里挑**符合作用域的最高版本**，而作用域由下限决定。所以「下限写 402 + 允许升级」的实际含义是：

| 本机装了什么 | 下限 `10.0.402` + `latestFeature` 解析到 |
| --- | --- |
| 10.0.402 与 10.0.303 都装了 | 10.0.402（挑最高的） |
| 只装了 10.0.303 | **解析失败**：找不到满足下限的 SDK，`dotnet` 直接报错退出 |
| 将来装了 10.0.5xx | 10.0.5xx（往上升级，自动） |

**所以「允许升级」不等于「下限没有代价」。** 下限定高了，只装着旧 feature band 的机器就**整个构建跑不起来**（实测：隔离出一个只含 10.0.303 的 root，下限 402 时 `dotnet --version` 直接失败并说清原因——

```
A compatible .NET SDK was not found.
Requested SDK version: 10.0.402
Install the [10.0.402] .NET SDK or update ...\global.json to match an installed SDK.
```

——同一台机器上下限改成 GA 基线 10.0.100 就正常解析到 10.0.303）。

**因此下限该写哪个版本，取决于一件具体的事：你要不要兼容只装着旧 SDK 的机器。**

- **只管自己和 CI**（单人/小团队，CI 按指定版本安装 SDK）：下限写当前补丁号最省事——CI 可以安装该下限，本机也需要满足它。
- **要兼容别人的机器**（有贡献者、或者你的用户会自己 build）：下限写**该大版本的 GA 基线**（`10.0.100`），补丁自己往上走，GA 基线一次写完不用再改。查法：release-metadata 里 `10.0.100` 就是 10.0 这条线上第一个 GA SDK（preview/rc 另编号）。

**别把「下限」和「你要的能力」搞混。** 下限抬高到某个 feature band 之上，等于宣布「低于它的机器一律不支持」——这是有意的门槛，不是 bug；选它的时候知道自己在排除谁就行。

**但下限不能低于你依赖的能力最早出现的 SDK，否则会静默降级。** 具体例子：**MTP 的 `dotnet test` 模式是靠 `global.json` 的 `"test": {"runner": "Microsoft.Testing.Platform"}` 段选中的**——这段在 10.0.100（GA 基线）上就工作，所以下限写 GA 基线不影响它。** 真正的坑是**去掉那一段**：那不是「回到旧行为」，而是让 SDK 换一套 runner 跑，MTP 专有的命令行开关立刻报错。实测（装了三个 SDK 实跑，不是查文档）：

| SDK | 带 `"test"` 段 | 不带 |
| --- | --- | --- |
| 10.0.100 | MTP 模式，测试全过 | 退回 VSTest，`MSB1001`（`--minimum-expected-tests` 被当成未知开关） |
| 10.0.303 | MTP 模式，测试全过 | 同上 |
| 10.0.402 | MTP 模式，测试全过 | 同上 |

测试照样「跑过」，但 CI 上那个 `--minimum-expected-tests` 守卫直接失效——所以这一段本身是要保住的，别因为「看着多余」删掉。

**查某个 feature band 有没有某项能力，别读 SDK 源码猜**（相关文件在几个版本间搬过家，`TestCommandDefinition.cs` 就在 10.0.2xx→10.0.3xx 之间挪了位置）。装出来真跑一次，再用**负例对照**：

```bash
# 装一个指定版本到临时目录
dotnet-install.ps1 -Version 10.0.100 -InstallDir <临时目录> -NoPath
# 在那个 root 里跑你的命令；再把 global.json 里相关的那段去掉跑一次，
# 两次行为不同 = 那段确实在起作用（行为相同 = 那段没被读，或两边都没生效）
```

### NuGet 锁文件：单文件发布先别开

`packages.lock.json` + `--locked-mode` 和单文件发布 + `rollForward: latestFeature` 合不来。实测（SDK 10.0.402，四份 pubxml）：

1. 普通 `dotnet restore` 生成的锁文件，拿去 locked-mode `dotnet publish` → `NU1004`。`PublishSingleFile` 会打开单文件分析器，SDK 因此隐式引用 `Microsoft.NET.ILLink.Tasks`，锁文件里没有它。
2. 在 csproj 里常开 `EnableSingleFileAnalyzer`，四份 profile 都能 locked-mode 发布了；但换到 SDK 10.0.401 再还原 → `NU1004 … ILLink.Tasks version has changed from [10.0.13, ) to [10.0.12, )`。这个包的版本跟着 SDK 补丁走，**每个补丁日锁文件都会失配**。

.NET SDK 团队在 [dotnet/sdk#48795](https://github.com/dotnet/sdk/issues/48795) 给的现行答复是：用锁文件就把 SDK 也锁死（`rollForward: disable`），整条工具链同步升级。这和上一节「本机可选已安装的补丁」正好相反。

本例的新项目使用明确的 PackageReference 版本。新建或升级时实际更新并还原，按[升级流程](upgrade-dependencies.md)复核过期包和传递依赖的安全公告。已有锁文件的项目按原策略刷新并验证。

真要开：csproj 加 `RestorePackagesWithLockFile` 和 `EnableSingleFileAnalyzer`，`global.json` 改 `rollForward: disable`，每次升 SDK 都跑 `dotnet restore --force-evaluate` 并提交锁文件。少一条，就会在某个补丁日红掉。

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

`win-x64-needs-dotnet10.pubxml`（框架依赖，体积小得多）：只把 `SelfContained` 改成 `false`、`PublishDir` 改成 `bin\Release\publish-x64-needs-dotnet10\`，并**删掉** `EnableCompressionInSingleFile` 和 `IncludeNativeLibrariesForSelfExtract` 这两行——前者传给框架依赖会以 `NETSDK1176` 直接失败，后者在这个 bundle 里没有原生库可打包、不报错所以能一直躺着误导人。

arm64 两份是上面两份的复制，只改两行：

| 文件 | `RuntimeIdentifier` | `SelfContained` | `PublishDir` |
| --- | --- | --- | --- |
| `win-x64.pubxml` | `win-x64` | `true` | `bin\Release\publish-x64\` |
| `win-x64-needs-dotnet10.pubxml` | `win-x64` | `false` | `bin\Release\publish-x64-needs-dotnet10\` |
| `win-arm64.pubxml` | `win-arm64` | `true` | `bin\Release\publish-arm64\` |
| `win-arm64-needs-dotnet10.pubxml` | `win-arm64` | `false` | `bin\Release\publish-arm64-needs-dotnet10\` |

WPF 支持 Windows on Arm；x64 runner 上就能交叉发布 arm64，不需要 arm 机器（本页四份 profile 实测在同一台 x64 机器上连着发布成功）。**但 x64 runner 跑不了 arm64 的 `--smoke`**，arm64 包只验证了「编得出来」。GitHub 托管的 `windows-11-arm` runner 可以补上这一步（哪些仓库能用以 GitHub 文档现行说法为准）；用不了就在一台 ARM 真机上手动开一次再发。

P/Invoke 要过一遍：`IntPtr`/`nint` 写法本来就和架构无关，但手写的结构体布局、写死的 `x64` 路径、只带 x64 原生 DLL 的第三方包，到了 arm64 才会暴露。

`PublishDir` 特意写成短路径而不是默认的 `bin\Release\net10.0-windows\win-x64\publish\`，因为发版脚本要按名字取这四个 exe；改了这里记得同步 `github-actions.md` 里的打包步骤。

从 1.0.x 模板升上来的项目：旧的两份叫 `publish\` 和 `publish-needs-dotnet10\`，改名后 CI 的打包路径要一起改，否则打包那步找不到文件（Actions 的 `pwsh` 默认 `$ErrorActionPreference = 'stop'`，`Compress-Archive` 找不到文件会让这步直接红，不会静默少一个资产）。


### 发布包组织：三轨分发矩阵（安装包 + 便携 ZIP + 框架依赖精简版）

只发裸 exe 或只发 zip，用户体验各缺一半：小白用户找不到桌面图标、卸载不会清注册表；极客用户嫌弃安装包污染环境。推荐采用「多层兼顾、分级供给」的三轨分发模式（三个渠道）：

| 渠道 | 产物命名 | 内核形态 | 适用受众与优势 |
| :--- | :--- | :--- | :--- |
| **1. 官方安装包（主力推荐）** | `Xxx-<tag>-setup.exe` | Inno Setup 6 封装自包含 x64 exe | **普通大众首选**：安装无需装 .NET 运行时；自动接管桌面/开始菜单快捷方式；控制面板支持标准干净卸载并清理右键菜单与临时目录；支持 winget 命令行无感静默部署。 |
| **2. 自包含便携包（极客必备）** | `Xxx-<tag>-win-x64.zip`<br>`Xxx-<tag>-win-arm64.zip` | 单文件自包含 exe 打包进 zip | **便携党/移动办公**：U 盘即插即用、解压即跑，不写全局注册表、不进 Program Files，自由存放。 |
| **3. 框架依赖精简包（开发者通道）** | `Xxx-<tag>-win-{x64,arm64}-needs-dotnet10.zip` | 框架依赖单文件 exe 打包进 zip | **高阶/小体积追求者**：在 release 说明中注明「需预装 .NET 10 Desktop Runtime」。 |

#### Inno Setup 6 最佳实践配置要点

写 `.iss` 脚本时有四处关键承重设计（可直接参考成熟桌面项目配置）：

1. **免管理员提权（避免黄色 UAC 弹窗）**：
   ```ini
   PrivilegesRequired=lowest
   DefaultDirName={localappdata}\Programs\{#MyAppName}
   ```
   安装到用户的 `AppData\Local\Programs`，普通标准用户权限即可快速安装，绝不向用户索要管理员密码。
2. **支持 winget 静默安装与企业部署**：
   脚本必须兼容 Inno Setup 标准开关 `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-`，供 winget、Chocolatey、Scoop 或企业批量脚本自动化推送。
3. **卸载时干扫尾**：
   在 `[UninstallDelete]` 或 `[Code]` 卸载阶段，显式清除非用户数据目录（如 `%LOCALAPPDATA%\Xxx\export` 拖拽临时物化目录、无用临时缓存），并注销外壳右键关联，不在系统留下残留垃圾。
4. **安装包图标绑定与旧指令规避**：
   Inno Setup 6.0+ 起，旧的 `UninstallIconFile` 指令已正式废弃并会触发编译告警。统一在 `[Setup]` 段声明 `SetupIconFile=app.ico`，并在 `[Icons]` 节中为各个快捷方式指定具体图标文件。

CI 记录实际调用的 ISCC.exe 路径，从编译横幅核对 6.x。runner 预装的是其他大版本时，安装本技能指定的 6.x 稳定编译器再生成安装包。[Inno Setup 编译器参数](https://jrsoftware.org/ishelp/topic_compilercmdline.htm)

### 应用原生图标（PE 标头）：右键菜单与 Shell 集成不显白纸的底线

即使在各窗口 XAML 里声明了 `Icon="pack://application:,,,/Resources/app.ico"`，若 `.csproj` 漏掉了 `<ApplicationIcon>`，生成的 EXE PE 头部就不会写入 `RT_GROUP_ICON` 原生资源表（ID 1）。

Windows 资源管理器读取右键菜单注册表命令（如 `Xxx.exe,0`）、发送到菜单（SendTo）或未固定到任务栏的外部进程时，**只认 PE 头部的原生 Windows 资源**。缺失时会统一回退显示 Windows 默认白纸图标。

在主 App 的 `.csproj` 的主 `<PropertyGroup>` 里必须显式配置：

```xml
<PropertyGroup>
  <ApplicationIcon>Resources\app.ico</ApplicationIcon>
</PropertyGroup>
```

编译后直接检查发布目录中的 exe 和实际安装的快捷方式。若 Shell 条目显式指定了另一个图标路径，还需对照注册项与快捷方式设置。
