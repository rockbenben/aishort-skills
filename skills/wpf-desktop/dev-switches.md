# 开发期自查工具：常驻开关与临时探针

WPF 应用有两类问题特别难查：**看不出对错的**（多语言 / 多分辨率 / 深浅主题下的布局）和**间歇性的**（抢前台、竞态）。靠手点复现不了，得让程序自己交代。

命令行开关（`--smoke` / `--shots`）常驻主干，挂在 `OnStartup` 里、**且放在单实例互斥体检查之前**，这样托盘里正在用的实例照常工作，检查进程自己开自己关，互不干扰。探针则是临时的：量完就删，不进主干。

```csharp
protected override void OnStartup(StartupEventArgs e)
{
    // …读配置、上主题…
    if (e.Args.Contains("--smoke") || e.Args.Contains("--shots"))
    {
        // 别在 OnStartup 里当场跑：BeginInvoke 到 ApplicationIdle，等消息循环转起来再执行。
        // 实测有应用当场跑时窗口 hwnd=0、尺寸全零（另一个应用却没事，没花时间分辨差异）——
        // 推迟的代价是零，就一律推迟。
        Dispatcher.BeginInvoke(() =>
        {
            if (e.Args.Contains("--shots")) RunShots(e.Args); else RunSmoke();
        }, DispatcherPriority.ApplicationIdle);
        return;
    }

    _mutex = new Mutex(true, @"Local\Xxx.App", out bool isFirst);   // ← 之后才是单实例；Local\ 每会话一实例，要整机唯一才用 Global\
    // …
}
```

## `--smoke`：CI 里防 XAML 错误带到发版

构造并布局每一个窗口，然后退出。WPF 的 XAML 是懒加载的，某个窗口写错了，只要不打开它就不会报错。

```csharp
private void RunSmoke()
{
    InSmoke = true;                       // App 上的 static bool；窗口定位/居中逻辑判它跳过，别乱动
    string report = Path.Combine(Path.GetTempPath(), "xxx-smoke.txt");
    try
    {
        foreach (var make in new Func<Window>[] { () => new MainWindow(), () => new SettingsWindow(), /*…*/ })
        {
            var w = make();
            w.WindowStartupLocation = WindowStartupLocation.Manual;
            w.Left = -32000; w.Top = -32000; w.ShowActivated = false;
            w.Show();
            Dispatcher.Invoke(() => { }, DispatcherPriority.Loaded);   // 泵到 Loaded：Show 排队的收尾活当场做完
            w.UpdateLayout();
            // 不只「没抛」：必须断言真的布局出了尺寸。Window.Show() 在应用已开始关闭时会静默空转
            // （不抛、hwnd=0、ActualWidth=0），只判异常的 smoke 在那种状态下照样绿灯——
            // 实测漏过一整轮 84/84 全零（见下面「harness 会自己引爆的三颗雷」第一颗）。
            if (w.ActualWidth <= 0 || w.ActualHeight <= 0)
                throw new InvalidOperationException($"{w.GetType().Name}: laid out to zero size");
            w.Close();
        }
        File.WriteAllText(report, "OK");
        Shutdown(0);
    }
    catch (Exception ex) { File.WriteAllText(report, ex.ToString()); Shutdown(1); }
}
```

CI 里判成功以**它写的 marker**为准，退出码只做辅助：PowerShell 经 `Start-Process -PassThru` 读 GUI 进程的 `ExitCode` 有已知的读空坑（拿到 `$null`），而且 marker 顺带证明了应用真跑到了「所有窗口都布局完、走到写文件」那一步——这正是这个开关要验的事。所以成败看 marker，退出码只在**明确非零**时才判失败。

**完整的 CI 步骤（含定位 exe、失败时打印异常）见 `github-actions.md` 的 `Smoke (parse every window's XAML)` 那一步**，直接照抄进 test job 即可，别自己拼。

## `--shots <目录>`：多语言 / 多分辨率 / 双主题批量截图

用 `RenderTargetBitmap` 离屏渲染每个窗口成 PNG，不抢焦点、不打扰运行中的实例。一次跑出几十张，逐张比对。

关键是**模拟工作区高度**，因为窗口高度上限是按显示器工作区算的：

```csharp
// 工作区高度（DIP）= 屏幕物理高 / 缩放 - 任务栏高度
// 任务栏随 DPI 缩放，所以它在 DIP 里是个常数：Win10 约 40，Win11 约 48（自动隐藏则为 0）
const double taskbar = 40;
var waHeights = new[] {
    768 / 1.25 - taskbar,    // 1366x768 @125%  ≈ 574——最容易出事的一档
    1080 / 1.50 - taskbar,   // 1920x1080 @150% ≈ 680
    1080 / 1.00 - taskbar,   // 1920x1080 @100% ≈ 1040
};

void Shot(string name, Func<Window> make, Action<Window>? tweak = null)
{
    foreach (var wa in waHeights)
    {
        ThemeService.Apply(activeTheme);          // 每个窗口都重设：有的窗口初始化时会改全局主题
        var w = make();
        w.WindowStartupLocation = WindowStartupLocation.Manual;
        w.Left = -32000; w.Top = -32000; w.ShowActivated = false;
        w.Show();
        w.MaxHeight = wa;                          // 必须 Show 之后设，否则被真实显示器的值覆盖
        tweak?.Invoke(w);
        // 改 MaxHeight（以及 tweak 里的任何改动）只是让布局失效，ActualWidth/ActualHeight
        // 要等下一次布局过程才更新。少了这两句，截图就是按「封顶之前」的尺寸拍的——正好是
        // 这个 harness 要模拟的那个维度，等于白跑。RunSmoke 里同样有这两句。
        w.Dispatcher.Invoke(() => { }, DispatcherPriority.Loaded);
        w.UpdateLayout();
        var rtb = new RenderTargetBitmap((int)Math.Ceiling(w.ActualWidth), (int)Math.Ceiling(w.ActualHeight),
                                         96, 96, PixelFormats.Pbgra32);
        rtb.Render(w);
        // …PngBitmapEncoder 存成 $"{name}@{wa:0}.png"…
        w.Close();
    }
}
```

外层再套主题和语言循环。覆盖面按「窗口类型 × 深浅主题 × 三种高度 × 各语言的高危视图（最窄宽度、最长翻译、RTL）」组织，不必是完整笛卡尔积。

**这套东西真正的价值在于逼出你想不到的组合**：德语最窄宽度下提示条被切成半个词、阿拉伯语下标题从开头被截断，这些在中文加常用尺寸下一次都遇不到。

### 它查不出什么：`w.MaxHeight = wa` 会替应用打掩护

上面那句 `w.MaxHeight = wa` 是**无条件**设的。对一个 `SizeToContent="Height"` 却忘了在运行时按显示器工作区封顶的窗口来说，这等于 harness 替它补上了真实应用根本没有的上限——**截图张张正常，真机上按钮在屏幕外面**。我就是这么让一个「变量一多就点不到确定」的对话框躲过了整套截图检查（症状见 `pitfalls.md`「对话框在小屏上，确定按钮跑到任务栏底下」）。

两条推论：

- **「缺少运行时封顶」`--shots` 结构上就看不见，但它不必只靠 code review——把检查点写成测试。** 检查点本身很明确：每个 `SizeToContent` 的窗口，是不是都有一处按 `GetMonitorInfo` 算出来的 `MaxHeight`。而这个判据是纯文本的，扫源码就能验，不需要跑起来：

  ```csharp
  // 扫 app/ 下所有 .xaml，挑出带 SizeToContent 的，要求同名 .xaml.cs 里出现 FitToWorkArea
  // （或列进一份写明理由的豁免名单）。再给豁免名单配两条防腐用例：
  //   · 名单里的窗口若已不是 SizeToContent → 红（迫使名单跟着代码走）
  //   · 豁免理由里写的那个符号，必须在那个窗口的代码里真的找得到
  ```

  实测价值：一个真实应用里跑第一次就抓到一扇漏网的窗口（列表行数由用户配置决定、没有上限），
  而那扇窗在六千张截图里张张正常。**人眼 review 是会忘的，这一类正是最不该交给记性的**——
  而且它躲过 review 的方式很具体：运行时封顶那段代码的注释自己就写着「退回 XAML 里那个保守的
  `MaxHeight`」，读到注释的人不会再去核对那扇窗的 XAML 里到底有没有它（见 `pitfalls.md`
  「对话框在小屏上」末尾）。
- **窗口高度由数据（而不是布局）决定时，要专门造一个「量大」的截图用例，并且跑满三种工作区高度。** 一个只填两个变量的对话框截图永远是好看的；填十二个的那张才是有信息量的那张。修好之后这张图也正好是验收物：短工作区下应该看到滚动条出现、按钮仍钉在底部。

### 它查不出什么之二：没有任何 harness 状态会渲染到的那一行

上面那条是「harness 替应用补了上限」。还有一类更彻底：**那一行压根不在任何一张图里**。

截图矩阵是按「窗口 × 语言 × 尺寸 × 主题」铺的，而条件性 UI 的显隐由**数据**决定。实测撞上的一次：
某个字段行只在一个下拉选到冷门那一档时才出现，而 harness 给那个编辑器造的十几个状态全是照
「常见用法」挑的，没有一个选到那一档——于是六千张图里，那一行是**零像素**。而它恰好有个只在长译文下发作的缺陷
（`TextWrapping="Wrap"` 但没有任何宽度上限，中文 25 字看不出，德语 109 字顶出窗口）。

两条推论：

- **给条件性 UI 造状态时，清点的是「分支」而不是「窗口」。** 一个有 N 个互斥字段面板的编辑器，
  十几个状态听着不少，但只要它是按「常见用法」挑的，冷门那一档就一张都没有。
- **这一类同样该落到测试上，而不是再加十四个截图状态。** 缺陷本身是结构性的（见
  `pitfalls.md`「德语界面上控件被挤没」末尾那条可机械化的判据），扫源码就能查，
  比把矩阵撑大一倍便宜得多，也不会漏掉下一个新加的分支。

### harness 会自己引爆的三颗雷

这三颗都是给一个真实应用装这两个开关时实测踩响的，症状全都离根因很远。

**一、样例配置必须复刻正常启动在建窗前建立的全部约定，否则应用自己的响应式逻辑会在 harness 里走火。** 实测的那次：样例配置留着 `Language=""`（跟随系统），而正常启动时 App 会在建任何窗口之前把它解析成具体 code 落盘。于是主窗口语言下拉的初始赋值触发 `SelectionChanged`，守卫 `新值 == 配置值` 不成立，被判成「用户切了语言」→ 应用按设计重启自己（`Shutdown()` + 重开进程）。每一步都是正常逻辑，合起来的症状却是：84 张截图全部零尺寸（Application 开始关闭后 `Show()` 静默空转），第二轮起建窗直接抛「应用程序对象正在关闭」。修法一行（样例配置先把语言解析成具体 code），但**找到它靠的是 `Dispatcher.ShutdownStarted` 栈探针**（见 `pitfalls.md`「应用突然消失」那节的「第四种消失」）——别靠猜，Shutdown 的调用方让它自报家门。

**二、每类窗口构造前想一遍：ctor / Loaded 里有没有「对比配置后执行副作用」的处理器。** 上面那颗雷的一般形式。语言下拉只是一例，凡是「初始化赋值会触发 `SelectionChanged` / `Checked` / `TextChanged`」的地方，harness 给的样例值和处理器预期的约定不一致时，副作用（写盘、重启、弹窗）就会在冒烟进程里真的执行。危险副作用的守卫写在处理器里（判「值没变就返回」），比在 harness 里逐个绕开便宜。

**三、语言循环里的 RTL 别用 `OverrideMetadata`。** `FlowDirectionProperty.OverrideMetadata(typeof(Window), …)` 每类型每属性**只能调一次**（[官方文档](https://learn.microsoft.com/dotnet/api/system.windows.dependencyproperty.overridemetadata)：重复调抛 `ArgumentException`），正常启动只走一遍没事，放进逐语言循环第二圈就抛。harness 里逐窗口设 `w.FlowDirection = culture.TextInfo.IsRightToLeft ? RightToLeft : LeftToRight` 即可，效果等价。

## 分段计时探针：定位启动耗时

临时加，量完就删。别猜哪里慢。

```csharp
private static readonly Stopwatch _sw = Stopwatch.StartNew();
private static readonly List<string> _log = new();
private static void Mark(string what) => _log.Add($"{_sw.ElapsedMilliseconds,5}ms  {what}");
// OnStartup 末尾：Dispatcher.BeginInvoke(new Action(Dump), DispatcherPriority.ApplicationIdle);
```

在每个阶段之间打点，退出时写文件。左边一列是**累计**值，所以每一阶段自身的耗时要用相邻两行相减——这一步别省，耗时大头往往就藏在两个看起来平平无奇的打点之间。

拿到分布再决定动哪里。一份真实的输出、它暴露出的根因（第三方库首次调用加载内置数据）以及配套修法，见 `pitfalls.md`「冷启动 1.9 秒，慢的却不是磁盘」——那里同时列了后台化之后必须收尾的三件事，只挪线程不收尾会换来更难查的 bug。

## 像素采样探针：验证视觉问题

「白闪」「闪一下」这类问题，需要把主观描述变成可数的帧。开窗期间起个后台线程，每 5ms 用 `GetPixel` 从屏幕固定坐标取色：

```csharp
IntPtr dc = GetDC(IntPtr.Zero);
uint c = GetPixel(dc, x, y);      // 0x00BBGGRR
ReleaseDC(IntPtr.Zero, dc);
```

对照 `SHOW` 和 `ContentRendered` 两个时间戳分段统计，就能回答「窗口在这段时间里到底是什么颜色」。我用它证伪了一个看起来很合理的修法（`WM_ERASEBKGND` 挂钩擦背景），因为白帧发生在任何擦除消息之前。

探针必须跑在**应用自己进程里**，这不是偷懒的选择。从外面的脚本采样有两个坑我都踩过：一是采到的常常是别的窗口（目标没在前台，而后台进程调 `SetForegroundWindow` 会被系统拒绝）；二是**跨进程读不了非库存的 GDI 对象**——想查窗口类的背景刷时 `GetObject` 返回 0，而它不会清空你传进去的结构体，于是全零被读成「这是一把黑色实心刷」，看起来像一个完全合理的结论。查 GDI 一定要判 `GetObject` 的返回值。

## 从外部驱动 UI 做验证

给窗口截图对照时，`System.Windows.Automation`（UIA）不一定看得见模态对话框：我在一个应用上试了四次，`AutomationElement.RootElement.FindAll(TreeScope.Children, …)` 始终只列出主窗口，而那个对话框明明就在屏幕上。

别在 UIA 上耗时间，直接用 `EnumWindows` 按进程 ID 加标题捞：

```csharp
EnumWindows((h, _) => {
    GetWindowThreadProcessId(h, out uint pid);
    if (pid == target && IsWindowVisible(h)) { /* GetWindowText 判标题 */ }
    return true;
}, IntPtr.Zero);
```

配套两条：窗口没显示时 `Process.MainWindowHandle` 是 0（托盘应用常态如此），所以别拿它当入口；窗口矩形用 `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` 而不是 `GetWindowRect`，后者在 DWM 下会多出一圈不可见的边框阴影。

UIA 仍然是选控件、点按钮的好工具（`InvokePattern` / `SelectionItemPattern` / `ExpandCollapsePattern` 都好用），只是**找窗口这一步**别指望它。另外按名字找控件时要按 `ControlType` 过滤——`FindFirst(NameProperty, "类型")` 很可能命中的是那个标签 `TextBlock` 而不是它旁边的 `ComboBox`，然后报「不支持的模式」。还有一个静默坑：`AutomationId` 写在 `Border` 这类没有默认 automation peer 的元素上，UIA 树里根本不会出现——`AutomationId` 自己不会创建 peer。

## 间歇性问题：跑 N 轮记比分

「有时候不灵」不能用单次复现判断。同一条路径跑 12 轮，每轮记录成功与否，最后报比分。A/B 两组必须**背靠背跑**，否则桌面状态变化会污染结果。

一个真实案例：怀疑某次改动导致窗口抢不到前台，A/B 跑出 11/12 对 6/12，当场排除了那个改动。**但也要接受探针不可靠的可能**——同一配置第二轮跑出两组 12/12，说明它复现不稳定，这种情况下就不能声称修好了，只能上线观察。
