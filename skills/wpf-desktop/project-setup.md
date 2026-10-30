# WPF 项目起手：装什么、建什么、怎么发布

每个位置只给一个选择并说明依据。版本号会漂移，用前先按 SKILL.md 的 "Three iron rules" 第一条核对。

这页只管起手选型和发布配置；撞过的坑在 `pitfalls.md`，验证工具在 `dev-switches.md`，CI 与发版流水线在 `github-actions.md`。.NET 版本还在不在支持期，不靠记忆也不靠这页的日期，用 SKILL.md 铁律一里那行 `releases.json` 查。

## 第一个项目装什么

第一次做 WPF 最容易卡住的地方，是每个位置都有五六个候选，光比较就耗掉一周。下面这张表可以直接照抄。

| 位置       | 选它                                          | 什么时候才该换                                                        |
| ---------- | --------------------------------------------- | --------------------------------------------------------------------- |
| 目标框架   | `net10.0-windows`                             | 不换。.NET 8 和 9 同在 2026-11-10 到期，10 是 LTS，管到 2028-11（[支持策略](https://dotnet.microsoft.com/platform/support/policy/dotnet-core)）。下一次换是跟着下一个 LTS |
| SDK 版本   | `global.json` 写完整 SDK 版本 + `rollForward: latestFeature` | 不换。本地和 CI 读同一份（CI 用 `setup-dotnet` 的 `global-json-file`）；本地补丁靠 `latestFeature` 自动到手，CI 是否执行 `rollForward` 取决于 action 版本，定期抬下限或显式安装 |
| 依赖锁     | 不开 `packages.lock.json`；`PackageReference` 写精确版本，net10 起 NuGetAudit 默认连传递依赖一起查漏洞 | 团队能把 SDK 锁死到补丁级（`rollForward: disable`）时才开，原因见下文「NuGet 锁文件：单文件发布先别开」 |
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
| 发布       | pubxml 里自包含和框架依赖各一份单文件，`win-x64` 与 `win-arm64` 各一套，共四份 | 不换。arm64 不发的话，ARM 笔记本上跑的是 x64 模拟 |
| 自动更新   | 启动后（或设置页里）查一次 GitHub `releases/latest`，比本地版本新就提示并打开 Release 页；零依赖，几十行 | 真需要静默下载替换时上 `Velopack`。`releases/latest` 不含草稿和预发布，所以发版流程必须真的把它切到新 tag（`github-actions.md` 的 publish job 会断言） |
| 代码签名   | 有资格就签：[Azure Artifact Signing](https://azure.microsoft.com/products/artifact-signing)（前身 Trusted Signing），`github-actions.md` 里的签名步骤配好仓库变量就生效。资格目前是组织在美国、加拿大、欧盟、英国、澳大利亚、新西兰、日本、韩国、新加坡、瑞士、挪威、以色列，个人仅限美国/加拿大（名单会变，以官网现行说法为准） | 没资格就不签：变量留空，签名步骤自动跳过；release 说明里提前写明 SmartScreen 会提示「未知发布者」，并给 SHA256 + attestation 让人能验（`github-actions.md`） |

表里不少格子是「不装」「不用」「不做」。实测下来，一个应用工程可以做到零第三方运行时依赖，功能一点没少，所以默认值就该是空的。

### 开发环境：勾一个工作负载，扩展一个不装

装 Visual Studio 2026 Community，在安装器里勾「.NET 桌面开发」，结束。SDK、XAML 设计器、XAML 热重载、Live Visual Tree 全在这个工作负载里。

**版本别将就 VS 2022**：.NET 的 SDK 特性 band 与 VS 大版本一一对应。官方表里 VS 17.14 能装 10.0.1xx SDK，但它能 target 的最高框架是 net9.0；target net10.0 的官方最低版本是 MSBuild / VS **18.0**（即 VS 2026，见[官方版本对应表](https://learn.microsoft.com/dotnet/core/porting/versioning-sdk-msbuild-vs)）。命令行装个 .NET 10 SDK 能编，但 IDE 侧不受支持。

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

MTP 顺带给了一个实用参数：

```bash
dotnet test tests/Xxx.Core.Tests -c Release -- --minimum-expected-tests 1
```

适配器没加载好的时候，`dotnet test` 会一个用例不跑却退出 0，CI 显示绿色，这个参数就是防它的。

### SDK 固定：global.json 一处说了算

仓库根放一份 `global.json`，SDK 版本只在这里出现一次：

```json
{
  "sdk": {
    "version": "10.0.402",
    "rollForward": "latestFeature",
    "allowPrerelease": false
  }
}
```

- **写完整版本**（`10.0.402`，不是 `10.0.x`）：它是**下限**，也是 `rollForward` 的起点。下限不是"当前最新 SDK"——实测把下限设成比本机装的还新（比如本机只有 10.0.303 时下限写 10.0.402）会直接解析失败。`latestFeature` 让本机补丁自己到手，所以只有在要用新 feature band 的功能时才抬这个数；想知道当前最新是多少，查官方 release metadata 或按 SKILL.md 铁律一核对。
- **`latestFeature` 让本机补丁自己到手**：本机在已安装的 SDK 里挑最新的 10.0.x（VS 2026 自己升级后不会编不过）。CI 侧要单独看：`setup-dotnet` 的 `global-json-file` 读的是 `sdk.version`，不要假设它会替你执行 `rollForward`（升级 action 前核对其 README/源码）。CI 实际拿到的补丁取决于 action 版本与 runner 预装的 SDK；要保证 CI 也带上最新运行时补丁，定期抬 `global.json` 的下限，或显式安装目标 SDK。自包含版把运行时打进 exe，CI 用哪个 SDK 就带哪个运行时补丁。
- **CI 里不再写 `dotnet-version`**：`setup-dotnet` 用 `global-json-file: global.json`。两处都写就是两个版本源，升级时必有一处被忘掉。
- **换大版本**（到下一个 LTS）时，`global.json`、所有 csproj 的 `TargetFramework`、四份 pubxml 的 `TargetFramework`、pubxml 文件名和 release body 里的 `needs-dotnet10` 一起改。

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

- **只管自己和 CI**（单人/小团队，CI 每次现装最新 SDK）：下限写当前补丁号最省事——反正 CI 装的就是最新的，本机也不会低于它。
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

.NET SDK 团队在 [dotnet/sdk#48795](https://github.com/dotnet/sdk/issues/48795) 给的现行答复是：用锁文件就把 SDK 也锁死（`rollForward: disable`），整条工具链同步升级。这和上一节「本机补丁自己到手」正好相反。

默认：**不开锁文件**。`PackageReference` 写精确版本（`Version="2.3.0"`，不写 `2.*`），发版前 `dotnet list package --outdated` 看一眼；`net10.0` 起 NuGetAudit 默认是 `all`，传递依赖的已知漏洞在还原时就报 `NU190x` 警告。

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
