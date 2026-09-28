# PDF、阅读批注与 Obsidian Vault

用户报告在打开 PDF、浏览导入的 Obsidian Vault 时出现 WebView `Out of Memory`。目前没有该设备的崩溃转储，不能证明其唯一原因；代码中确认并修复了两条随文档或文件数量增长的内存路径。

## 内存与目录

- PDF 只渲染视口及附近页面，最多保留六页画布。离屏、进入阅读模式或切换到缩略图总览时，取消任务并释放画布、文字层和字形几何缓存。保留页面占位与首页真实比例，普通缩放继续使用屏幕原生像素密度；极端尺寸限制单画布为 16M 像素、单边 8192 像素。
- Vault 扫描只读取目录和文件名。文件列表分批显示，每次 100 项；打开、复制或交给 Agent 时才读取所选正文。
- 旧版已生成的 `legacy/note-file-*` 对象仍可通过原引用访问，但普通笔记/白板目录不再读取全部正文。当前白板中明确放置的文件继续按引用加载。
- 文件拖拽携带延迟捕获凭据。只有实际投放到白板或上下文时，才通过统一 Liteasy Path 解析文件内容。

## 同一份批注

PDF 与阅读模式继续共用 PDF annotation storage、ID、revision 和发布状态。阅读正文用 CSS Highlight 绘制高亮与下划线，支持颜色、笔记与删除同步；不通过插入额外 DOM 节点破坏 Markdown 和文本选择。

从阅读模式创建标记时，仅为选中的一页临时生成文字层来计算 PDF 坐标，计算完即释放，不重新渲染整篇 PDF。原文不能唯一匹配时不猜测位置，用户可以改存页批注。翻译侧不参与原文高亮定位。

## Markdown 文件

连接 Vault 后，选择 `.md` / `.markdown` 在中央标签页阅读和编辑，复用 Markdown 基础组件。预览按章节限量渲染；保留原始源码，保存使用读取时的文件版本。

只保留当前文件和未保存草稿，限制未保存文件数量与总体积。切换文件保留草稿；磁盘发生变化时，未修改的页面自动刷新，有修改的页面保留草稿并提示重新载入或另存副本。晚到的磁盘轮询不得覆盖刚保存的新版本。

Obsidian 检查只读取用户授权目录内的 `.obsidian/workspace.json`，限制大小并检查规范路径。桌面端结合 Obsidian 进程是否存在；浏览器只能检查工作区记录。发现编辑标签时建议关闭对应 Tab，但允许继续编辑。工作区记录可能滞后，不能证明另一个编辑器的实时状态或充当文件锁；自定义配置目录暂不检测。实际写入仍使用现有两次版本核对与原子替换保护。

工作区记录行为参见 [Obsidian 官方说明](https://github.com/obsidianmd/obsidian-help/blob/master/en/Files%20and%20folders/How%20Obsidian%20stores%20data.md)。

## 文件格式

新增 MOBI（包括兼容的 PRC/AZW）、FB2 和 HTML/HTM，继续支持 EPUB、Markdown、TXT。MOBI 支持无压缩、PalmDOC、HUFF/CDIC，读取元数据和内嵌常用位图；FB2 支持元数据与内嵌位图。复用 EPUB 的 HTML 清理、资源白名单和章节限制，不运行文件中的脚本。

MOBI 双格式文件读取兼容正文；纯 KF8/AZW3 与 DRM 文件暂不支持，会明确提示转换为 EPUB。不会将二进制文件按 TXT 打开。旧版作为“其他文件”保存的可读格式，也能直接从原文件打开。

格式实现参考了 [Foliate 的 MOBI 支持说明与源码](https://github.com/johnfactotum/foliate-js/blob/main/mobi.js)，Liteasy 的解析器额外限制记录、解压、递归和字典大小，并拒绝循环引用、损坏偏移及过大正文。

## 验证记录

- 前端全量回归：2751 通过、4 跳过；后续新增草稿竞争、延迟文件拖拽和下划线颜色等用例的受影响回归另行通过。
- 浏览器确认 180 页 PDF 跳到第 170 页后释放首页画布；浏览 300 个 Markdown 文件时不读取正文，选中文件后仅读取该文件；编辑态工作区提示不禁用编辑器。
- 浏览器确认 PDF 与阅读模式的批注编辑、创建、删除、重开一致；原生像素密度 1 / 1.25 / 1.5 / 2 与切换屏幕密度通过。
- Rust 文件存储测试 9 通过，包含工作区记录大小、账号隔离、目录边界与外部修改保护；`cargo check --locked --all-targets --no-default-features` 通过。
- 额外扩展浏览器验证中，18 个场景通过；`pdfSelection.browser.spec.ts` 的 `dragging beyond a word right edge includes all of its trailing letters` 仍失败：期望 `ciative memory`，实际为 `ciative memor`。在隔离环境换回原 main 的 `PdfReader.tsx` 后同样复现，保留失败记录，没有放宽断言或宣称此次已修复。
- `ci:smoke` 与隔离干净快照上的 `ci:contracts` 通过，生成 schema 和锁文件没有漂移。
- 本地生产构建与生成资源检查通过。本次本地运行在 Linux，Node 22.13.1、Rust 1.98.0；不能替代 workflow 固定工具链上的 Windows Installer 验证。

验证日志保存在被忽略的 `.liteasy-run/reader-validation/`。不要把日志写进 Playwright 的 `test-results/` 根目录：Playwright 启动会清理该目录。
