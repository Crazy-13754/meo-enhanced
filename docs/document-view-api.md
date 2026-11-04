# 独立扩展接入：只读文档视图（API v1）

当前接口用于将整篇 Markdown 投影为可选视图，也支持通过可选能力渲染正文代码块，首个使用者是独立的 MEO Extras。不提供文档编辑事务或双链索引接口。职责归属遵循[扩展边界规则](extension-boundaries.md)。

## 注册与加载

扩展在自己的 `package.json` 中声明 `extensionDependencies: ["huangko555.meo-enhanced"]`，激活后取得主编辑器 API：

```ts
const host = vscode.extensions.getExtension<DocumentViewsApi>('huangko555.meo-enhanced');
const api = await host?.activate();
if (!api || api.version !== 1 || typeof api.registerDocumentView !== 'function') {
  throw new Error('This extension requires MEO document view API v1.');
}
context.subscriptions.push(api.registerDocumentView(context.extension.id, {
  id: 'example',
  label: 'Example view',
  labelZh: '示例视图',
  entry: 'dist/view.js',
}));
```

接口类型以 [`src/documentViews.ts`](../src/documentViews.ts) 为准。独立扩展可以复制这份仅含类型的契约，并在接口变化时核对更新，无需引用主编辑器源码或安装其运行时依赖。

`id` 只允许英文字母、数字和连字符；同一扩展内不可重复。`entry` 必须是扩展 `dist/` 下的 JavaScript 文件，打包为浏览器可加载的 ES module。主编辑器只发布注册信息，用户首次打开视图时才加载模块。注册返回的 disposable 用于移除入口、关闭活动视图并释放实例。已授权的资源根目录保留至编辑器面板关闭，避免功能启停重载编辑器。未安装扩展时没有入口，也不加载它的运行资源。

## MEO Extras 功能管理

MEO Extras 是独立安装的可选功能集合，目前包括思维导图和 PlantUML。主编辑器的「设置 > 扩展功能」显示安装状态和实际登记的功能，开关保存为应用级 `meoEnhanced.disabledExtraFeatures`。关闭功能移除其入口和渲染实例，保留 Markdown 原文；重新开启恢复注册。

MEO Extras 使用 API v1 的可选 `registerFeature`，先检查该方法存在。功能说明独立于启用状态登记，激活回调返回负责释放该功能全部资源的 disposable：

```ts
context.subscriptions.push(api.registerFeature(context.extension.id, {
  id: 'mindmap', orderId: 10, label: 'Mind map', labelZh: '思维导图',
  description: 'Whole-document mind maps and embedded markmap blocks.',
  descriptionZh: '全文思维导图与文档内的 markmap 图块。',
}, () => api.registerDocumentView(context.extension.id, contribution)));
```

字符串 `id` 是稳定的功能身份，用于保存开关；数字 `orderId` 是可调整的显示顺序，按非负整数升序排列。缺省值排在最后，同值按字符串 ID 排序。Extras 在 `src/features.ts` 集中登记（导图 10、PlantUML 20），调整顺序不改变启用偏好。此生命周期入口目前只接受 MEO Extras，不是任意第三方插件市场。主编辑器拥有设置、持久化、启停和共用容器；Extras 按 `src/features/<feature>/` 组织实现，负责解析、渲染和资源释放。语言、主题、文档配色仍遵循公共扩展边界规则。

功能状态中的 `enabled` 表示用户选择，`active` 表示启用回调已返回注册资源，不表示 Webview 已加载渲染引擎。启用回调保持轻量，专属运行依赖放在独立视图模块或 Worker 中，由实际视图或图块使用触发加载。关闭必须释放运行实例；成功导入的模块缓存可能保留到对应 Webview 销毁。打包、分发与性能验证遵循[安装包与按需运行](extension-boundaries.md#安装包与按需运行)。

当前仅完成本地体验前置：安装按钮显示「尚未发布」，没有外部链接或下载行为。待 Extras 单独发布并核验安装页后再接入真实链接。旧开发版 `meo-mindmap` 与新包并存时优先新包，旧图块本地折叠记录迁移至新身份；这两处开发版兼容在本地迁移结束后可以删除。

「扩展功能」Tab 常驻：未安装时展示介绍与安装状态，安装后显示版本、打开本地扩展详情的「使用说明」入口及实际注册的功能开关。全部关闭仍保留功能列表；安装后未登记任何功能时提供刷新与检查启用状态的提示。不在主体预置未来功能开关。

各功能的启用选择、失败与资源释放相互独立，不处理功能间依赖。注册其他功能、操作其他开关或重复收到配置通知，不得重启正常功能或重试失败功能；启用失败仅在用户关闭后重新开启时重试。一个功能释放异常不能阻止其他功能清理。功能自身必须清理部分初始化产生的资源；主体记录失败，不替扩展猜测资源所有权。

可选的 `iconPaths` 使用 24×24 坐标系内的单色 SVG path 数据；主编辑器统一控制颜色、实际图形尺寸、居中、固定名称提示和启用背景。确有光学校正需求时可提供 `iconOffset`，每个轴最多 ±1px。

## 渲染模块契约

模块导出 `apiVersion = 1` 和 `mount(container, context)`，返回 `DocumentViewInstance`。

| 接口 | 约定 |
| --- | --- |
| `update({ text, revision })` | 接收完整文档快照，只读。更新按顺序执行，编辑期间合并中间变更；revision 用于区分当前实例的快照，不是文档保存版本。 |
| `context.renderContent(snapshot)`（可选能力） | 使用主体普通 Markdown 规则生成只读 `{ html }`，沿用现有解析、嵌套表格单元格和源码映射；不使用 Preview 预设。关闭会拒绝未完成请求，迟到结果忽略。 |
| `context.contentClass`（可选能力） | 将此 class 放到内容根元素上，消费主体的普通内容样式。扩展只补充节点宽度、折行等容器约束。 |
| `context.revealLine(line)` | 请求定位到正文的 1 起始行；主编辑器按当前模式定位。全屏视图会切到分栏，保留视图。 |
| `context.selectionChanged(line \| null)` | 通知当前选中内容对应的源码行；主编辑器据此启用正文定位按钮。文档更新时选择失效。 |
| `revealLine(line)`（可选） | 接收正文阅读位置，定位扩展内对应内容；扩展负责节点映射、折叠与选择。 |
| `actions`（可选） | 扩展提供英文 `label`、中文 `labelZh`、图标和执行回调。主体按当前语言呈现，并在切换时刷新。 |
| `setLanguage(language)`（可选） | 主体在语言切换时调用，扩展更新内部状态文案及无障碍名称；不解析文档、不重置视图状态。首次语言通过 `context.language` 提供。 |
| `context.getAvailableViewport()`（可选） | 返回容器坐标系中的可用 CSS 像素矩形，扣除浮动工具栏及安全间距。适应画布时重新读取；缩放计算属于扩展。 |
| `dispose()` | 释放 Worker、事件监听、观察器、异步请求和渲染器。关闭后迟到的异步结果不得重建界面或定位正文。 |

扩展只管理传入容器中的内容，不查询或修改主编辑器的其他 DOM。样式限制在扩展自己的 class 范围内，使用主编辑器已有主题变量。脚本与依赖随扩展本地打包；VS Code Webview 中的 Worker 使用本地资源 fetch 后创建 blob Worker，释放时终止。

画布光标由主体统一管理：默认箭头，主键移动超过 4 CSS px 才显示抓手；释放、取消、丢失捕获、失焦或关闭时恢复。文字与图形共用状态，静态 Preview 不进入拖动状态。扩展保留自己的平移引擎和异常结束清理，不另写光标状态机；允许点击折叠的节点圆点标记 `data-meo-graph-action`，主体显示指向手形，拖动时仍统一显示抓手。叶节点和不可操作的内联节点不标记。按钮、源码输入和分割线沿用各自控件的光标。

主体在容器作用域内提供 `--meo-view-background`、`--meo-view-foreground`、`--meo-view-muted-foreground`、`--meo-view-hover-background`、`--meo-view-visible-background`、`--meo-view-border` 和 `--meo-view-focus`。这些变量随当前正文配色、Preview 预设和高对比度设置更新。默认内容使用这套角色，公共工具栏继续使用 `--meo-ui-*`；不缓存变量的初始计算值。完整规则见[扩展的语言与配色](ui-design-guidelines.md#扩展的语言与配色)。

字体由主体提供 `--meo-view-font-family`、`--meo-view-font-size`、`--meo-view-font-weight` 和 `--meo-view-code-font-family`。前三者始终跟随普通文档（Live）的字体及用户字号，代码字体跟随文档的 Source 字体；不采用 Preview 预设的排版。变量实时继承，无须重新解析快照或重建视图。扩展负责字体变化后的内容测量和布局，保留选择、折叠、平移与缩放。公共工具栏仍使用界面字体。

首次打开的加载反馈由主体统一管理，与实时、源码和预览共用加载组件及 200ms 延迟显示规则。等待范围包括模块加载、首次 `update()` 和首帧；更新期间的新快照不会重新计时。关闭或卸载取消提示，迟到结果不得重新打开视图。已有画面的普通文档更新不显示加载遮罩，扩展不另建“正在更新”提示。扩展的 `update()` 应在渲染布局就绪后完成；空内容等结果状态仍由扩展呈现。

这是供可信、已安装 VS Code 扩展使用的协作接口，不是执行不可信第三方脚本的沙箱。Markdown 中的脚本、事件属性及任意外部资源由渲染扩展自行限制；主编辑器不负责理解扩展语法。

### 共享内容呈现

`renderContent` 在主体已有的后台渲染 Worker 中运行，与 Preview 共用普通 Markdown 渲染链路及有界队列。返回的是便于遍历的语义 HTML 树，不是 Preview 页面，也不包含编辑器 DOM。带位置的元素使用 `data-source-line`、`data-source-end-line`，均为 1 起始、两端包含的原文行号；布局包装元素可能没有位置，消费者可从其内容元素取得范围。

链接保留文字，图片保留替代文字；不读取文件或网络资源、不保留导航、事件、文档样式和交互控件。代码保留原文，公式复用主体扫描与 KaTeX，输出本地 MathML。HTML 注释以 `data-comment="true"` 的文本元素提供，消费者应从可见内容中移除；是否解释注释由扩展决定。Frontmatter 不作为正文呈现，扩展从快照读取自己的配置。

主体维护普通语义及基础样式，扩展维护自己的结构投影。例如导图将标题和列表组织成分支，表格、引用等复合内容保持完整，不能因后续子标题而丢弃此前正文。导图的分支线、节点间距、宽度、折叠、缩放及专属注释仍在独立扩展中。普通语法按主体规则呈现，不能继续通过另一套 Markdown 解析器补齐不同语义；有意支持的独有语法应单独说明边界。

这是 API v1 的增量能力，已有消费者不受影响。需要共享渲染的新消费者必须检查 `renderContent` 和 `contentClass` 是否存在；缺少时提示升级匹配的主体构建，不静默退回独立解析器。

## 当前公共交互

- 点击入口默认在正文右侧、目录左侧打开；同一入口再次点击关闭。
- Source 模式下，扩展视图与侧边预览共用侧边区域，同一时刻只显示一个。
- 图形视图的全屏与分栏共用底部居中的单行浮动工具栏。列表视图可通过 `DocumentViewInstance.headerActions` 提供标题行中的容器，主体将刷新、布局和关闭操作放入其中，不再添加重复的定位按钮。
- 列表筛选通过 `DocumentViewContext.createSelect` 使用主体下拉组件，主体负责浮层与生命周期。选项变化时调用 `refreshOptions`，仅值变化时调用 `syncFromSelect`，避免索引更新反复重建菜单。Escape 优先关闭展开的菜单，再次按下才关闭视图。
- 分隔线上的两个按钮执行一次性定位，复用正文已有定位能力；不建立持续滚动绑定。
- 从扩展主动定位 Preview 时，复用已有源码映射，将目标放在视口上部约 30% 的位置，并短暂显示位置标记，不切换编辑模式。原有侧边预览同步继续使用最小移动策略。
- 内置侧边预览保留原来的控制方式，不因安装扩展增加固定标题栏。

## 开发与验证

### 正文代码块

注册时可提供 `codeBlockLanguages: ['markmap']`，同一语言只能由一个扩展注册，不能覆盖 Mermaid、数学和 HTML 等内置渲染。模块另外导出 `mountBlock(container, context)`，返回同样的实例契约；整个文档的 `mount` 保持原有行为。未注册、扩展移除或旧主体不支持此能力时保留普通代码块。

只有代码块能力的功能使用可选的 `registerCodeBlockRenderer(extensionId, registration)`，必须提供非空 `codeBlockLanguages`。主体发布 `blockOnly: true`，不生成全文视图入口，也不要求模块导出 `mount` 或提供图标。功能目录、图形块和全文视图是独立能力；不要为了登记功能而增加无用途的按钮。

静态 SVG 提供者可导出 `createSvgRenderer(): DocumentSvgRenderer`，替代自行实现 `mountBlock`。每个实例提供 `render(snapshot, appearance): Promise<string>` 和 `dispose()`；返回具有有效尺寸的、已净化的 SVG，不得包含导航、事件、脚本或外部资源。`appearance` 包含语言、普通文档字体/字号、当前内容前景/背景及明暗状态。主体拥有 SVG 相机、尺寸上报、手势、图片复制与工具栏，复用 Mermaid 全屏相机；专属渲染引擎、语法适配、错误解释及 SVG 净化留在扩展。异步结果必须服从当前版本与实例生命周期。

主体仅在源码或渲染环境变化时请求新的 SVG。语言切换只更新公共控件；颜色或字体必须重新生成 SVG 时，保留已有镜头，不修改 Markdown。扩展按原文中的显式样式处理作者颜色。PlantUML 当前在本地 Worker 中渲染 `plantuml` / `puml`，不提供独立文件编辑器；外部 include、未打包标准库和图片资源不受支持，失败显示源码而不下载资源。

主体拥有代码块容器、原生源码编辑、加载/失败反馈、全屏、图片复制和环境刷新。Mermaid 与扩展图块共用编辑流程：Live 使用相同的编辑/完成图标、源码全选和复制、上下/左右对照布局、窄窗口回退、吸顶块头、Escape 和阅读焦点。源码始终属于主文档，使用同一撤销历史。这里的左右布局仅在当前代码块内，不打开全文导图侧栏，也不增加正文定位功能。Source 保留代码；Preview 正文为静态最终结果，块外使用与 Mermaid 相同的全屏、复制图片、复制源码操作。

扩展只负责内容投影、画布及节点操作，不创建另一套代码块工具栏或编辑器。主体通过 `mountBlock` 和 `update` 交付原文、通过 `dispose` 回收实例；输入更新合并进入现有派生工作路径，渲染失败仍保留原文并允许修改后重试。新增 PUML 等渲染器可复用这些接口，不需要修改源码编辑、工具栏、预览预设或全屏焦点管理。

`interactive` 区分允许查看手势的 Live/全屏与静态 Preview，`presentation` 区分 `inline` / `fullscreen`。块内滚轮继续滚动文档，全屏可以消费滚轮缩放。图形实例的 `actions` 使用 `zoom-in`、`zoom-out`、`fit` 表达现有画布能力；主体负责按钮图标、顺序、文案和位置，不能叠加两套手势处理。Mermaid 与静态 SVG 提供者的相机留在主体，Markmap 的节点和相机留在扩展；两条路径使用同一全屏生命周期和控件组件。

`context.interactive` 为 false 时不得启用内容点击、折叠、拖动和缩放；主体也会将静态内容置为 inert。正文块不显示内容悬停、选中或点击效果，Live 保留画布拖动与工具栏缩放，节点折叠仅在全屏启用。全屏也不显示内容悬停与选中效果，保留画布操作和节点折叠展开；`revealLine` 在块上下文中不执行导航。全屏共用底部单行工具栏，Escape/关闭直接退出；重新打开只恢复折叠并重新适应画布，不恢复平移、缩放。可用视口扣除工具栏和间距。

扩展通过可选的 `reportContentSize({ width, height })` 上报未缩放的图形尺寸。主体按当前宽度决定正文画布高度（上限 480 CSS 像素）；小图按实际内容收缩，不设固定最小高度。内部留白扣除共用容器已经提供的工具栏空间，尺寸计算与可用视口使用同一规则。全屏忽略上报尺寸；扩展不直接改变编辑器布局。正文导图适应画布时不放大超过原始尺寸。Preview 的图形容器复用 Mermaid 的背景、边框和圆角规则。

正文图块宽度变化时，主体重新计算容器高度；未被用户调整的画布按最新可用区域重新适应内容：放得下时保留正常阅读尺寸，放不下时才缩小。不能直接按新旧窗口宽度比例缩放已有相机，否则会与主体的内容尺寸规则脱节。此规则同时适用于 Live 和 Preview，不替换全文导图的侧边/全屏相机规则。

Live 的可选 `context.camera` 是由主体按既有块身份持有的临时对象。扩展在用户平移或缩放后，将 `{ scale, x, y }` 写入其 `value`：分别表示实际比例和画布中心对应的内容坐标；源码更新、重新挂载和编辑布局变化时恢复该视角。“重置”清除 `value` 并重新自动适应。它不序列化，不按源码文本跨块复用，也不传入 Preview 或全屏；静态 SVG 提供者由主体自动处理，无需实现相机。

Preview 外壳统一由主体铺底：默认预设使用代码块底色，其他预设默认透明，允许预设自己的 CSS 覆盖。扩展画布不重复铺底；内容配色仍按其实际所在表面的颜色计算，作者显式指定的图形背景保持有效。

`viewState` / `saveViewState` 仅保存小型 JSON 查看状态，由主体保存在当前文档 Webview 的本地 UI 状态中，不写入 Markdown。只有全屏保留查看折叠；正文块始终按作者配置呈现。当前以语言、起始行和源码指纹识别块，最多保留 100 条，每条最多 32 KiB；重新挂载已修改源码或移动起始行的块时按源码初始化，避免旧记忆覆盖作者配置。扩展只记节点键摘要和折叠值，不保存 HTML、源码或镜头位置。销毁时必须取消库内部动画、观察器、手势监听和 Worker；仅移除 DOM 不能结束进行中的画布动画。

复制图片使用正文静态结果的完整内容边界，保留源码定义的折叠，不使用全屏临时状态或视口裁剪。SVG 渲染器将完整结果组标为 `data-meo-image-content`，主体复用现有 SVG/公式图片生成和剪贴板流程。共享内容样式在隔离的 Shadow DOM 中应用；字体沿用普通文档，内容色取当前正文，操作按钮取界面色。

普通 Preview 预设（默认、Newsprint、Whitey、Obsidian Minimal）支持此能力；自定义预设按实际 renderer 处理。GitHub README renderer 保持代码块，与 GitHub 阅读语义一致。HTML/PDF/Word 导出通过下述静态图块接口生成图形；缺少导出能力或渲染失败时保留源码并提示。导出文件只保存静态产物，不加载独立扩展脚本。

示例：

````markdown
```markmap
---
markmap:
  initialExpandLevel: 2
---
# 项目计划
## 实现
- 主体接入
- 独立渲染
## 验证
- Live 与 Preview
- 浅色与深色
```
````

独立构建扩展后，在主编辑器项目选择 `Run with Markmap`，输入扩展目录。此调试配置构建主编辑器，并同时加载两个扩展；扩展自身修改后需要单独重新构建。

主编辑器注册、资源根目录及协议检查：

```shell
bun scripts/test-document-views.ts
bun scripts/test-document-content.ts
```

真实主编辑器与导图渲染器的隔离浏览器联调（PowerShell）：

```powershell
$env:MEO_EXTRAS_DIR = '<独立导图扩展目录>'
bun scripts/test-document-views-browser.ts
bun scripts/test-document-views-browser.ts --dark --english
bun scripts/test-document-views-browser.ts --content-only
bun scripts/test-document-views-browser.ts --loading-only
bun scripts/test-document-views-browser.ts --blocks-only
bun scripts/test-document-views-browser.ts --plantuml-only
bun scripts/test-document-views-browser.ts --graph-continuity-only
```

覆盖未安装时无入口、按需加载、侧边预览互斥、分栏和全屏、文字及空白处拖动、双向定位、底部工具栏、适应画布避让、正文更新和关闭释放。该测试不替代 VS Code 内安装 VSIX 后的实际激活验证。

`--content-only` 检查真实导图中的格式、节点与单元格边界、三种字体的动态切换、明暗主题下的文字对比度，以及切换字体后的视图状态保持。检查图片替代文字时使用本地拦截资源，不访问外部图片服务。

`--blocks-only` 检查共用上下/左右原生编辑、静态 Preview、全屏折叠、重新适应画布、运行中语言和字体切换、完整 PNG、常用预设及 GitHub 回退、作者配置优先和扩展移除。普通与实际启用 Markdown Worker 的大文档同时检查输入、撤销、Escape 和有界挂载。`--content-only` 还检查深浅主题、三种字体及多层引用的实际几何间距。

两个项目分别打包 VSIX，主编辑器不包含 Markmap 依赖。体验安装时先安装支持此 API 的主编辑器包，再安装导图包；仅安装导图包到尚无此 API 的旧版主编辑器上会激活失败。

`--plantuml-only` 使用 Extras 正式构建的 Worker，检查无多余入口、按需加载、常见 UML 类型、中文、原生源码编辑和撤销、语法错误恢复、普通与大文档、静态 Preview、预设回退、响应式尺寸、全屏与 PNG 复制。静态 SVG 相机改动还需运行 Mermaid 控件专项，避免共享能力回归。

`--graph-continuity-only` 对真实 PUML 和导图检查普通／大文档的源码刷新、双向编辑布局切换后缩放与中心坐标保持，以及默认与阅读预设下和 Mermaid 一致的外壳底色。


## 工作区文档与列表视图

主体支持 `supportsWorkspaceDocuments` 时，视图可以声明 `workspace: true`，通过 `DocumentViewContext.workspace` 发现当前文档／工作区文件、读取共享 Markdown 列表结构、请求来源定位和受校验文本编辑。`presentation: 'list'` 关闭图形拖动反馈，保留共同分栏、全屏及关闭控件。

快照的 `version` 是主体生成的内容身份；旧的 `DocumentViewSnapshot.revision` 仍只是视图更新序号，不能用于编辑校验。`edit` 必须提供来源 URI、快照 version、LF 规范化偏移、预期原文和替换内容；主体与目标编辑器分别核验，失配时拒绝并刷新。`onDidChange` 的 URI 表示单文件失效，缺省表示文件目录或范围变化；关闭视图使接口失效并释放监听。列表提取复用既有后台解析，不生成完整 HTML、不读取外部资源。

能力、保存与历史归属、工作预算和验证说明见 [任务总览接入](task-overview.md)。

## 正文图块静态导出

导出复用 `codeBlockLanguages` 注册，主体不按扩展 ID 或专属语言增加分支。静态 SVG 模块的 `createSvgRenderer()` 自动用于导出；需要 DOM 布局的模块可提供 `createBlockExportRenderer(context)`，返回 `render(snapshot)` 与 `dispose()`。两种方式最终产生 `DocumentBlockExportArtifact`：`kind` 为 `svg` 或 `png`，`data` 分别为完整 SVG 字符串或不含 data URL 前缀的 PNG base64，`width` / `height` 为未缩放的 CSS 像素尺寸。优先返回 SVG，主体统一处理 HTML/PDF 和 Word 图片转换。

`DocumentBlockExportContext` 提供附着且隔离的测量容器、目标外观、普通 Markdown `renderContent` / `contentClass`、取消信号和 `captureSvg`。`captureSvg` 固化计算样式，按 `data-meo-image-content` 内容组计算边界并移除相机变换。模块只管理自己的容器，复用已有语义与布局；不读取交互视图 DOM、查看记忆或当前文档。`render` 完成时布局必须就绪，`dispose` 必须可重复调用并停止 Worker、动画与观察器；取消后不得重新挂载内容。

产物由扩展净化，禁止脚本、事件、导航和外部资源。主体额外检查类型、尺寸、有效 SVG 和危险资源；SVG 以独立 image data URL 嵌入，防止图块间 CSS 与 ID 冲突。第一版 SVG 不接受 image 元素，含位图的渲染器可返回 PNG。单个产物最多 16 MB 字符，单次产物总量最多 32 MB 字符，边长最多 100,000 CSS px；单次最多 1,000 个图块。图块串行渲染，单个异步阶段最多 20 秒，总任务最多 5 分钟；关闭编辑器或任务超时取消并释放实例。超过整体限制使本次导出失败，不生成不完整文件。

正文和注册目录在导出开始时冻结。主体从同一 Markdown 渲染链路的 fence 标记收集所有图块，包含未进入视口的图块、嵌套引用和列表以及重复源码；导出期间继续编辑不影响本次结果。HTML/PDF 采用目标预设的颜色，普通图块字体仍跟随普通文档；Word 使用固定浅色文档环境。GitHub README renderer 保留源码。Markmap 按作者初始折叠呈现，不采用临时全屏折叠或相机状态。

缺失导出能力、单图语法或渲染错误保留该处源码并报告语言和位置；缺少扩展或功能关闭时仍按普通代码块导出。新增图块只需在扩展中登记语言并提供上述一种渲染能力，无需修改主体 HTML/PDF/Word 导出流程。主体与 Extras 的类型副本需同步；旧模块仍可阅读，缺少可选导出方法时保留源码。

验证：`bun scripts/test-block-export.ts` 检查嵌套/重复图块、原文保留、协议和生命周期。设置 `MEO_EXTRAS_DIR` 后运行 `bun scripts/test-block-export-browser.ts`，使用真实 Extras 和第三种测试渲染器生成 HTML、PDF、Word，并检查浅深配色、复杂节点、图片嵌入和容器释放。契约测试纳入常规 `test:unit`；浏览器联调登记为独立专项，因为它依赖另行构建的 Extras。
