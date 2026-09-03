# WPF 项目起手：装什么、建什么、怎么发布

每个位置只给一个选择并说明依据。版本号会漂移，用前先按 SKILL.md 的 "Three iron rules" 第一条核对。

这页只管起手选型和发布配置；撞过的坑在 `pitfalls.md`，验证工具在 `dev-switches.md`，CI 与发版流水线在 `github-actions.md`。

## 第一个项目装什么

第一次做 WPF 最容易卡住的地方，是每个位置都有五六个候选，光比较就耗掉一周。下面这张表可以直接照抄。

| 位置       | 选它                                          | 什么时候才该换                                                        |
| ---------- | --------------------------------------------- | --------------------------------------------------------------------- |
| 目标框架   | `net10.0-windows`                             | 不换。.NET 8 和 9 同在 2026-11-10 到期，10 是 LTS，管到 2028-11（[支持策略](https://dotnet.microsoft.com/platform/support/policy/dotnet-core)） |
| 开发环境   | VS 2026 Community 加「.NET 桌面开发」工作负载 | 手里已经有 Rider 就用 Rider。**别用 VS 2022**：它没有 .NET 10 的 SDK band |
| 编辑器扩展 | 一个都不装                                    | 语言数超过五六种时装 ResXManager                                      |
| MVVM       | `CommunityToolkit.Mvvm`                       | 窗口少、状态简单的小工具，直接 code-behind 也成立                     |
| 托盘图标   | `H.NotifyIcon.Wpf`                            | 工程本来就开了 `UseWindowsForms` 时，用内建的 NotifyIcon              |
| 界面主题   | 自己写一份 `Theme.xaml`：语义 token 加控件模板 | 想要 Win11 的原生标题栏壳子，引 `WPF-UI`                              |
| 配置文件   | 运行时自带的 `System.Text.Json`               | 不换                                                                  |
| 日志       | 自己往文件里追加一行                          | 需要多个输出目标或结构化查询时上 Serilog                              |
| 依赖注入   | 不用                                          | 服务多到互相依赖、构造顺序开始绕时再上                                |
| Win32 调用 | 手写 `DllImport`                              | P/Invoke 攒到十几个时上 `Microsoft.Windows.CsWin32`                   |
| 测试       | `xunit.v3` 加它自带的 `Assert`                | 不换。别引 FluentAssertions，它从 8.0 起商用收费                      |
| 多语言     | resx 加一个几十行的索引器包装                 | 不换。WPF 专属的 x:Uid + LocBaml 路线，[官方自己标注](https://learn.microsoft.com/dotnet/desktop/wpf/advanced/how-to-localize-an-application)是「非生产就绪的示例工具」 |
| 发布       | pubxml 里的自包含和框架依赖各一份单文件       | 不换                                                                  |
| 自动更新   | 不做，让用户去 Release 页下载                 | 真需要静默更新时上 `Velopack`                                         |
| 代码签名   | 不签——CI 里附 SHA256 并提交 winget（`github-actions.md`） | 组织在美国、加拿大、欧盟、英国、澳大利亚、新西兰、日本、韩国、新加坡、瑞士、挪威、以色列，个人仅限美国/加拿大，可开 [Azure Artifact Signing](https://azure.microsoft.com/products/artifact-signing)（前身 Trusted Signing；名单会变，以官网现行说法为准） |

表里不少格子是「不装」「不用」「不做」。实测下来，一个应用工程可以做到零第三方运行时依赖，功能一点没少，所以默认值就该是空的。

### 开发环境：勾一个工作负载，扩展一个不装

装 Visual Studio 2026 Community，在安装器里勾「.NET 桌面开发」，结束。SDK、XAML 设计器、XAML 热重载、Live Visual Tree 全在这个工作负载里。

**版本别将就 VS 2022**：.NET 的 SDK 特性band 与 VS 大版本一一对应，net10.0 要求 MSBuild / VS **18.0**（即 VS 2026），17.x 里没有任何一条 band 映射到 .NET 10（[官方版本对应表](https://learn.microsoft.com/dotnet/core/porting/versioning-sdk-msbuild-vs)）。命令行装个 .NET 10 SDK 能编，但 IDE 侧不受支持。

扩展一个都别装。XAML 格式化、界面树查看这些事工作负载已经覆盖，多装一个就多一层出问题时要排除的变量。唯一的例外是 ResXManager，等语言数量多到没法肉眼比对 resx 时再说。

已经在用 Rider 的直接用 Rider，开箱支持 WPF 和 XAML。VS Code 也能写能编译能断点，但没有 XAML 可视化设计器，第一个 WPF 项目不建议从它开始。

### 托盘图标：看工程里有没有 WinForms

分界线不是菜单长短，是工程有没有已经拖进 WinForms。

纯 WPF 工程用 [`H.NotifyIcon.Wpf`](https://www.nuget.org/packages/H.NotifyIcon.Wpf)：它是 [`Hardcodet.NotifyIcon.Wpf`](https://www.nuget.org/packages/Hardcodet.NotifyIcon.Wpf) 的维护继任（同一个控件、API 同源），持续更新并明确列出 net10.0-windows 支持，而 Hardcodet 停在 2024-10——2.0.1 在 net10 下仍能跑，但别给新项目选停更的包（两页 NuGet 的更新日期一眼可核）。托盘和菜单写在 `App.xaml` 的资源里（一个 `TaskbarIcon`，启动时 `FindResource` 取出），和应用其余部分同一套样式。菜单文案要跟语言切时，在语言切换事件里统一刷新各 `MenuItem.Header`，比给每一项拉绑定省事。

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

引控件库反而是负债，库的设计意见会和你自己的视觉方向一直打架，最后花在拆掉它默认动效上的时间比自己写模板还多。

值得引库的情况只有一种：你要的就是 Win11 那套原生壳子。这时候用 `WPF-UI`，图它的 `FluentWindow`（`ExtendsContentIntoTitleBar` 自定义标题栏，可选 Mica 背景）、`NavigationView` 和跟随系统深浅色的 `ApplicationThemeManager`。配色可以覆盖它的画刷资源，也可以只借壳、内容继续走自己的 token——买壳不必连整套设计语言一起买。

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
    <!-- 产物叫 Xxx.exe 而不是 Xxx.App.exe：默认取工程名，不设这行发版脚本里的文件名全对不上 -->
    <AssemblyName>Xxx</AssemblyName>
    <ApplicationManifest>app.manifest</ApplicationManifest>
    <!-- 从 git tag 取版本，见 pitfalls.md「版本号发出去还是上一版」；
         这个兜底值是那个 target 的 Condition 判据，必须定义，否则 target 永不触发 -->
    <VersionFallback>0.0.1</VersionFallback>
    <Version>$(VersionFallback)</Version>
  </PropertyGroup>
</Project>
```

Core 的目标框架能不带 `-windows` 就不带，判断标准是里面有没有出现 `System.Windows` 开头的类型。纯 `net10.0` 的 Core，几百个测试能在一秒出头跑完。热键这类场景用 `uint` 虚拟键码表示就不用碰 `System.Windows.Input.Key`，Core 就能保持纯净——Win32 P/Invoke 本身不需要 `-windows`。

更小的工具可以压成两个工程：Core 做成 app 工程里的一个文件夹，测试工程直接引用 app 工程、配合 `InternalsVisibleTo` 测 internal。代价是测试工程也得跟着 `net10.0-windows` 加 `UseWPF`（好处是测试里能构造真窗口）。

测试工程用 `dotnet new install xunit.v3.templates` 之后的 `xunit3` 模板建，`dotnet new xunit` 给的还是 v2。包名和版本号在这里是分开的两件事：包一直叫 `xunit.v3`，而它的版本号已经走到 4.x（2026-08 发布的 4.0.0），别看到 4 就以为装错了包、回头去找不存在的 `xunit.v4`。v3 的测试程序集是自执行的 exe，跑在 Microsoft Testing Platform 上，`Microsoft.NET.Test.Sdk`、`xunit.runner.visualstudio`、`coverlet.collector` 全都不需要，四个包变一个。断言用它自带的 `Assert`，别引 [FluentAssertions](https://www.nuget.org/packages/FluentAssertions)，那个库从 8.0 起换成了商用收费许可证（NuGet 页的 License 一栏可核）。

MTP 顺带给了一个实用参数：

```bash
dotnet test tests/Xxx.Core.Tests -c Release -- --minimum-expected-tests 1
```

适配器没加载好的时候，`dotnet test` 会一个用例不跑却退出 0，CI 显示绿色，这个参数就是防它的。

### 发布：两份 pubxml，csproj 一个发布属性都不放

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
    <!-- 两份必须给不同目录，否则连着发布会互相覆盖；CI 打包脚本按这两个路径取文件 -->
    <PublishDir>bin\Release\publish\</PublishDir>
  </PropertyGroup>
</Project>
```

`win-x64-needs-dotnet10.pubxml`（框架依赖，体积小得多）：只把 `SelfContained` 改成 `false`、`PublishDir` 改成 `bin\Release\publish-needs-dotnet10\`，并**删掉** `EnableCompressionInSingleFile` 和 `IncludeNativeLibrariesForSelfExtract` 这两行——前者传给框架依赖会以 `NETSDK1176` 直接失败，后者在这个 bundle 里没有原生库可打包、不报错所以能一直躺着误导人。

`PublishDir` 特意写成短路径而不是默认的 `bin\Release\net10.0-windows\win-x64\publish\`，因为发版脚本要按名字取这两个 exe；改了这里记得同步 `github-actions.md` 里的打包步骤。
