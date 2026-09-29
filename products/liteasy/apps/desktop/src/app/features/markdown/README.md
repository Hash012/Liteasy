# 统一 Markdown 文本显示

正文显示使用 `MarkdownContent`，不要在功能目录重新建立 `ReactMarkdown` 管线。基础层负责 GFM（表格、任务列表、脚注）、KaTeX、代码、Mermaid、图片、链接和基础排版。短标题/脑图标签用 `inline`，保持原有容器语义。

文档源码编辑可复用 `MarkdownSourceEditor`：传入受控 `value`、`onChange` 与稳定的 `documentKey`。工具栏支持标题、强调、列表、引用、链接、图片链接、表格、代码、公式和 Mermaid；模板选中可替换部分，插入后保留滚动位置。快捷键为 Ctrl/⌘ B、I、K、E（加粗、斜体、链接、代码），Ctrl/⌘ Z 与 Shift Z（撤销、重做），Ctrl/⌘ [、]（缩进）。工具栏仅产生共享渲染器支持的 Markdown，不插入无法呈现的 HTML 样式。

输入和格式操作共用撤销历史，中文输入法的一次组词作为一次修改。历史只存文本差异，最多 100 条、总计 200 万字符；文件切换或外部载入新内容时清空。保存、版本冲突检测和草稿归属仍由调用方 controller 负责；切换阅读模式后重新进入编辑会开始新的撤销历史。编辑时不同时解析全文预览。正文区须设置 `min-height: 0` 并解除 Fluent Textarea 内部默认高度上限，避免外层填满而内部只有 260px 可以滚动。

```tsx
<MarkdownContent value={note.markdown} paperAnchors={anchors} />
<MarkdownContent streaming={running} value={draft} />
```

领域适配器只扩展领域规则：

- `AssistantMarkdown` 保留助手样式和兼容入口。
- `PdfAnnotationMarkdown` 从当前批注的受限图片附件表解析 `attachment:`，不任意读取本机文件。
- `MineruMarkdown` 保留 OCR 的已清理 HTML 表格和当前文档图片解析。
- `ThinReadingMarkdown` 先执行句子/来源/关联词 AST 插件，再执行统一论文锚点文本呈现，保持原始 Markdown offset 对应关系。
- `SlideDeckView` 用同一组件显示当前页及按需打开的演讲备注；历史 `bullets` 仍可显示。

原始 HTML 默认跳过。只有需要 HTML 表格的来源适配器可显式提供 `rehypeRaw` 加 `rehypeSanitize` 管线，清理后才渲染 KaTeX。链接默认仅允许网页、邮件和页内锚点；图片默认仅允许网页。领域 `urlTransform` 仍受基础层的协议校验约束，不能放行脚本、HTML data URL 或本机文件协议。组件扩展必须保留这一边界。

生成中的文本应传 `streaming`：Mermaid 等到该内容完成才渲染；图表模块按需加载，相同图表不会因后续正文变化而重新挂载。超过 20,000 字符或 300 行的 Mermaid 保留源码视图，避免大型布局计算阻塞界面。KaTeX 限制宏展开和尺寸。图片懒加载，公式、表格和代码可横向滚动。

引用实体经 `paperAnchors` 传入，未知来源标识在叙述文本中显示为“来源待关联”。引用原文的固定下置区域使用 `PaperAnchorReferences`；代码示例保持原样。
