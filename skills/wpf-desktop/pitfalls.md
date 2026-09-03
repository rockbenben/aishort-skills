# WPF 踩过的坑（按症状查）

按现象排，每条都是实测过的：症状 → 排除过程 → 根因 → 改法。碰到对应症状时直接跳到那一节，改法可以直接抄。

文中的绝对毫秒数和体积都来自某一台开发机上的某个应用，**换机器换应用一定不一样**；能迁移的是量级关系和形状（哪一档是地板价、哪个差十倍、哪个在噪声里），照抄结论之前按 `dev-switches.md` 的探针在自己的机器上量一遍。

## 窗口出现前白闪一下

从窗口显示到 WPF 提交第一帧之间有真实空档，实测热开约 100 毫秒、首次打开约 300 毫秒，而这个窗口的第一帧 DWM 合成结果是白的，比内容帧早到约 50 毫秒。

两条看着合理的弯路都不通：挂 `WM_ERASEBKGND` 用主题色擦背景无效，白帧发生在任何擦除消息之前；换窗口类的背景刷同样无效，WPF 给每个窗口注册的类 `HwndWrapper[App;;<guid>]` 的 `hbrBackground` 本来就是库存 `NULL_BRUSH`，系统早被告知「这块别擦」，不存在一把白刷子等着你替换。

有效的做法是把窗口先从合成里藏掉：

```csharp
[DllImport("dwmapi.dll")]
static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
const int DWMWA_CLOAK = 13, DWMWA_CLOAKED = 14;   // 值见官方 DWMWINDOWATTRIBUTE 枚举

// 每个要防白闪的窗口调一次；hwnd 要等 SourceInitialized 之后才非零
static void EnableAntiFlash(Window w)
{
    void Cloak(int on)
    {
        var hwnd = new WindowInteropHelper(w).Handle;
        if (hwnd != IntPtr.Zero) DwmSetWindowAttribute(hwnd, DWMWA_CLOAK, ref on, sizeof(int));
    }
    w.SourceInitialized += (_, _) => Cloak(1);
    w.ContentRendered   += (_, _) => Cloak(0);
}
```

感知延迟不变，那段时间原本也看不到内容。`AllowsTransparency="True"` 的分层窗口没有这个问题，系统在 WPF 合成之前根本不画它，所以无边框悬浮面板不用管，带原生边框的普通窗口才要处理。

## 改完第一次不闪了，托盘里第二次打开照旧闪

上面那段代码有个前提：**它只对「每次用完就关、下次新建」的窗口成立**。设置窗口、管理器窗口都是这样，每开一次走一遍 `SourceInitialized`。

托盘应用的主窗口通常不是这样，关闭只是 `Hide()`，对象一直活着，`SourceInitialized` 一辈子只触发一次。于是只有开机后第一次显示不闪，之后每次从托盘打开白闪原样回来。

补法是在窗口隐藏之后重新 cloak，为下一次显示备好：

```csharp
w.IsVisibleChanged += (_, e) =>
{
    if (e.NewValue is false) { Cloak(1); return; }   // 隐藏态不参与合成，此时 cloak 不可见
    // 兜底：正常由 ContentRendered 摘掉；万一某次没触发，
    // 卡在 cloak 里的窗口就是「点了托盘没反应」的隐形应用
    w.Dispatcher.BeginInvoke(() => Cloak(0), DispatcherPriority.ContextIdle);
};
```

那个兜底不是洁癖。cloak 的失败方向很不对称：没设上只是白闪照旧，回到修之前；设上没摘掉，应用就彻底隐形，用户只会以为程序坏了。`ContextIdle` 排在 `Render` 和 `Loaded` 之后，正常路径跑到它时 `ContentRendered` 早已摘干净，这一次就是空操作。

验证要连着三态一起看，只测第一次会漏掉这个坑：首次显示 `cloaked=0` → 隐到托盘 `cloaked=1` → 再次显示 `cloaked=0`。读法用 `DWMWA_CLOAKED`（14），注意它的签名是 `out` 不是 `ref`：

```csharp
[DllImport("dwmapi.dll")]
static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out int cloaked, sizeof(int));
```

## 第一次打开窗口要等一下，之后就很快

白闪修好之后会冒出一个新观感：窗口不再「立刻出现然后变清晰」，而是「点了之后什么都没有，过一会儿整个出来」。总时长没变，但空白比白屏更像卡住。

用具名事件直接触发「显示主窗口」（绕开新建进程的开销，等价于托盘双击），实测量到：

| 状态                 | 显示主窗口 → 窗口可见 |
| -------------------- | --------------------- |
| 冷（窗口从未渲染过） | 141 ms                |
| 热（渲染过一次）     | 15 ms                 |

差了快十倍。开机自启的托盘应用，主窗口在用户第一次打开之前从没渲染过，那一下要现场把整棵可视树建出来：控件模板展开、DataGrid 行实例化、整份主题字典解析。对照组也很清楚：把面板做成 `App` 的字段、建一次常驻，之后只 Show/Hide，就永远走 15 毫秒那一档。

结论是趁没人看的时候把它跑一遍，不用真的显示：

```csharp
// 启动时窗口不显示的那条分支上排一个，ApplicationIdle 保证不和开机任务抢资源
if (!_main.IsVisible)
    Dispatcher.BeginInvoke(WarmMainWindow, DispatcherPriority.ApplicationIdle);

void WarmMainWindow()
{
    // Window.Width/Height 的默认值是 NaN（没在 XAML 里写死尺寸、或用 SizeToContent 的窗口
    // 就是这样），而 UIElement.Measure 明确拒绝 NaN 并抛 InvalidOperationException。
    // 这段跑在每次启动的路径上，直接照抄进一个自适应尺寸的窗口就是启动即崩。
    var w = double.IsNaN(_main.Width) ? _main.RestoreBounds.Width : _main.Width;
    var h = double.IsNaN(_main.Height) ? _main.RestoreBounds.Height : _main.Height;
    if (double.IsNaN(w) || w <= 0) w = _main.MinWidth > 0 ? _main.MinWidth : 800;
    if (double.IsNaN(h) || h <= 0) h = _main.MinHeight > 0 ? _main.MinHeight : 600;
    var size = new Size(w, h);
    _main.Measure(size);
    _main.Arrange(new Rect(new Point(), size));
    _main.UpdateLayout();
}
```

首次打开 141 → 79 毫秒，不 Show、不抢焦点、不进任务栏。到不了 15 毫秒：再用 `RenderTargetBitmap` 离屏渲一遍想把光栅化也提前，83 对 79 毫秒，噪声之内。剩下那约 65 毫秒不在内容上，而在窗口呈现本身（`HwndTarget` 建面、DWM 首次合成握手），不真的 Show 一次就付不掉。

## 双击 exe 之后忙碌光标转 1.2 秒

单实例用具名 `Mutex` 判断，`_mutex` 必须是字段，写成局部变量的话方法一返回它就成了垃圾，GC 收走时锁跟着释放，第二个实例照样能启动，而且这种 bug 只在 Release 下偶发。名字前缀决定作用域：`Local\` 或不带前缀是每个登录会话各一个实例，`Global\` 是整机一个。托盘小工具通常要前者（快速切换用户时第二个会话还能开自己的），要跨会话碰全局资源的应用才需要 `Global\`。

卡顿出在第二个实例退出前的「接管」等待上。老实例活得好好的才是常态，这个等待常态下必然走满：设 1200 毫秒，就是每次双击 exe 都白转 1.2 秒。实测缩到 250 毫秒后，双击到第二个进程退出从 1.4 秒降到 0.5 秒，接管照样成立；真没赶上，后果只是这次双击没反应、再点一次。

还有一条顺序问题：叫醒老实例的信号要发在等互斥体**之前**，反过来写常态路径就是先空等满超时才去叫窗口。

但超时不能一刀切。还有两类进程会撞上同一段代码：切换界面语言后重开自己、以管理员身份重开自己。这两条恰恰相反，接管一个正在退出的实例是它们唯一的目的，而且失败后果不对称：双击失败只是再点一次，这两条路上老实例已经在退了，新实例再一退就一个都不剩，用户切完语言发现应用没了。

按「本进程是被谁启动的」分档。重启路径本来就会带一个 `--show` 之类的参数（用来忽略「启动时最小化」强制显示窗口），正好当判据：

```csharp
var takeover = e.Args.Contains("--show")
    ? TimeSpan.FromSeconds(3)          // 被重启路径派出来顶替，接管是唯一目的，给足余量
    : TimeSpan.FromMilliseconds(250);  // 用户双击，老实例还在，等待必然走满，越短越好
```

## 冷启动 1.9 秒，慢的却不是磁盘

启动慢别猜，先在 `OnStartup` 里埋分段计时：一个 `Stopwatch` 加一个 `Mark(string)`，每个阶段打一行，退出时写进临时文件。一个真实应用量出来是这样：

```
   35ms  设置读完
   48ms  片段库读盘 + JSON 解析（9ms）
  820ms  ← 一次拼音调用
  823ms  全部片段建索引（3ms）
 1258ms  创建第一个窗口（WPF 图形栈初始化，约 430ms）
 1405ms  面板构造完
```

左边一列是累计值：那一次拼音调用自己耗掉约 770 毫秒（820 减去它之前的 48），而它上下两行的磁盘读加 JSON 解析只有 9 毫秒、建索引只有 3 毫秒。表格到 1405 毫秒为止只是「面板构造完」这个打点，冷启动 1.9 秒里剩下的是打点之后的窗口呈现和消息循环起转。

不量的话，谁能想到磁盘和 JSON 只占 9 毫秒、一次函数调用占七百多毫秒。

那七百多毫秒是 ToolGood.Words 的拼音词典在首次调用时加载，跟数据量无关：词典装完之后给所有片段建索引只要 3 毫秒。带内置数据的库大多是这个形状（NLP、正则表、字典、词库），第一次调用付全款。

修法不是换库，是把「第一个调它的人」挪出关键路径：索引构建放后台线程，查询入口先 join，闸门放在索引类自己的公开方法里，调用方一行不用改。冷启动从 1.9 秒降到 1.3 秒；额外的红利是二次启动从 1.05 秒降到 0.3 秒，因为这份成本原来也挡在单实例检查前面。

**但「查询入口先 join」这句照抄会出事，后台化真正难的是收尾这三件。**

**一、UI 线程不能 join。** 查询入口通常从 UI 线程被调用，而托盘工具的 `WH_KEYBOARD_LL` 钩子也派发在同一个线程上。`Task.Wait()` 一旦拖过 Windows 的低级钩子超时，**系统会把钩子静默移除且不通知应用**（[官方文档](https://learn.microsoft.com/windows/win32/winmsg/lowlevelkeyboardproc)：超时读注册表 `LowLevelHooksTimeout`，官方未记载默认值、实测量级是几百毫秒，Win10 1709 起系统上限 1000 毫秒；官方也因此建议低级钩子跑在专用线程、活交给工作线程）——缩写展开、点击唤出这些功能在剩下的整个会话里静默失效，而且触发它的那几个按键本身也被吞了。开机自启的场景下用户完全可能在那七百多毫秒还没跑完时就敲下第一个键。

**二、别用「有界等待」去躲上面那条。** 我第一版把 join 改成 200 毫秒上限，测试立刻挂了四个：有界等待会让查询从半成品索引返回结果，也就是**「这个片段不存在」——把一次卡顿换成了静默的错误答案，更糟，而且调用方无从察觉**。正确形状是两件事分开：查询入口保持无界 join（保住「读到的一定是完整索引」这个契约），另外公开一个 `IsBuilt`，让付不起阻塞代价的 UI 线程自己提前判断、跳过这次查询，等索引建好的事件回来再补查一次。

**三、异常要「兜住并上报」，只兜不报会丢掉用户可见的警告。** 原来构建跑在启动的 try/catch 里，失败会退化成空库**并弹一个提示**。挪到后台之后：不兜，异常会延迟到用户敲第一个键时从查询入口抛出来，等于按一下键就崩面板；只兜不报，用户拿到的是「管理器里词条一条不少、搜索面板一条都搜不到、没有任何提示」——比原来更难排查。所以后台任务里 catch 之后要通过回调/事件把失败送出去，由 UI 层还原成原来那个提示。

优化后剩下的墙钟大致是：进程加运行时启动约 300 毫秒，WPF 图形栈初始化约 430 毫秒（创建第一个 HWND 时一次性付清）。这两块是框架地板价，到这个量级就该停手。托盘应用的冷启动每次登录只发生一次还不弹窗，用户真正感知的是热键呼出面板、双击 exe、开窗白闪这三个入口，那三个才值得逐个压。

## 点了「设置」，窗口偶尔没到最前面

托盘菜单点开一个窗口，它有时候起在别的窗口后面。这类问题的第一反应通常是「哪次改动引入的」，但它是间歇性的，单次复现说明不了任何事，得先有数字。

我的做法是写个探针：同一条路径开 N 次窗口，每次记录 `GetForegroundWindow()` 是不是我们自己，最后报一个比分。一轮下来的结果是 11/12 对 6/12，当场排除了我最怀疑的那次改动（把窗口从合成里隐身用来防白闪，见前面那节）。顺带一提，这也说明 cloak 不影响窗口拿前台，能放心用。

根因是 Windows 的前台移交是异步的。点托盘菜单时菜单正在关闭、系统正把前台还给你原来所在的应用，我们的抢占会被这个还没完成的移交覆盖掉。常见的写法是抢一次就走，可靠的写法是抢完之后持续验证一小段时间：每 50 毫秒查一次 `GetForegroundWindow()`，丢了就再抢，连续几次确认握住才收手。

但这套守卫也有抢不赢的时候，Windows 整段时间都在拒绝授权。这时候要认清一件事：前台是系统说了算的，z 序不是。守卫超时且一次都没握住时，退而求其次把窗口的 z 序提到最前。

**但这个兜底必须带三道护栏，裸写会引入比它修的问题更严重的 bug。** 下面每一条都是代码审查从裸版本里实际挑出来的：

```csharp
// 只在「彻底抢输」这条分支跑，正常抢到前台时完全不执行
static void RaiseAboveBlocker(Window w, IntPtr hwnd, IntPtr blocker)
{
    if (hwnd == IntPtr.Zero || w.Topmost) return;          // ① 置顶窗口一律跳过
    var fg = GetForegroundWindow();
    if (fg == hwnd || fg != blocker) return;               // ② 只压过一开始那个对手
    const uint f = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
    SetWindowPos(hwnd, HWND_TOPMOST,   0, 0, 0, 0, f);
    SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, f);
}
// ③ 调用点：gaveUp 要单独判，不能跟着整个退出分支走
if (gaveUp && stable == 0) RaiseAboveBlocker(w, live, blocker);
```

**① 绝不能对 `Topmost="True"` 的窗口跑。** `SetWindowPos` 绕过 WPF 直接改 `WS_EX_TOPMOST`，而 `Window.Topmost` 属性值不跟着变——属性没变化就不触发 `OnTopmostChanged`，WPF 永远不会把样式贴回去。于是这个窗口**在进程剩余的生命周期里都不再置顶**。托盘工具的搜索/悬浮面板通常正是「置顶 + 全程复用同一个实例」，一次抢输就永久降级，之后每次在全屏应用上唤出都开在人家后面——用户看不见它，却在往里打字。而且对这类窗口它连收益都没有：面板拿不到前台时本来就会在 `onSettled` 里自我隐藏，翻上去那一下微秒级就被自己撤销了。

**② 只压过「一开始那个赢家」。** 守卫窗口有 900 毫秒，用户完全可能在这期间自己切到第三个应用去打字。不判断的话，到期时前台是谁就盖谁，用户会看到一个自己已经离开的窗口莫名浮上来挡住正在输入的地方，且没有任何点击能解释它。做法是进 `BringToFront` 时先记下 `GetForegroundWindow()`，到期时只有前台还是它才动手。

**③「超时」要和退出分支分开判。** 守卫的那个 `if` 通常写成「handle 没了 ‖ 窗口不可见 ‖ 超时」三合一，但只有第三种才是「抢输了」。用户在 900 毫秒内按 Esc 关掉窗口走的是第二种，这时候再去翻一个刚被关掉的窗口，轻则白费一次 interop，重则连带触发 ①。

翻上去再立刻翻回来，窗口就压在那个赢了前台的应用上面，而不会真的变成置顶窗口。用户点「设置」要的是看见设置，不是那个焦点。

最后一句实话：这条兜底的**收益**没能验证。探针在第二轮跑出两组 12/12，也就是说它复现不稳定，没有可靠的失败场景可以拿来验收。但它的**代价**是验证过的——上面三条护栏全是事后从这段代码里挑出来的真实缺陷。所以教训有两层：**别把「装上去了」当成「修好了」；也别以为一个收益没验证过的兜底就不会有成本。**

## 副屏上窗口位置算错

`app.manifest` 里必须声明 PerMonitorV2：

`dotnet new wpf` **不会生成这个文件**，要自己建 `app.manifest` 并在 csproj 里用 `<ApplicationManifest>` 指过去（见 `project-setup.md` 的 csproj 片段）。层级贴错一层不报错、清单被静默忽略，正好就是这一节要防的 bug，所以给完整文件：

```xml
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">permonitorv2,permonitor</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>
```

写成 `permonitorv2,permonitor` 这个降级链是有意的：PerMonitorV2 要 Win10 1703 才有，逗号后面那档给更老的系统兜底。

没有这两行，进程只是系统级 DPI 感知，全局只有一个像素到 DIP 的换算系数，副屏只要缩放比例和主屏不同，窗口定位就是错的。声明之后要跟着改的是心智：不存在「整个桌面的缩放比例」这回事了，每次做几何换算都得用 `GetDpiForMonitor` 问那块屏自己的 DPI。

两个配套的坑。一是同时开了 `UseWindowsForms` 的混合工程（用 WinForms 托盘图标或剪贴板时会这样），WinForms 的分析器会对清单里这两行报 `WFO0003` 让你改用 `ApplicationHighDpiMode`。那条建议只对真正的 WinForms 应用成立，它作用于 WinForms 生成的 `Main` 里那句 `Application.SetHighDpiMode`，而 WPF 应用的 `Main` 不经过那里。清单才是 WPF 的正规途径，直接 `<NoWarn>$(NoWarn);WFO0003</NoWarn>` 并在旁边写清理由。

二是验证别用 `GetAwarenessFromDpiAwarenessContext`，`DPI_AWARENESS` 这个枚举压根没有 V2 这一档，最大值就是 2（per-monitor），V2 上下文查出来也是 2，看着像没配成功。要用 `AreDpiAwarenessContextsEqual` 拿进程的上下文去和 `DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2`（值 -4）比。

## 对话框在小屏上，确定按钮跑到任务栏底下

用 `SizeToContent="Height"` 的编辑器窗口高度完全由内容决定，必须封顶，否则内容一多就长到屏幕外——首当其冲的是「确定 / 取消」那一行。

但封顶值不能写死。同一个数字要同时伺候 1366×768 的笔记本（100% 缩放下工作区仅约 728 DIP，任务栏吃掉约 40）和 4K 屏。实测撞上的一版把两个对话框写成 780 和 840，在小本上早就超出屏幕，在大屏上又白白空着一半——内容明明放得下却还在滚。写死的数一定在某一头是错的。

改成运行时按窗口所在那块屏的工作区算：

```csharp
w.SourceInitialized += (_, _) => {
    var hwnd = new WindowInteropHelper(w).Handle;               // 到这一步才非零
    var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
    GetMonitorInfo(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), ref mi);
    var scale = VisualTreeHelper.GetDpi(w).DpiScaleY;          // 这块屏自己的缩放
    var cap = (mi.rcWork.Bottom - mi.rcWork.Top) / scale - 72;  // 留点上下呼吸
    w.MaxHeight = Math.Max(cap, w.MinHeight);                   // 不能低于自己声明的下限
    if (!double.IsNaN(w.Height) && w.Height > cap) w.Height = cap;
};
```

两个点容易写错。一是别用 `SystemParameters.WorkArea`，它给的是**主屏**的工作区，而声明了 PerMonitorV2 之后不存在「整个桌面一个尺寸」，对话框又通常是 `CenterOwner`，主窗口在副屏时就错了。二是 DPI 换算直接用 `VisualTreeHelper.GetDpi(窗口)`，PerMonitorV2 下它返回的就是该窗口那块屏的缩放，不必自己去 P/Invoke `GetDpiForMonitor`。

XAML 里那个 `MaxHeight` 仍然留着，而且要**留保守值**，别改成宽松的大数：运行时探测成功会覆盖它，所以大数唯一生效的场合就是探测失败——而那正是最需要保守值兜底的小屏场景。我第一版改成了 1400，等于在兜底路径上亲手复活了要修的 bug。

**但「留着」这一步比它听起来容易漏，而且会以两种方式漏。** 事后清点一次，通常会发现
大多数 `SizeToContent` 窗口压根没有窗口级 `MaxHeight`，剩下的那几个留的也是错的值：

- **压根没写。** 探测失败时它们又变回不封顶，而上面这段代码的注释明明写着
  「拿不到显示器信息就什么都不做——退回 XAML 里那个保守的 `MaxHeight`」。**注释里这句承诺
  只有在 XAML 真写了它时才成立**——而后来动这块代码的人读到的是这句注释，不是那扇窗的 XAML。
  这类缺失于是被注释掩护着，越往后越不会有人去核对，这也正是它躲过 review 的方式。
- **写了，但留的正是加探测之前那个写死值（本节开头的 780 / 840）。** 也就是说，加上运行时探测之后，
  **旧的写死值并没有退休，它变成了失败路径上的值**。本节讲的是「780/840 在小本上超出屏幕」，
  而修完之后，780/840 仍然是探测失败时生效的那两个数——原来那个 bug 在失败路径上一字未改地活着。

所以这件事有两步，不是一步：① 加运行时探测；② **按最小屏重新选一次兜底值**。
而「最小屏」要按**缩放后**的可用高取，不是按分辨率：同一块 1366×768，
@100% 的工作区约 720 DIP，@150% 只剩 464——差 256 DIP。小本上把缩放调到 150 的人不少，
所以最紧的一档是 464，减去边距才是真正的上限（例：464 − 72 = 392）。

**这一步我自己就做错过一次，错法比结果值得记。** 按 @100% 那一档算出上限，
然后拿它去卡所有窗口——于是每一扇窗都“通过”了，而它们在真正最紧的那一档上
一个都装不下。测试绿的，要防的事一件没防住。**先去代码里找那个已经量过的数，
别自己推。** 上面那段运行时探测的代码里往往就写着它，而推导会悄悄得出一个
看上去很合理、实际宽泛一倍的值。

这两步都是纯文本判据，别靠记性——扫 XAML 找 `SizeToContent`，要求窗口标签上有 `MaxHeight`
且数值 ≤ 最紧那一档的上限（注意只看 `<Window>` 自己那个标签：内部控件上的 `MaxHeight`，比如列表限高，
不是窗口的兜底，拿整份文件去 grep 会把它们误当成已经封顶）。测试的形状见
`dev-switches.md`「它查不出什么」那两节。

## 深色应用配了个白色标题栏

看着像窗口只重绘了一半。`DWMWA_USE_IMMERSIVE_DARK_MODE` 的值是 20（[官方枚举](https://learn.microsoft.com/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)，标注 Win11 build 22000 起支持），要在 `SourceInitialized` 里调用，那时候 HWND 才存在：

```csharp
// hwnd 从 new WindowInteropHelper(w).Handle 取，SourceInitialized 之后才非零
int dark = isDarkTheme ? 1 : 0;
DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));
```

要覆盖 Win10 的话还有一档历史包袱：这个属性在 Win10 build 18985 之前的编号是 **19**，用 20 调过去会被静默忽略（`DwmSetWindowAttribute` 对不认识的编号返回错误码，不抛异常）。稳妥写法是先试 20、失败再试 19，两次都不判返回值就会得到「Win11 好好的、Win10 上标题栏还是白的」。

## 应用突然消失，没留下任何日志

WPF 默认在 UI 线程抛出未捕获异常时直接退进程，用户只看到窗口凭空消失。三个入口都要挂：

```csharp
DispatcherUnhandledException                // UI 线程
AppDomain.CurrentDomain.UnhandledException  // 其他线程
TaskScheduler.UnobservedTaskException       // 没有 await 的 Task
```

只有第一个能救，设 `e.Handled = true` 之后弹个提示框应用能继续跑；后两个进来时进程已经在往下走，能做的只有把堆栈写进日志。日志不用引框架，往配置文件所在目录追加一行时间戳加异常就行——绿色版跟着 exe 走，装到系统里就在 `%APPDATA%\Xxx\`。

三个入口都挂了、日志还是空的，就要考虑第四种消失：**它不是异常，是某处代码正常地调了 `Shutdown()`**——异常处理器一个都不会响。临时给关闭事件挂个栈探针，让肇事者自报家门：

```csharp
Dispatcher.ShutdownStarted += (s, e) =>
    File.AppendAllText(log, "ShutdownStarted:\r\n" + Environment.StackTrace + "\r\n");
```

实测用它点过一个藏得深的名：语言下拉的初始化赋值被 `SelectionChanged` 判成「用户切了语言」，应用按设计重启自己——每一步都是正常逻辑，合起来就是进程静默消失。两个配套事实：`Shutdown()` 可以被排进调度队列延后执行，引爆点（一次消息泵）可以离调用点很远，栈探针抓的是引爆时刻、顺着 `DispatcherOperation` 能找回排队方；Application 开始关闭之后 `Window.Show()` **静默空转**（不抛、hwnd=0、尺寸全零），所以下游症状可能完全不像「退出」，倒像「窗口坏了」。

## 绿色版把配置写到了盘符根目录

单文件发布下 `Assembly.Location` 返回空字符串，拿它拼 exe 同级路径会落到盘符根目录。要用 `AppContext.BaseDirectory` 或 `Environment.ProcessPath`，写开机自启的注册表项时同理。

## 扫用户目录，一处读不了就颗粒无收

做「从开始菜单挑一个程序」这类功能时踩的，上线过一次。选择器打开是空的，提示「一个快捷方式都没找到」，而那台机器上实际有 377 个。

原因是 `Directory.EnumerateFiles(path, pattern, SearchOption.AllDirectories)` 这个重载走的是**兼容选项**：`IgnoreInaccessible = false`、什么属性都不跳。而两处开始菜单根目录下都躺着一个拒绝访问的旧版本地化联结（简中系统上叫「程序」，指向 `Programs`），撞上它整根抛 `UnauthorizedAccessException`。我外面那句 `catch { continue; }` 又是按「根目录」为粒度写的，于是「有一个子目录读不了」被升级成了「这台机器没有开始菜单」。

新代码扫用户目录树一律走 `EnumerationOptions` 重载：

```csharp
new EnumerationOptions {
    RecurseSubdirectories = true,
    IgnoreInaccessible = true,   // 读不了的跳过去接着走，而不是掀桌子
    // 一旦设了这个属性，默认的 Hidden|System 就不再自动生效，要显式写全
    AttributesToSkip = FileAttributes.Hidden | FileAttributes.System | FileAttributes.ReparsePoint,
}
```

`ReparsePoint` 那一项顺带解决第二个问题：那个联结只是 `Programs` 的另一个名字，跟进去等于把整棵树数两遍。

更一般的教训是 **catch 的粒度**。把 try 套在「整个根目录」上，任何一个叶子的失败都会让整根消失；而这类批量扫描的正确姿势是让失败停在它自己那一层。同一个形状后来又出现过一次：枚举 shell 命名空间时个别条目取属性会抛（正在安装或已损坏的包），逐条 try 才不会让一个坏条目带走整份列表。

## 要启动的应用没有 exe 路径，也没有快捷方式

打包 / Store 应用（便笺、画图、电脑管家这一类）不以文件形式存在。本机 419 个开始菜单条目里有 85 个是这种，用户既挑不着也没法手填，因为它们没有路径可填。

它们能被 `ShellExecute` 启动，写法是 `shell:AppsFolder\<AUMID>`（实测可用，执行侧一行不用改）。名字和 AUMID 从 shell 命名空间里枚举：

```csharp
dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
foreach (dynamic item in shell.NameSpace("shell:AppsFolder").Items())
{
    string name = item.Name;      // 显示名
    string aumid = item.Path;     // 打包应用形如 Family!AppId
}
```

三个实际会咬人的细节：

- **先扫 `.lnk`、后补 AppsFolder，顺序不能反。** 经典程序两边都有，而快捷方式带着参数、工作目录和图标，比一串 AUMID 完整得多；反过来几百个经典程序会被 AUMID 版本先占住名字。按显示名去重即可，AppsFolder 只补那些 `.lnk` 里没有的。
- **AppsFolder 里混着 `.url` 条目**，它们的「AUMID」本身就是一条网址。套上 `shell:AppsFolder\` 前缀只会做出一个打不开的目标；含 `://` 就原样当网址用。
- **这串东西不是路径也不是 URL**：`Path.IsPathRooted` 认不出（冒号在第 6 位不是第 2 位），从它也推导不出进程名——所以「已在运行则激活窗口」这类优化会自动空转，正好是想要的。

顺带一提，执行侧本来就没有后缀白名单：`UseShellExecute = true` 意味着凡是资源管理器双击能打开的都能开（exe、bat、lnk、文档、文件夹、`ms-settings:` 这类协议、有关联的脚本）。唯一需要特判的是 `.ps1`——它的默认关联是**编辑**不是运行，直接 ShellExecute 会打开记事本，得显式 `powershell.exe -File`。所以「支持的后缀太少」这种反馈，多半问题不在后缀。

## 德语界面上控件被挤没

同一个界面，中文标签短，德语和俄语能长出一倍，容器选错就会有控件被挤没。

| 容器                    | 给子元素的可用宽度 | 宽度不够时                         |
| ----------------------- | ------------------ | ---------------------------------- |
| StackPanel（水平）      | 无限               | 子元素永不换行，超出部分被上层裁掉 |
| DockPanel               | 按声明顺序递减     | 最后停靠的元素可能一点宽度都拿不到 |
| Grid 的 `*` 列          | 按剩余空间分配     | 正常收缩，配合 TextTrimming 截断   |
| Grid 同一格放多个子元素 | 各自拿满整格       | 并列元素互相重叠                   |
| WrapPanel               | 放不下就换行       | 按钮组不会互相挤没                 |

水平 StackPanel 传给子元素的可用尺寸是 `double.PositiveInfinity`，子元素被告知想多宽都行，`TextBlock` 于是永远不会换行。所以控件模板里如果用水平 StackPanel 包住 `ContentPresenter`，这个控件的文字标签在全应用范围内都不可能换行，外面套多少层 Grid 都没用。DockPanel 则按声明顺序分配，三个 `Dock="Left"` 的按钮加一个 `Dock="Right"` 的关闭按钮，标签一长关闭按钮就只剩几个像素。

规则是：一行里只要有必须可点的东西，就用 Grid 的 `Auto` 列先把它的宽度锁住，剩下的交给 `*` 列去截断或者交给 WrapPanel 去换行。

**但对「打开选择器」那类按钮，有个更便宜的解法：不给它文字。** 表单行末尾那颗「浏览…」按钮是最典型的受害者——中文三个字，德语是 `Durchsuchen…`、俄语 `Обзор…`，宽度差四倍，而它正好排在行尾、后面就是滚动条，于是德语下被整个裁掉、点都点不着。改成只画一个「…」（Windows 上「点开会弹选择框」的通用记号）之后，**整行所有元素都变成定宽、与语言无关**，从根上不会再溢出——比把十几行重构成 Grid 便宜得多，效果一样。文案挪到 `ToolTip` 和 `AutomationProperties.Name`，鼠标停一下能看到，读屏软件照样念得出来。

写这个样式时有一个静默陷阱：**具名 Style 不会自动继承隐式样式**。

```xml
<Style x:Key="PickerButton" TargetType="Button" BasedOn="{StaticResource {x:Type Button}}">
```

漏掉 `BasedOn` 那一句，按钮会掉光配色和模板，变成系统默认的灰按钮——而且它不报错，只是长得不对。

顺带一条同类的间距问题：滚动区里的内容默认会一直铺到滚动条跟前，定宽控件还剩点余量，那些换行的说明文字（只有左边距、没有宽度）则正好顶在滚动条上。修法是给 `ScrollViewer` 加 `Padding`——默认模板把它落到内容承载器的 `Margin` 上，而滚动条在另一个网格列里，所以它正好只撑开这条缝，不影响滚动条本身。

**这条规则可以机械化，别只当成 review 要点。** 判据是纯结构的，扫 XAML 就能查：

> `TextWrapping="Wrap"` 的 `TextBlock`，若父容器是水平 `StackPanel` 或 `WrapPanel`
> （两者给子元素的可用宽度都是无限），而它自己**既没有 `Width` 也没有 `MaxWidth`**
> —— 那么换行永远不会发生，写的那个 `Wrap` 是一句空话。

第三个条件是关键，第一版规则没有它，在一个真实应用上命中 **64 处、全是误报**：
那些是表单字段标签，写着 `Width="90"`，宽度由自己钉死，换行本来就正常。补上
「既无 `Width` 也无 `MaxWidth`」之后只剩 1 处，而那一处是真的——一句德语 109 字的说明，
在横向滚动的编辑器里会把整窗内容往右推。

这一类值得机械化的理由和上面那些一样，是它同时躲过三道防线：中文文案短，一行放得下，
看不出来；出事的那一行可能没有任何截图状态会渲染到（见 `dev-switches.md` 的第二个盲区）；
而源码里它长得完全正常——**写着 `TextWrapping="Wrap"`，看上去已经处理过了**。

顺带一提，真正的正解仍然是把它放进 `Grid` 的 `*` 列交给布局量宽度。那种写法父容器宽度有限，
压根不会被这条检查看到；`MaxWidth` 只是在「父容器测量宽度真的是无限」时（比如开了横向滚动的
`ScrollViewer`）的唯一解。

还有一个反直觉的组合要避开。给带 `TextTrimming` 的 `TextBlock` 加 `MinWidth`，会让它的测量宽度超过所在单元格，负责截断的主体就从 TextBlock 变成父容器的裁剪。TextBlock 自己截断是从文本末尾切并补省略号，父容器裁剪只按流向切掉超出部分。左到右布局下切的是尾巴看不出问题，阿拉伯语这种右到左布局下切掉的是字符串开头，而且没有省略号。

## 切了语言，日期还是英文格式

**WPF 的绑定做日期和数字格式化时不看 `CurrentCulture`，看的是元素上的 `Language` 属性，而它的默认值写死是 en-US**。想让日期数字跟着界面语言走，启动时、**建第一个窗口之前**补一句（`OverrideMetadata` 晚调不报错，但官方文档明说实例存在后再改元数据"行为会不一致"；重复调则直接抛 `ArgumentException`，所以也别放进会跑多遍的路径）：

```csharp
FrameworkElement.LanguageProperty.OverrideMetadata(
    typeof(FrameworkElement),
    new FrameworkPropertyMetadata(
        XmlLanguage.GetLanguage(CultureInfo.CurrentCulture.IetfLanguageTag)));
```

但先想清楚要不要跟。另一条同样成立的取舍是**文案跟界面语言、日期数字跟系统区域**——只设 `CultureInfo.DefaultThreadCurrentUICulture`（注意 `Thread.CurrentThread.CurrentUICulture` 只对当前线程生效，之后新起的线程不跟），格式化完全不动。用户系统里日期长什么样，应用里就长什么样，比跟着界面语言跳更少被问「格式怎么变了」。走这条路线就不要加上面那句 override。两条路线选一条，整个应用保持一致。

阿拉伯语这类右到左的语言，`FlowDirection` 可以在启动时 `FrameworkElement.FlowDirectionProperty.OverrideMetadata(typeof(Window), …)` 一次设到所有窗口。但有三类东西继承不了，得逐个控件过：硬编码的单边 `Margin="0,0,8,0"`、有方向性的图标（箭头和播放键要镜像）、写死的 `TextAlignment="Left"`。

## 测试工程引用 App 就报 NETSDK1151

`RuntimeIdentifier`、`SelfContained`、`PublishSingleFile` 这几个属性要写进 `Properties/PublishProfiles/` 下的 pubxml，别写进 csproj。

写进 csproj 有两个后果。一是日常的 `dotnet build` 和 `dotnet run` 也会走 RID 专属加单文件加压缩的路径，开发时每次构建都白等。二是自包含的可执行工程不能被别的工程引用，测试工程一旦 `ProjectReference` 到它就直接报 `NETSDK1151`，而 xunit.v3 的测试工程恰好也是 exe。实际就这么撞上过一次，只能先把发布属性搬进 pubxml 才能继续迁测试框架。

两份 profile 之间有三处容易抄错：`EnableCompressionInSingleFile` 只对自包含成立，框架依赖传它会以 `NETSDK1176` 直接失败；`PublishDir` 要给不同目录，否则两种发布连着跑会互相覆盖；`IncludeNativeLibrariesForSelfExtract` 在框架依赖那份里没有意义，那个 bundle 里根本没有运行时原生库可打包，它不报错所以能一直躺着误导人。

## 开了 ReadyToRun 反而更慢

压体积别往 `PublishTrimmed` 和 NativeAOT 上想，[微软官方文档](https://learn.microsoft.com/dotnet/core/deploying/trimming/incompatibilities)写得很直接：WPF 大量用反射，裁剪后几乎跑不起来，所以 .NET SDK 里 WPF 的裁剪支持是关闭状态。剩下的就只有 `EnableCompressionInSingleFile` 和 `PublishReadyToRun`，后者默认别开。

压缩那个也别当免费午餐：[官方文档](https://learn.microsoft.com/dotnet/core/deploying/single-file/overview#compress-assemblies-in-single-file-apps)明说「压缩有性能代价，启动时程序集要解压进内存」，并建议**开之前把体积和启动时间都量一遍**，因为影响因应用而异。自包含那份为了「下载即用」值得付，框架依赖那份本来就小，付了未必划算。

体积这一半是确定的，它是编译产物，量一次就是一次：

| 发布形式       | 加 R2R 前后    |
| -------------- | -------------- |
| 框架依赖单文件 | 1.28 → 1.73 MB |
| 自包含单文件   | 72.4 → 77.7 MB |

时间那一半我量了两次都没测出可信的差。原始数据长这样：

```
不带 R2R : 1307 / 980 / 931 / 906 ms
带 R2R   : 1118 / 890 / 890 / 876 ms
```

第一次都要丢掉，单文件发布首次运行要把原生库解压到 `%TEMP%`，那是一次性成本。但丢掉之后，不带 R2R 那列还在往下走（980 → 931 → 906），带 R2R 那列已经走平（890 → 890 → 876），前者的文件缓存根本没热完，两列差距里有多少属于 R2R 分不开。所以测法上有两条硬要求：**首次运行必须丢弃，后面的样本要一直跑到数列走平为止**。

判断规则倒是清楚的：两种发布形态里 .NET 框架程序集本来就是预编译的原生映像，R2R 能作用的只有应用自己那点代码，效果几乎完全取决于「你的代码占启动路径的多大比例」。而托盘小工具的启动大头是进程创建和 WPF 图形栈初始化那两块地板价，自己的代码占比很小，默认关掉是安全的。

真要开也不必两份 profile 一起开：框架依赖那份开、自包含那份关是合理组合，理由是代价不对称——一边 +478 KB 无所谓，另一边 +5.3 MB，而自包含版的卖点正是「下载即用」。一个开关在两份 profile 里取不同值时，把数字和理由写进 pubxml 的注释，否则半年后没人知道当初为什么不一致。

## 文档里的体积数字，发两版就对不上了

README 和 release notes 里写「自包含版约 68 MB、精简版约 1.5 MB」，读着很贴心，但它会过期：加个依赖、换个 SDK 小版本，数字就变了，而没人会记得回头改十几个语言版本的 README。

真正该问的是这个数字有没有增量信息。GitHub 的资产列表本来就把确切大小显示在每个下载按钮旁边，文档里再写一遍，等于用一个会腐烂的副本去覆盖一个永远准确的原件。

所以保留判断依据、去掉绝对数字：读者要的是「一个大、一个小得多，小的那个需要先装运行时」，这个对比长期成立。想给准确值就指路，写一句「各个包的确切大小，发布页上有」。清理一次的代价很具体：一个多语言仓库里光是嵌在句子里的就有三十多处，还得按各语言语法逐条重写（德语的 `ein 0,5-MB-Download`、土耳其语的 `0,5 MB'lık` 都不能机械替换）。**一开始就别写进去，比事后清理便宜得多。**

（本页那张 R2R 体积表是例外：它是同一份构建开关前后的**增量对照**，用来判断值不值得开，不是发给用户的包体大小。）

## 版本号发出去还是上一版

发布物的版本号别写死在 csproj 里，手写的字面量一定会忘记改。从 git tag 取：

```xml
<Target Name="VersionFromGitTag" BeforeTargets="GetAssemblyVersion"
        Condition="'$(Version)' == '$(VersionFallback)'">
  <Exec Command="git describe --tags --abbrev=0" ConsoleToMSBuild="true"
        IgnoreExitCode="true" StandardOutputImportance="low">
    <Output TaskParameter="ConsoleOutput" PropertyName="_GitTag"/>
    <Output TaskParameter="ExitCode" PropertyName="_GitTagExit"/>
  </Exec>
  <PropertyGroup Condition="'$(_GitTagExit)' == '0'">
    <Version>$(_GitTag.TrimStart('v'))</Version>
  </PropertyGroup>
</Target>
```

那个 `Condition` 是承重的，不是保险。**Target 内部的 PropertyGroup 会覆盖命令行传进来的全局属性**，少了这道判断，CI 里 `-p:Version=1.3.2` 会被 target 读到的旧 tag 顶掉，打 v1.3.2 的标签反而发出标着上一版号码的 exe。

`IgnoreExitCode` 也别写成 `ContinueOnError`，后者只是把失败降级成警告，仍然每次构建刷两条 MSB3073，而仓库里没有 tag 是 CI 的常态，浅克隆默认就不带 tag。CI 里记得给 checkout 加 `fetch-depth: 0`，否则拿不到 tag。

## XAML 写错了却一路带到发版

WPF 的 XAML 是懒加载的，某个窗口的 XAML 写错，只要不打开那个窗口就不会报错。给每个应用加一个 `--smoke` 开关：构造并布局每一个窗口，然后退出，放进 CI 跑。配套的 `--shots` 把每个窗口按主题 × 语言 × 工作区高度离屏渲染成 PNG 逐张比对。两个开关的实现、CI 判定和放置位置（单实例互斥锁之前），见 `dev-switches.md`。
