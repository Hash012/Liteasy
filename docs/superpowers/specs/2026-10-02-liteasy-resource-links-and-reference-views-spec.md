# Liteasy 通用资源链接、悬浮预览与嵌入视图

日期：2026-10-02。状态：设计稿，待实现；本次 Windows 图标及元信息编辑交付不代表以下功能已上线。

## 1. 目标与交互

将“引用另一个文件或其中一段内容”做成所有阅读器、笔记、白板、AI 消息及插件页面共享的基础能力。文件包括论文、电子书、Markdown、图片、批注、白板、AI 产物和插件自定义资产。新类型只需注册一次适配器，就能被链接、预览、嵌入、拖动及加入上下文。

| 输入 | 阅读时呈现 |
| --- | --- |
| `[[CicN]]`、`[[笔记/CicN.md\|我的笔记]]` | 可点击的标题或别名 |
| `[我的笔记](笔记/CicN.md)`、`[我的笔记](liteasy://…)` | 与双链使用同一资源解析和显示组件 |
| `[[CicN#结论]]`、`[[CicN#^memory-control]]` | 定位到标题或显式块 ID |
| `[[paper.pdf#page=12]]` | 定位到 PDF 第 12 页；也支持现有论文批注路径 |
| `![[CicN#结论]]`、`![结论](笔记/CicN.md#结论)` | 原位嵌入被引用内容，保留来源及打开入口 |

普通 Markdown 链接采用 `[名称](目标)`，即用户所述括号链接的标准形式；`!` 加在链接前切换为嵌入。保留普通图片链接语义。Obsidian 的双链、标题/块引用、PDF 页码和 `!` 嵌入作为兼容基础，不承诺全部插件语法。[链接格式](https://obsidian.md/help/links)、[嵌入格式](https://obsidian.md/help/embeds)

阅读界面悬停约 300ms 显示浮窗；键盘聚焦也可触发，Esc 关闭。参考用户截图，浮窗紧邻链接、自动避开屏幕边界，内容定位到被引用小节或页码，可独立滚动、选择和复制；鼠标移入后保持，不抢走原页面阅读位置。默认约 420px 宽，最大高度 60vh，窄窗口自适应；PDF 按浮窗宽度清晰渲染，不缩成不可读的整页缩略图。提供“打开原文”“加入上下文”两个紧凑动作。编辑态默认 Ctrl+悬停，避免输入中频繁遮挡，设置中可调整触发方式。[Obsidian 页面预览](https://obsidian.md/help/plugins/page-preview)

输入 `[[`、工具栏“插入引用”、拖入资产共用同一个搜索选择器，支持标题、文件名、别名与 Liteasy Path；选中文献后可继续选标题、页码或块。重名结果显示目录、类型和所属文献，由用户选择，不能静默取第一个。悬停和嵌入不自动把正文发送给 AI；“加入上下文”沿用现有显式操作与读取预算。

## 2. 底层契约：资源身份与被引用视图

复用现有 `ResourceTarget`、对象 revision、论文锚点和统一资产适配器。新增版本化 `ResourceReference`，保存目标、可选片段、别名及“跟随最新／固定修订”策略；Liteasy Path 是规范地址，文件名只是输入形式和显示名。

**每类资产具备 `referenceView` 能力，而非每个文件保存一份组件代码或正文副本。** 类型注册表提供适配器，资源实例只持久化类型、数据、引用和可选展示偏好。建议契约如下，具体类型在实现时与既有契约合并：

```ts
interface ResourceReferenceAdapter {
  resolve(locator: LinkLocator, context: SourceContext): Promise<ResolveResult>;
  referenceView(ref: ResourceReference, request: ViewRequest): Promise<ReferenceProjection>;
  subscribe(ref: ResourceReference, invalidate: () => void): () => void;
}
// SourceContext: 当前 scope、源资源、挂载根目录。
// ViewRequest: hover | embed、片段、内容/像素预算、AbortSignal。
// ReferenceProjection: resolvedRevision、正文片段或宿主管理的媒体句柄、
//                     标题/出处、截断状态、可用动作；不含任意可执行代码。
```

- `resolve` 区分 resolved、ambiguous、missing、unavailable、forbidden，UI 显示可读状态，保留原始链接方便修复；不能把失效锚点悄悄定位到另一段。
- `referenceView` 统一承担小型预览和正文嵌入；宿主决定布局，类型适配器决定可读内容。Markdown 复用公式、Mermaid、图片及字体能力；PDF 返回局部页视图；电子书返回章节片段；白板/产物返回只读卡片；未知类型回退为元信息卡片。新类型即使未提供专用视图，也具备可打开、可拖动的默认引用卡片。
- 标题、块、PDF 页码等片段先解析为类型化 selector，再交给适配器。当前 `parseLiteasyPath` 拒绝 URL hash，不能直接把 `#page=12` 塞给旧解析器；兼容输入层拆分 fragment，规范引用使用经过校验的 selector。复用已有对象 selectorId 和论文锚点，不建立平行的批注身份系统。
- Markdown 相对链接以源文件目录解析；Obsidian 双链按挂载库根路径、源目录及唯一名称索引解析。Windows 分隔符、中文、空格、转义及大小写按实际挂载规则处理，禁止越出授权根目录。同名跨库资源必须明确选择。
- 内部资产重命名/移动保持 ID；外部文件以挂载记录跟踪移动和旧路径别名。外部发生无法可靠辨认的移动时显示断链并允许重定位。保留导入 Markdown 原文，解析索引可重建；用户主动修复/改写原文件须经过现有冲突检测。

## 3. 如何纳入现有模块

以下路径相对 `products/liteasy/apps/desktop/src/app/`，标注“新增”的模块和 API 均为计划内容。

| 位置 | 职责 |
| --- | --- |
| `features/resource-filesystem/liteasyPath.ts`、`agentAsset.types.ts`、`agentAssetService.ts` | 复用身份、授权、搜索、分段读取和上下文能力，扩展引用投影适配协议 |
| 新增 `features/resource-links/` | 统一 LinkLocator、引用解析、片段定位、依赖索引、缓存；提供 `ResourceLink`、`ResourceEmbed`、`ResourceReferencePicker` 与悬浮预览宿主 |
| `features/markdown/MarkdownContent.tsx`、`liteasyMarkdownLinks.ts` | 在现有 remark/AST 管线中识别双链及嵌入，输出共享引用节点；不在每个页面用正则替换 HTML，不处理代码块内的链接示例 |
| `features/visual-blocks/blockRegistry.ts`、`ComponentTreeView.tsx`、`features/extensions/extensionPackage.ts` | 将引用/嵌入组件加入公共组件目录；插件声明资源类型及 `referenceView`，沿用受约束的声明式视图和宿主动作 |
| `features/note-files/`、PDF/电子书阅读器、白板 | 各自只提供源资源上下文及片段适配器；包括 PDF 内部目录链接/批注入口，也能调用同一悬浮预览宿主 |
| 新增 `controllers/useResourceLinksController.ts` | 注入账户作用域、导航和上下文动作；`AppShell` 只组合 provider，feature 不反向依赖 layout |

根 provider 为所有页面提供相同服务。新页面使用 `MarkdownContent` 或 `ResourceLink/ResourceEmbed` 即可，禁止再自建解析器和预览浮窗。AI、MCP 与手工编辑使用同一序列化格式和选择器；未来的插件开发文档必须包含“引用其他资源”和“被其他资源引用”两个最小示例。

## 4. 更新、性能与边界

嵌入默认只读并跟随来源更新，固定修订则显示版本。来源修改通过依赖索引只失效相关预览；缓存键包含 scope、资源、修订、selector 和视图模式。嵌入不复制正文到宿主文件；反向引用索引可增量更新并重建，账户切换立即取消请求、清空对应视图。

针对已有 WebView 内存问题，首版限制同时一个悬浮预览、最多两个后台内容请求；嵌入进入可视区才读取。PDF 只渲染当前片段页并沿用现有像素预算和释放机制，不能为每个浮窗新建完整阅读器。文本首段最多 12,000 字符，超出提供继续阅读；正文嵌入分段加载。循环引用在同一解析链立即降级为链接，嵌套深度最多两层，禁止递归加载整库。关闭浮窗中止请求并释放图片/PDF 句柄。

每次读取仍校验当前 scope 与挂载权限，地址本身不赋予权限。外部网页保留普通链接或已有网页资产预览，不因悬停自动抓取任意网站；HTML、SVG、diagram 沿用现有安全渲染边界。插件禁用、目标删除、尚未同步的正文均显示占位和打开/重试入口，不拖垮宿主页。

## 5. 实施与验收

按四步实现：**引用模型与解析 → 共享选择器/链接/悬浮组件 → 各类资产的片段投影与嵌入 → 插件接入、更新失效和性能验收**。新增字段可缺省，旧 Liteasy Path、普通 Markdown 图片和外部链接行为不退化。

验收至少覆盖：

1. 同一条链接在笔记、AI 消息、白板、插件页面表现一致；双链与标准 Markdown 都支持插入、打开、悬浮和 `!` 嵌入；显示名称而非复杂 ID。
2. `CicN` 的段落、带公式/图片的笔记、PDF 第 12 页、电子书章节、批注及白板分别能预览并定位；按截图在浮窗内滚动，不改变原阅读页。
3. 改名/移动/更新、固定版本、重名、断链、跨账户、失效锚点、离线和外部文件编辑冲突均有回归；自动修复不能误指向别的文件。
4. 用仅注册一次的测试插件验证新的资产类型可引用也可被引用；字体、深浅主题、键盘操作、拖动和上下文添加无需在插件内重写。
5. Windows 实机连续悬停 100 个引用及滚动含 50 个嵌入的页面：交互无明显卡顿，请求/媒体资源在关闭后释放，内存不随次数持续增长；记录基准机与峰值，不用静态截图代替验证。
