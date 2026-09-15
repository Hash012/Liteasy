# Notes 文件、白板连接与 entry review

本轮将 Notes 接到真实的 Markdown 文件夹，并修复远端读取失败导致本地笔记列表不更新的问题。白板可选择 `.canvas` 文件保存，PDF entry 的 review 保存在批注本身。

## 使用

- **Notes → 连接文件夹 / Obsidian Vault**：选择已有目录，查看其中的 Markdown 与 Canvas 文件。拖入笔记或批注会在目标目录新建 Markdown 文件，包含当前正文、review 和可折叠原文；已有同名文件会使用新的名称。
- **Notes → 导入 Markdown 文件**，或拖入文件、Vault 目录：将 Markdown 导入本机 Notes，保留目录结构、frontmatter 与链接文本。列表只显示文件名，点击后在独立区域查看、编辑正文。
- 在个人 Notes 目录间复制条目仍然是**复制引用**。连接目录中的文件由磁盘文件管理；往连接目录放入内容则是用户发起的文件导出，二者有不同的写入语义。
- **白板 → 选择白板存储文件**：首次选择后自动保存后续布局、内容和连接；也可打开已有 Canvas、保存或另存。白板也列在 `default/board`，连接目录中的 `.canvas` 可从 Notes 打开和拖入上下文。
- 拖动卡片四条边的中点，或依次点击两个端点，即可连接卡片。视觉连线与用户声明的知识关联一起持久化，删除卡片会清理对应连接。
- 展开论文批注后点击 **AI review** 图标，默认以 entry 的语言 review 其内容。结果单独存储，可编辑、重新打开，并随批注拖入白板或 AI 上下文。生成期间修改 entry 时，旧版本结果保留供用户核对，不直接覆盖新内容。

## 数据与错误处理

`notesRepository` 继续只管理目录和引用，本机对象、PDF 批注、生成产物分别保留原有存储边界。Notes 先发布本机已保存数据，再加载可用来源；单个 PDF、远端产物或外部目录读取失败不再阻断其他来源。外部目录刷新合并重复请求，避免对象投影引发重复全目录扫描。

`note-files/noteFileService` 是 Notes 和白板共同使用的文件接口。桌面宿主通过系统文件选择器建立账号范围内的授权记录，使用 SQLite 持久化；渲染层只能提交授权标识和相对路径。Markdown 内容保持在所选目录，文件更新检查内容哈希。新建文件不覆盖已有路径；已有文件先写临时文件再发布，检测到外部修改时保留用户未保存的编辑。浏览器使用 File System Access 和 IndexedDB 保存句柄；不支持目录访问的浏览器仍可导入 Markdown。

PDF 批注写入改为按存储键串行保存，避免较早快照晚完成覆盖新 review。原生读取失败时禁止将空回退状态写回磁盘，并显示重新读取入口。Review 请求通过现有公开 Agent API 获取固定对象上下文；不会消费白板托盘或加入白板中锁定的无关内容。

Canvas 文件采用 [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) 的节点、坐标和边字段，并保留可支持的扩展字段。同一目录内未改动的 Markdown 卡片可以保持文件引用；在白板上独立修改后导出正文卡片，保留原文件。可移植正文包含原文、review 与可嵌入图片。

## 验证边界

- 桌面构建、完整前端测试、相关 Rust 文件存储测试及浏览器回归均记录在本轮验证中，最终数量见下方。
- 浏览器覆盖真实 HTML 拖放、Markdown 文件选择和导入、IndexedDB 重载、四边连接、Canvas 自动保存、review 编辑及其拖入白板。
- Vault/Canvas 文件浏览器测试仅替换系统选择器，实际使用 Chromium OPFS 文件句柄、文件流和 IndexedDB。Rust 测试在临时磁盘目录验证持久化、跨账号隔离、重复路径、外部修改和路径边界；这不等于已完成 Windows 原生文件对话框的人工作业验收。
- Review 的公开 API 调用与上下文通过测试执行器验证；浏览器初始 review 使用明确标注的测试数据，未请求真实模型、未验证模型输出质量。现有 Agent 对象上下文为文本，纯图片/手绘的视觉 review 尚未接通。
- 导入范围是 Markdown；保留 wiki link 语法但不执行 Obsidian 插件，也不复制整个 Vault 的二进制附件目录。Canvas 分组、非 Markdown 文件卡片与块/标题引用暂明确拒绝导入，避免保存时丢弃内容。单文件上限 8 MB，目录扫描上限 10000 项、64 层。

## 截图

- [Markdown 导入与文件名列表](notes-markdown-import.png)
- [论文高亮拖入 Notes](notes-highlight-drop.png)
- [白板连接](board-connections.png)
- [白板文件自动保存](board-file.png)
- [Entry review 编辑后重载](pdf-entry-review.png)
- [Review 随批注进入白板](pdf-entry-review-board.png)
- [Vault 文件写入与外部修改冲突](vault-file-conflict.png)

## 验证结果

完整前端测试：`npm test -- --run`，**2321 passed、4 skipped**，347 个文件。

最终受影响回归：Notes、文件服务、Canvas 文件、连接绕行、对象仓库及 workbench 控制器共 **70 passed**、9 个文件。其中连线路由覆盖四种布局的全部 16 组端点组合；这些回归在最后的文件引用版本检查和绕行修复后执行。

最终 `npm run build` 通过，包括 TypeScript、资源、schema 和发布产物检查；保留现有大体积 chunk 提示。`git diff --check` 通过。

浏览器 **9 个场景**通过：Notes 引用组织、Markdown 导入重载、高亮拖入 Notes、Vault 写入与冲突、白板拖动与缩放两项回归、四边连接与绕行、Canvas 文件重载自动保存、entry review 编辑重载与拖入白板。连接和 review 的截图已人工检查。

Rust：`cargo test --locked note_files -- --nocapture`，**7 passed**；`cargo check --locked` 通过。
