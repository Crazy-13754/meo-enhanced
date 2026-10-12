# GitHub README 支持边界校准

2026-10-12 对现有预设进行了双向兼容性检查：既检查 GitHub 支持的内容，也检查它会过滤或保留为文字的内容。本轮完成常规语法和 HTML 清理规则的修正，**尚不能把整个预设验收为与 GitHub 完全一致**。

## 证据与范围

先检索 [GitHub markup 的渲染流程](https://github.com/github/markup#readme)、[GFM tagfilter](https://github.github.com/gfm/#disallowed-raw-html-extension-) 和 [HTML/CSS 的社区讨论](https://github.com/orgs/community/discussions/22728)，再用真实 GitHub README 编辑器的 Preview 验证。官方公开的 [html-pipeline 默认白名单](https://github.com/gjtorikian/html-pipeline/blob/main/lib/html_pipeline/sanitization_filter.rb) 与生产 README 并不完全相同，不能直接复制作为结论。

212 个合成探针在既有私有基准仓库的 [README 编辑器](https://github.com/huangko555/meo-preview-github-baseline/edit/main/README.md) 中预览，没有提交草稿。另以 Markdown API 辅助对照，并复核既有[固定提交的已发布文档](https://github.com/huangko555/meo-preview-github-baseline/blob/957dbfc8a0a3685f9c779c17435fb63630bf60b5/complex/README.md) 的 HTML 与锚点。没有上传用户文档。

真实 README Preview 的行为优先于 API：README 中的 `@octocat` / `#1` 保留为文字；API 的上下文链接转换不能直接套用。README 会对 tagfilter 后可见文字中的 URL 做额外自动链接，API 没有相同结果。实际 README 的删除线内普通换行仍是软换行。

## 本轮修正

| 范围 | GitHub 预设现在的行为 |
| --- | --- |
| 不允许的 HTML | GFM 的九类 tagfilter 标签显示为文字，支持的内部标签继续渲染；其他不允许的外壳去除并保留正文。原始 input 移除，video 连同内容移除，audio 保留回退文字；select 内部格式转为文字。 |
| 白名单 | 去掉原生 u；保留 ins、strike、tt、var、samp、q、ruby/rt/rp、原始标题、hr、pre、picture/source、mark、section 等实测支持的内容。原始 SVG 不能注入，渲染器生成的公式和图标继续工作。 |
| 属性 | 清除源 style、class、事件处理器及任意 data 属性；保留实测允许的 title、dir、lang、align、尺寸、hspace、表格列跨度与对齐等。按 GitHub 添加适用的 dir=auto。 |
| 资源 URL | 源 data、file 和协议相对图片不可绕过过滤进入 Host 资源请求；相对文件和 HTTP(S) 图片继续使用现有资源解析。过滤发生在转换为内部 data URL 之前。 |
| 链接 | 不允许的 Markdown / HTML URL 只保留标签文字；HTTP(S)、mailto、相对链接及协议相对链接可用。自动链接支持 www、完整 HTTP(S) URL 和邮箱，裸 example.com 保留为文字。 |
| 自定义锚点 | 源 id/name 加 user-content- 前缀，链接与 Preview 导航同时处理；原始 HTML 标题也生成标题锚点，并参与重复标题计数。 |
| 删除线 | 单、双波浪线均支持删除线；三个及以上连续波浪线保留为文字。不会开启高亮、脚本式上下标、Wiki 等 MEO 扩展。 |
| 特殊 fence | 仅精确小写 math / mermaid 开启富内容；大写 Math / Mermaid 是普通代码。附加 info 可保留。 |
| emoji | 使用固定的 GitHub 官方 emoji 数据及当前 API 名称集合，支持 Unicode 别名和自定义图片；未知名称保留。代码、公式和图片属性中的 shortcode 不转换。默认预览仍保留 shortcode。 |
| HTML code / details | 原始 inline code 内的 Markdown 强调可以渲染，公式与 emoji 保持文字；pre 保留内容。details 无 summary 时补上 Details，跨 Markdown 块不提前关闭。 |
| themed picture | 单地址 source 支持现有 Host 图片解析，并随预览选择的浅／深色切换；HTML/PDF 导出固定为快照主题。GitHub 不支持的 srcset 候选列表与不允许的协议被清除。 |

早期审查中以 `section[data-example]` 查询不到元素推断 section 不支持，结论不够精确：实页保留 section，清除的是 data-example 等属性。本轮扩展探针和回归基准已按真实元素行为修正。

## 验证结果

- `scripts/fixtures/github-readme/compatibility.json` 保存 212 项输入及真实 README 的归一化语义基准，209 项常规探针对照通过。
- `scripts/test-github-readme-compatibility.ts` 另外检查属性、锚点、可信资源转换、伪造内部图片属性、picture 导出和默认预览隔离；已接入 `test:preview-presets`。
- 既有预设渲染、Host 请求及默认 emoji 行为测试通过；扩展和 Webview 类型检查通过。构建后的独立导出运行时也在 Node 中验证通过，规则、emoji 数据和样式均随包加载。
- 生产 Preview 控制器的浏览器冒烟检查通过：浅／深色 picture 实际加载并切换，自定义 id/name 链接导航、折叠 Markdown、源样式清除和默认预设往返有效。

归一化测试比较正文、有效链接、图片和主要标签，忽略 GitHub UI 外壳、语法着色 span、MathJax/KaTeX 内部结构和生成的脚注 ID。它不证明像素一致，也不证明所有 HTML 属性、畸形 HTML、所有公式命令和未来 GitHub 行为都相同。原生 VS Code 本轮未做视觉验收。

## 仍未完成的兼容项

GeoJSON、TopoJSON、STL 在 GitHub 中会进入专业查看器；本地仍显示代码。这三项在回归基准中明确标为 pending，不能计为通过。本次真实 GitHub Preview 的查看器一直显示 Loading，因此仅验证了专用渲染分支，未验证最终地图和 3D 画面。官方支持范围见 [Creating diagrams](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams)。补齐它们需要地图／3D 渲染能力，超出本轮 HTML 与 Markdown 清理规则修正的实现范围。

此外，公式继续使用 KaTeX，Mermaid 使用本地内置版本；GitHub 的 MathJax 命令集、公式排版和 Mermaid 布局仍可能不同。仓库资源发布后的路径、GitHub 图片代理及 README 首页的大文件截断也没有穷举验收。

因此本轮结论是：已核实的常规正向／反向语义边界已修正并固化为测试；完整一致仍有上述明确缺口。不能将 209 个通过用例换算成总体还原度或宣称 100% 兼容。
