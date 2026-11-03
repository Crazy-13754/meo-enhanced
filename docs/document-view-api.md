# 独立扩展接入：只读文档视图（API v1）

当前接口用于将整篇 Markdown 投影为一个可选视图，首个使用者是独立的 MEO Mind Map。它不提供正文内代码块渲染、文档编辑事务或双链索引接口；这些能力有实际需求时再增加。职责归属遵循[扩展边界规则](extension-boundaries.md)。

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

`id` 只允许英文字母、数字和连字符；同一扩展内不可重复。`entry` 必须是扩展 `dist/` 下的 JavaScript 文件，打包为浏览器可加载的 ES module。主编辑器只发布注册信息，用户首次打开视图时才加载模块。注册返回的 disposable 用于移除入口、关闭活动视图并撤销资源根目录。未安装扩展时没有入口，也不加载它的运行资源。

可选的 `iconPaths` 使用 24×24 坐标系内的单色 SVG path 数据；主编辑器统一控制颜色、实际图形尺寸、居中、固定名称提示和启用背景。确有光学校正需求时可提供 `iconOffset`，每个轴最多 ±1px。

## 渲染模块契约

模块导出 `apiVersion = 1` 和 `mount(container, context)`，返回 `DocumentViewInstance`。

| 接口 | 约定 |
| --- | --- |
| `update({ text, revision })` | 接收完整文档快照，只读。更新按顺序执行，编辑期间合并中间变更；revision 用于区分当前实例的快照，不是文档保存版本。 |
| `context.revealLine(line)` | 请求定位到正文的 1 起始行；主编辑器按当前模式定位。全屏视图会切到分栏，保留视图。 |
| `context.selectionChanged(line \| null)` | 通知当前选中内容对应的源码行；主编辑器据此启用正文定位按钮。文档更新时选择失效。 |
| `revealLine(line)`（可选） | 接收正文阅读位置，定位扩展内对应内容；扩展负责节点映射、折叠与选择。 |
| `actions`（可选） | 扩展提供英文 `label`、中文 `labelZh`、图标和执行回调。主体按当前语言呈现，并在切换时刷新。 |
| `setLanguage(language)`（可选） | 主体在语言切换时调用，扩展更新内部状态文案及无障碍名称；不解析文档、不重置视图状态。首次语言通过 `context.language` 提供。 |
| `context.getAvailableViewport()`（可选） | 返回容器坐标系中的可用 CSS 像素矩形，扣除浮动工具栏及安全间距。适应画布时重新读取；缩放计算属于扩展。 |
| `dispose()` | 释放 Worker、事件监听、观察器、异步请求和渲染器。关闭后迟到的异步结果不得重建界面或定位正文。 |

扩展只管理传入容器中的内容，不查询或修改主编辑器的其他 DOM。样式限制在扩展自己的 class 范围内，使用主编辑器已有主题变量。脚本与依赖随扩展本地打包；VS Code Webview 中的 Worker 使用本地资源 fetch 后创建 blob Worker，释放时终止。

主体在容器作用域内提供 `--meo-view-background`、`--meo-view-foreground`、`--meo-view-muted-foreground`、`--meo-view-hover-background`、`--meo-view-visible-background`、`--meo-view-border` 和 `--meo-view-focus`。这些变量随当前正文配色、Preview 预设和高对比度设置更新。默认内容使用这套角色，公共工具栏继续使用 `--meo-ui-*`；不缓存变量的初始计算值。完整规则见[扩展的语言与配色](ui-design-guidelines.md#扩展的语言与配色)。

这是供可信、已安装 VS Code 扩展使用的协作接口，不是执行不可信第三方脚本的沙箱。Markdown 中的脚本、事件属性及任意外部资源由渲染扩展自行限制；主编辑器不负责理解扩展语法。

## 当前公共交互

- 点击入口默认在正文右侧、目录左侧打开；同一入口再次点击关闭。
- Source 模式下，扩展视图与侧边预览共用侧边区域，同一时刻只显示一个。
- 全屏与分栏共用底部居中的单行浮动工具栏；关闭和 Escape 都直接关闭，不自动恢复先前的侧边预览。
- 分隔线上的两个按钮执行一次性定位，复用正文已有定位能力；不建立持续滚动绑定。
- 从扩展主动定位 Preview 时，复用已有源码映射，将目标放在视口上部约 30% 的位置，并短暂显示位置标记，不切换编辑模式。原有侧边预览同步继续使用最小移动策略。
- 内置侧边预览保留原来的控制方式，不因安装扩展增加固定标题栏。

## 开发与验证

独立构建扩展后，在主编辑器项目选择 `Run with Markmap`，输入扩展目录。此调试配置构建主编辑器，并同时加载两个扩展；扩展自身修改后需要单独重新构建。

主编辑器注册、资源根目录及协议检查：

```shell
bun scripts/test-document-views.ts
```

真实主编辑器与导图渲染器的隔离浏览器联调（PowerShell）：

```powershell
$env:MEO_MARKMAP_DIR = '<独立导图扩展目录>'
bun scripts/test-document-views-browser.ts
bun scripts/test-document-views-browser.ts --dark --english
```

覆盖未安装时无入口、按需加载、侧边预览互斥、分栏和全屏、文字及空白处拖动、双向定位、底部工具栏、适应画布避让、正文更新和关闭释放。该测试不替代 VS Code 内安装 VSIX 后的实际激活验证。

两个项目分别打包 VSIX，主编辑器不包含 Markmap 依赖。体验安装时先安装支持此 API 的主编辑器包，再安装导图包；仅安装导图包到尚无此 API 的旧版主编辑器上会激活失败。
