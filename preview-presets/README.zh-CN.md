# 自定义预览预设配置指南

[English](README.md) · 简体中文

每套预设由一个 UTF-8 JSON/JSONC 配置文件和一至三个 CSS 文件组成。JSONC 可以写注释和尾随逗号。预设用于独立 Preview、分屏 Preview，以及 HTML/PDF 导出；Word 使用现有固定导出格式。Live/Source 编辑界面继续使用编辑器外观。

## 快速开始

1. 复制 [纸页笔记示例](examples/paper-notes/)（浅色与深色）或 [GitHub 纸页示例](examples/github-paper/)（仅浅色）。保留配置所引用的 CSS 文件。
2. 修改 `id`、`name`、`description` 和 CSS。保留 `id` 可更新同一预设，修改 `id` 会创建另一套预设。
3. 在 Preview 的“预览预设”下拉菜单最底部点击“自定义预设…”，进入“设置 → 预览预设”，点击“导入预设”，选择包含 `preset.jsonc` 或 `preset.json` 的文件夹。文件夹根目录只能有一个上述配置文件。命令面板的 **MEO Enhanced：管理自定义预览预设** 也会打开这页。
4. 导入成功后预设默认启用，当前预览保持原选择。回到预览工具栏选择新预设。双主题支持自动 / 浅色 / 深色；单主题的切换控件保持显示但禁用，悬停会说明支持范围。
5. 查看实际预览后导出 HTML/PDF。原 CSS 修改后需重新导入文件夹；相同 ID 会请求确认更新，失败时保留旧版本。

## 内置风格的标准示例

五套内置风格都有可直接导入的示例文件夹，每个文件夹包含 `preset.jsonc` 和它引用的全部 CSS：

| 示例文件夹 | 主题 | 基础样式 |
| --- | --- | --- |
| [默认](examples/default/) | 浅色、深色 | `default` |
| [GitHub README](examples/github-readme/) | 浅色、深色 | `github-readme` |
| [Typora Newsprint](examples/newsprint/) | 浅色 | `default` + `common.css`、`light.css` |
| [Typora Whitey](examples/whitey/) | 浅色 | `default` + `common.css`、`light.css` |
| [Obsidian Minimal](examples/obsidian-minimal/) | 浅色、深色 | `default` + `common.css`、主题 CSS |

复制所需的整个文件夹，修改 `id`、中英文 `name` 与 CSS，再按“快速开始”导入。导入的是自定义副本，不会替换内置预设。默认与 GitHub 示例的主题文件提供覆写入口，基础 CSS 由扩展继承；默认副本使用固定的基础配色，GitHub 副本继承阅读外观，Markdown 支持范围仍按自定义预设规则处理。

Source 分栏预览中的两个浮动按钮、选项菜单和下拉列表随预览文档配色更新；独立 Preview 的工具栏与菜单继续跟随编辑器主题。气泡提示在所有位置使用统一样式。

## 管理预设

- 内置预设始终启用，不能移除。
- 勾选自定义预设后，它出现在预览下拉菜单中。取消勾选仅隐藏菜单项，保留文件；使用该预设的已打开预览切回默认。重新启用不会自动切换预览。
- 每行信息图标与预览工具栏共用说明组件，只展示内容说明和必要的错误提示。相关差异直接写在说明中。管理页不显示“当前使用”标记。
- 每个自定义预设在信息图标后直接显示“导出”和“移除”图标。点击移除后，在图标下方的浮窗中确认。
- 导入复制经过校验的配置与引用 CSS，保留原始文件。更新保留已有的显示状态；首次导入默认显示。
- “制作指南”按当前 MEO 界面语言，在浏览器打开 GitHub 上的中文或英文指南。指南和示例只在本仓库提供，不随扩展打包；已导入的预设可以离线使用。小型配置 Schema 继续随扩展提供，用于离线补全与校验。

## 配置文件

```jsonc
{
  "schemaVersion": 1,
  "id": "paper-notes",
  "name": "纸页笔记",
  "description": "适合长文、笔记和代码阅读。",
  "base": "default",
  "controls": {
    "htmlComments": { "mode": "editable" },
    "codeColoring": { "mode": "editable" }
  },
  "styles": { "common": "common.css" },
  "themes": {
    "light": { "css": "light.css", "codeTheme": "light-plus" },
    "dark": { "css": "dark.css", "codeTheme": "dark-plus" }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 必填，当前为 `1`。 |
| `id` | 必填，稳定标识，最多 64 字符；小写字母开头，后续使用小写字母、数字或连字符。 |
| `name` | 必填，可使用字符串或 `{ "en": "Paper notes", "zh-CN": "纸面笔记" }`；每种名字最多 80 字符，随界面语言显示，缺少翻译时回退。名称相同的预设仍通过 ID 区分。 |
| `description` | 必填，内容说明与相关差异。可填字符串，或含 `en` / `zh-CN` 的对象；每种语言最多 500 字符。按界面语言显示，缺少翻译时使用已有版本；字符串在两种界面语言中原样显示。 |
| `base` | 可选，`default` 或 `github-readme`；继承固定的正文样式和浅／深色基础配色，不继承编辑器颜色，省略时使用 `default`。 |
| `controls.htmlComments` / `controls.codeColoring` | 可选，分别控制 HTML 注释和代码着色；省略时为可切换。 |
| `controls.fontFamily` | 可选，`{ "mode": "editable" }` 或 `{ "mode": "fixed" }`；省略时保持固定字体。开放后按预设记忆正文选择，空值恢复预设 CSS 字体。 |
| `styles.common` | 可选，两个主题共用的正文 CSS。 |
| `themes.light` / `themes.dark` | 至少提供一个；每个主题必须有 `css`。支持范围由实际条目决定。 |
| `codeTheme` | 可选，`light-plus`、`dark-plus`、`github-light-default`、`github-dark-default`；省略时，`default` 基础固定使用 Light+／Dark+，GitHub 基础固定使用 GitHub 浅／深色。只在代码着色开启时生效，不会自动开启或锁定着色。 |
| `author` / `version` / `source` / `license` | 可选的分享信息，仅随配置保存，不在说明气泡中展示；每项最多 500 字符。 |
| `$schema` | 可选，指向 [JSON Schema](preset.schema.json)，用于编辑器补全和校验；复制示例后需更新相对路径，或删除此字段。 |

`base` 只决定外观，不继承基础预设的设置规则。所有自定义预设使用 MEO 的 Markdown 渲染，包括换行、Alerts、任务列表和 HTML 注释处理；`base: "github-readme"` 使用 GitHub 外观，也可以显示注释。用户 CSS 按“基础样式 → common → 当前主题”顺序加载。内置默认与 GitHub 预设保持原有行为；内置 GitHub 仍固定隐藏注释、开启代码着色，导入样式不能覆盖它们。自定义预设之间不继承。

需要中英双语说明时，可以这样填写；只提供其中一种也有效：

```jsonc
"description": {
  "en": "For long documents and notes.",
  "zh-CN": "适合长文和笔记阅读。"
}
```

文件夹根目录的配置命名为 `preset.jsonc` 或 `preset.json`。使用 `$schema` 指定 Schema 可获得补全和校验。

预设字体与正文宽度由 CSS 定义。字体控件仅在 `controls.fontFamily` 为 `editable` 时开放；固定字体和正文宽度控件保留并禁用，悬停显示原因。主题支持由 `themes` 决定。主题、预设选择与可调整的字体选择按当前文档恢复。

### 配色归属

内置“默认”预设保留跟随编辑器主题的特性。GitHub 和自定义预设的文档颜色由预设自身决定：切换 VS Code 主题时，只有“自动”模式可能选择另一套浅／深色方案；同一明暗方案内的颜色保持固定。Preview 与 HTML/PDF 使用相同配色规则，工具栏、菜单和设置面板继续使用扩展的统一 UI 配色。

每套浅／深色 CSS 应集中定义页面背景、正文文字、标题、链接、代码背景、表格、引用与分割线。可以在预设内部使用 CSS 变量与 `color-mix()` 派生弱化文字、边线和次级背景；不要依赖 `--vscode-*` 或编辑器的语法颜色。未覆盖的颜色由所选基础的固定配色补齐，旧预设无需补充新字段即可继续导入。

`--meo-bg` 和 `--meo-code-bg` 分别控制页面与代码块背景；`codeTheme` 负责代码语法颜色，语法主题的背景不会覆盖 CSS 背景。建议在配置中明确填写 `codeTheme`，让制作和审查时可以直接看出每套主题使用的配色。完整的变量及派生写法见 [纸页笔记的浅色](examples/paper-notes/light.css) 和 [深色](examples/paper-notes/dark.css) 示例；GitHub 基础的局部背景仍需按下文选择器覆盖。

### 注释与代码着色

`controls` 支持 `fontFamily`、`htmlComments` 和 `codeColoring`。字体使用 `{ "mode": "editable" }` 开放按预设记忆的正文覆盖，或 `{ "mode": "fixed" }` 保留 CSS 字体；省略时保持旧版固定行为。选择“预设字体”恢复原始 CSS，其他选择在预设 CSS 后应用，不会修改默认预设的字体设置。代码排版仍由 CSS 定义。

注释和代码着色分别配置：

| 配置 | 行为 |
| --- | --- |
| 省略或 `{ "mode": "editable" }` | 控件可切换，使用用户当前设置。 |
| `{ "mode": "fixed", "value": true }` | 固定显示注释或开启代码着色。 |
| `{ "mode": "fixed", "value": false }` | 固定隐藏注释或关闭代码着色。 |

固定的注释和代码着色开关保留并禁用，悬停显示原因，点击后提示继续显示。只支持一个明暗主题时，主题控件也保留并禁用，悬停说明支持范围。固定值不会改写用户设置，切回可切换的预设后恢复用户的选择。`editable` 不接受 `value`；`fixed` 必须提供布尔值 `value`。这些规则同时应用于 Preview 与 HTML/PDF。

默认、GitHub、自定义预设使用同一套说明与控件规则；内置预设由扩展提供配置，不能被用户配置文件替换。气泡只展示内容说明和必要的错误提示，不附加控件规则、作者或许可等元数据。

导入、加载或渲染失败时，说明图标变红并显示错误详情。失败的更新保留上一版；启动时无法加载的预设会跳过并回退默认，在说明中列出加载错误。修正文件并成功重新导入后，相应错误会清除。原始文件与保存副本都不会自动监听，修改后需重新导入或重载窗口。

例如，注释可切换、代码着色固定开启：

```jsonc
"controls": {
  "htmlComments": { "mode": "editable" },
  "codeColoring": { "mode": "fixed", "value": true }
}
```

[纸页笔记](examples/paper-notes/) 展示两个可切换项和独立的明暗代码配色；[GitHub 纸页](examples/github-paper/) 展示可切换注释和固定开启着色。修改任一示例的 `controls` 后重新导入即可应用。

## CSS 的写法与范围

每条正文选择器都要以 `.meo-export-doc` 开头。多个选择器要分别加前缀，例如 `.meo-export-doc h1, .meo-export-doc h2`。支持普通 CSS、`@media`、`@supports`、`@layer` 块；嵌套选择器、`@import`、`@font-face`、`url()`、`image-set()` 和脚本不支持。字体使用系统已安装字体并提供回退。

`html`、`body`、`:root` 仅允许声明 CSS 变量，用于文档主题。正文运行在独立预览框架中，CSS 不会加载到编辑器工具栏、分段控件、气泡或侧边目录。

建议把布局放在 common，把颜色放在主题文件：

```css
/* common.css */
.meo-export-doc {
  max-width: 960px;
  padding: 32px;
  font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 16px;
  line-height: 1.75;
}
.meo-export-doc h1 { font-size: 30px; color: var(--accent); }
.meo-export-doc pre { font-size: 13px; padding: 12px 16px; }
```

```css
/* light.css */
:root {
  --meo-bg: #fafaf8;
  --meo-fg: #333333;
  --meo-code-bg: #eeefec;
  --accent: #28645b;
}
```

`--meo-bg` 同时决定预览画布、正文及导出页面底色。`--meo-fg` 决定正文文字，`--meo-code-bg` 用于默认基础的代码块。还可使用 `--meo-heading`、`--meo-link`、`--meo-muted`、`--meo-border`。GitHub 基础的代码背景等局部样式可通过 `.meo-export-doc pre`、`.meo-export-doc th` 等直接覆盖；其上游变量定义在 `.markdown-body` 中，根变量不一定能覆盖这些局部变量。

| 内容 | 推荐选择器 |
| --- | --- |
| 正文、段落、标题 | `.meo-export-doc`、`.meo-export-doc p`、`.meo-export-doc h1` 至 `h6` |
| 链接、引用、列表 | `.meo-export-doc a`、`.meo-export-doc blockquote`、`.meo-export-doc ul` / `ol` / `li` |
| 行内代码、代码块 | `.meo-export-doc code`、`.meo-export-doc pre` |
| 代码行文字 | `.meo-export-doc .meo-export-code-line-source` |
| 表格、图片 | `.meo-export-doc table` / `th` / `td` / `img` |
| 导出正文目录 | `.meo-export-doc .meo-export-toc` / `.meo-export-toc-title` / `.meo-export-toc-link` |
| 公式、图表容器 | `.meo-export-doc .meo-export-math-display`、`.meo-export-doc .meo-export-mermaid` |

代码语法颜色由 Shiki 生成，会带行内颜色；修改 `pre { color: ... }` 不会替换整个语法配色。需要固定配色时使用 `codeTheme`。基础样式可能对子元素设置字号，调整代码块时可同步设置 `.meo-export-code-line-source` 或 `pre > code`。公式使用 KaTeX，图表使用现有 Mermaid 渲染规则；内部节点选择器随渲染库变化，不作为稳定配置接口。

不要对公式内部元素做缩放或变换；这可能影响可见区域测量。正文保持响应式宽度，避免固定最小宽度。配置不能新增 Markdown 语法或执行 JavaScript。

### 迁移已有 CSS

把原来的 `body { ... }` 正文布局改为 `.meo-export-doc { ... }`，把 `h1`、`pre` 等选择器改为 `.meo-export-doc h1`、`.meo-export-doc pre`；全局 `*` 改为 `.meo-export-doc *`，并留意它也会影响公式和图表内部元素。多个选择器分别加前缀。背景和文字颜色优先放入主题文件的 `--meo-bg`、`--meo-fg`。

固定 `width: 800px` 建议改为 `width: 100%; max-width: 800px`，以适应窄面板；代码区域可以调整字号和内边距。导出目录使用上表中的 `.meo-export-toc` 系列选择器。已有 CSS 需要配套本页的配置文件再导入，不会直接作为全局样式加载。

## 保存、更新与分享

导入时会读取配置及引用的 CSS，通过全部校验后把完整副本保存到扩展的 `globalStorageUri/preview-presets/<id>/`。每套预设使用一个文件夹，包含可读的 `preset.jsonc` 和引用的独立 CSS 文件；CSS 保留原文本、注释和实际换行。配置保存为 2 空格缩进，读取时兼容单行 JSON 和带注释的 JSONC。导入、保存和导出的文件结构一致。

```text
preview-presets/
├── paper-notes/
│   ├── preset.jsonc
│   ├── common.css
│   ├── light.css
│   └── dark.css
└── github-paper/
    ├── preset.jsonc
    └── light.css
```

文件夹名使用稳定的 `id`，显示名称由 `name` 决定；CSS 的名称和子目录以配置引用为准。更新会先在临时目录中写入并复读校验整套文件，再切换正式目录；切换失败会恢复旧版，启动时会恢复未完成切换留下的完整旧目录。临时目录和备份不会作为预设加载。移除会清除正式目录及可恢复的旧版本，避免重启后重新出现。

开发阶段旧的单文件 `<id>.json` 会在读取时自动迁移，成功后原文件保存到 `.legacy/` 作为备份；迁移失败仍可读取旧预设。同一个 ID 已有正式文件夹时以文件夹为准，不会重复显示。损坏的旧记录不会被覆盖。

保存路径见上文。修改保存副本后，重新导入整个预设文件夹，或重新加载 VS Code 窗口以重新读取；没有自动监听。分享时使用管理页每行“更多 → 导出”获得完整文件夹，其他电脑可直接导入。备份时需要同时保留配置和所有引用的 CSS。

这些文件不写入当前项目，原导入文件移动或删除不影响已保存样式。重启和正常扩展升级后会重新加载，同一扩展运行环境中的工作区共享样式库。第一版不自动同步跨电脑、VS Code 配置环境或远程扩展环境的数据，其他已打开的 VS Code 窗口需重新加载才能读取新样式。

相同 ID 的重新导入经确认后更新已有预设，并保留显示状态；失败时原样式仍可用。移除仅删除保存副本，使用该预设的已打开预览会切回默认。打开时缺失的预设同样回退到默认；损坏的保存记录会提示并跳过。

配置与每个 CSS 文件最多 512 KiB，一套最多 2 MiB，最多保存 100 套。CSS 引用使用配置目录内的相对路径，路径段限英文字母、数字、下划线、连字符和文件名中的点；不支持绝对路径、父目录、符号链接或远程引用。导入错误会指出字段或 CSS 文件及原因。

## HTML、PDF 与 Word

默认、GitHub、自定义预设的 HTML/PDF 都使用导出开始时的实际预览预设、明暗主题和配色。自动主题会先解析为当前编辑器的实际明暗状态，导出过程中再切换主题或更新样式不会改变已捕获的导出。未打开 Preview 时也使用当前文档的预览配置。Word 沿用固定样式。

PDF 使用 A4，默认由编辑器统一保留四边 20 mm 页边距，预设无需配置。已有的显式页边距样式优先采用。宽表格、长代码和公式会按纸张适配；屏幕与纸张宽度不同，较长内容仍可能换行。

“含目录”会生成正文目录；编辑器侧边目录属于界面，不包含在导出中。交互式预览的复制按钮、搜索提示等同样不会导出。HTML 阅读设备没有所需字体时会使用 CSS 回退字体。

建议验收浅色、深色和窄面板，以及包含标题、目录、长代码、宽表格、中文、公式和 Mermaid 的 HTML/PDF；多页 PDF 检查每页的留白和内容完整性。也要切回内置默认和 GitHub，检查原有设置恢复。
