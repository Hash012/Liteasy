# Liteasy Connector

Chrome / Edge 浏览器扩展。把论文信息、PDF/EPUB 和网页快照保存到 **Liteasy 浏览器文献库**，在 ChatGPT 页面分段标记已读、写 Markdown 批注、整理知识白板，导出标准 `.canvas`。

基于固定版本的 [Zotero Connector](https://github.com/zotero/zotero-connectors) 采集引擎构建，阅读与白板功能移植自用户提供的 `chatgpt-reading-progress-v0.5.0.zip`。这是独立产品，仅保存到 Liteasy，不连接或写入 Zotero 文献库/账号。

## 安装

1. 解压 `artifacts/liteasy-connector-0.1.0-chromium.zip`，或者直接使用构建好的 `dist/chromium/`。
2. 打开 `chrome://extensions/` 或 `edge://extensions/`，启用开发者模式，点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的目录。
3. 固定 Liteasy Connector 图标。刷新安装之前已打开的网页。
4. 在论文页面点击扩展图标，选择分类和标签，点击“保存到 Liteasy”。“文献库 / 阅读批注 / 知识白板”打开浏览器侧栏，也可通过活动栏底部按钮打开完整标签页。

现有扩展更新时覆盖同一目录，再点击重新加载。不要先卸载；不同扩展 ID 的本地数据互不共享。

## 功能

| 场景 | 行为 |
| --- | --- |
| 论文识别 | 使用 Zotero 的站点识别与 translator 框架；自动识别元数据，识别失败时退回 Highwire / Dublin Core / Open Graph / 页面标题 |
| 搜索结果批量采集 | 使用站点 translator 和条目选择窗口；只保存用户勾选的条目，取消不保存 |
| 网页快照 | 使用随包提供的 SingleFile，将当前页面及可获取的资源保存为 HTML；批量搜索页不会被错误附加到每篇论文 |
| PDF / EPUB | 识别并下载论文附件到本地 IndexedDB；检查文件特征，登录页或错误内容不会伪装为 PDF |
| 重复文献 | 优先按 DOI，其次按移除片段标识的 URL 去重；保留已有分类、标签和附件 |
| 文献管理 | 搜索标题/作者/DOI/标签、分类筛选、编辑分类和标签、附件下载、显式删除 |
| 文献导出 | BibTeX、RIS、JSON 元数据、含附件的 ZIP 归档；按当前筛选导出 |
| 分段辅助阅读 | ChatGPT 章节已读标记、跨刷新恢复、来源定位、长对话按需挂载 |
| Markdown 批注 | 自动保存、来源摘录、标签、搜索、置顶、回收站、草稿恢复、版本冲突检测、Markdown / JSON 导入导出 |
| 知识白板 | 整节/选区/批注转卡片，移动、缩放、分组、连线、颜色、撤销/重做、多白板、回收站、冲突恢复 |
| 白板导出 | JSON Canvas 1.0 `.canvas` 与含来源信息的 JSON 备份；支持导入标准 text/link/file/group 节点 |

官方站点识别规则按固定提交随扩展打包，在上游的 MV3 沙箱中执行，首次启动无需连接 Zotero 规则服务。规则更新通过更新扩展完成。Fluent UI、SingleFile、Markdown、代码高亮和公式渲染器也随扩展本地打包。

不包含依赖 Zotero 账号或桌面端的在线文献库同步、Google Docs 引用插入和 CSL 安装。这些不是 Liteasy 当前接收的协议。Firefox / Safari 暂不在本产品构建目标内。

## 与 Liteasy 桌面的关系

当前仓库的 Liteasy 桌面没有供浏览器使用的文献接收接口，因此本扩展的“已保存”表示浏览器本地事务完成，**不表示已同步到桌面**。

- 在文献库中导出“完整归档”，解压后将 PDF 导入 Liteasy 桌面文献库。归档同时保留 HTML 快照、BibTeX、RIS 和结构化元数据。
- 批注导出为 Markdown，白板导出为 `.canvas`，可在 Liteasy 的笔记文件工作区使用相应文件；也兼容 Obsidian 的标准文件格式。
- 不在扩展中预设一个不存在的桌面端口、写入生产 API 或借用桌面登录凭据。

## 从旧阅读扩展迁移

在旧扩展中分别导出 **阅读进度 JSON、批注 JSON、白板 JSON**，再在 Liteasy 设置、批注工作区和白板工作区分别导入。保留了原有备份格式及合并规则；不读取另一个扩展的私有存储。重要恢复草稿需先恢复并保存，再导出。

[白板格式与操作](docs/WHITEBOARD_GUIDE.md)和 [Markdown 语法](docs/MARKDOWN_GUIDE.md)保留了原包说明。界面颜色、活动栏、图标与产品名称已经适配 Liteasy。

## 开发与验证

Node 版本与 `../liteasy/apps/desktop/.nvmrc` 保持一致。构建还需要 Git、Bash、rsync、jq、Perl；打包需要 Python 3。Windows 可在 WSL 中构建，然后在 Windows 浏览器中加载解压目录。

```bash
cd products/liteasy-connector
npm ci
npm run setup:upstream
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run package
```

`setup:upstream` 将精确的上游提交和子模块准备到 `.cache/zotero-connectors/`，将站点规则准备到 `.cache/zotero-translators/`，用上游锁文件执行 `npm ci --ignore-scripts`。不在构建时追踪 `master`。首次准备需要联网；后续构建使用本地固定源码与依赖。

也可复用此次克隆的上游：

```bash
LITEASY_CONNECTOR_UPSTREAM=../../tmp/zotero-connector-upstream LITEASY_CONNECTOR_TRANSLATORS=../../tmp/zotero-translators npm run build
```

路径相对于运行命令的工作目录。`LITEASY_CHROMIUM` 可指定浏览器测试用 Chromium 可执行文件。

对应源码 ZIP 已包含上游、子模块和站点规则，可在 `zotero-connectors/` 执行 `npm ci --ignore-scripts`，在 `liteasy-connector/` 执行 `npm ci`，然后使用 `LITEASY_CONNECTOR_UPSTREAM=../zotero-connectors LITEASY_CONNECTOR_TRANSLATORS=../zotero-translators npm run build`。构建会校验源码包内的来源标记和文件哈希。

浏览器测试侧载真实 MV3 扩展，运行真实后台、消息通信、IndexedDB、SingleFile、Markdown Worker 和 Canvas；论文网页、ChatGPT 内容和 translator 仓库采用确定性测试数据，不需要登录用户账号。它不是所有真实出版社网站、登录态 ChatGPT 或 Windows Edge 的验收。

## 存储、权限和边界

- 文献及附件使用独立 IndexedDB；进度使用 `chrome.storage.local`；批注与白板各自使用 IndexedDB，沿用事务和版本检查。只有事务完成后才报告保存成功。
- 所有 HTTP(S) 网站访问权限用于站点识别、快照资源和附件。`cookies`、`webRequest`、`declarativeNetRequest`、`offscreen` 等来自采集引擎，用于受限站点请求和 translator 沙箱；`sidePanel` 用于工作区；`unlimitedStorage` 用于本地附件。
- 文献库读取、修改和导出消息仅接受扩展自己的管理页面。网页 content script 无权读取文献库和批注正文。
- 不自动上传文献、聊天或笔记。采集会访问原站点及其资源；translator 可能访问其需要的元数据服务。快照/附件可能受站点登录、验证码、资源权限和浏览器策略限制，失败会显示在条目详情。
- 单个 HTML 快照最多 25 MiB，单个下载附件最多 100 MiB，单次 ZIP 导出最多 200 MiB。批注与白板沿用原包容量、预览、并发和资源预算。
- JSON 文献导出是元数据文件，附件须通过完整 ZIP 归档导出；文献导出不包括阅读进度、批注和白板，三者有独立备份入口。卸载扩展或删除浏览器配置会删除其本地数据。

## 结构与许可证

- `src/background/`：Liteasy 保存路由与上游传输边界。
- `src/content/`：站点采集适配器。
- `src/shared/`：文献类型、存储、去重与导出格式。
- `src/ui/`：Fluent 2 文献库、活动栏与阅读界面外壳。
- `src/reading/`：原阅读/批注/白板模块及本地渲染依赖。
- `scripts/`：固定上游、构建叠加层与打包；`tests/`：核心回归与原生扩展测试。

派生扩展遵循 AGPL-3.0-or-later，来源和保留的第三方许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。`npm run package` 同时生成扩展和对应源码 ZIP；对外分发时应一同提供。
