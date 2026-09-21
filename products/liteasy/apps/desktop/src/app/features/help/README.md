# 帮助模块接口

本模块提供用户手册 UI、内容接口和随桌面离线打包的 Markdown 正文。内置条目由 `builtinHelpProvider.ts` 注册，支持目录筛选及标题、摘要、正文搜索。

当前条目：

- 文献与阅读 → [连接 ChatGPT Review 论文评论](articles/chatgpt-comment-review.md)，条目 ID 为 `reading.chatgpt-review`。包括安装、私有隧道与 HTTPS 连接、共享操作、权限范围及排错；开发侧协议说明见 [Review MCP README](../../../../../../services/review-mcp/README.md)。

- `HelpContentProvider`：以独立 `id` 注册，提供目录、搜索和 Markdown 条目读取。请求携带语言及 `AbortSignal`；适配器应支持取消。
- `createHelpCatalog(providers)`：聚合目录与搜索，以 `{ providerId, articleId }` 路由读取；不同提供方可使用相同的条目 ID。不存在的条目返回 `null`，读取失败抛出错误，由 UI 显示重试入口。
- `HelpPanel`：只接受 `HelpViewModel`，不依赖账号、网络客户端、Agent、文件系统、Dock 或 `AppShell`。
- `useHelpController`（位于 `controllers/`）：管理加载、查询、空状态、失败重试、过期结果丢弃和 F1 快捷键。
- `HelpPort.open(ref?)`：通过 `HelpContext` / `useHelp()` 提供上下文帮助入口；调用方不需要知道面板位置或存储来源。

组合入口是 `AppShell` 的 `helpProviders` 属性。以后新增本地 Markdown、远端手册或扩展提供方，只需实现 `HelpContentProvider` 并注入；不要在帮助 UI 中引入业务存储或执行应用命令。提供方只负责内容，不包含 React 组件或可执行脚本。

```ts
const help = useHelp();
help?.open({ providerId: "liteasy", articleId: "reading.selection" });
```

上述 `reading.selection` 条目 ID 仅示范接口，当前未提供该正文。已有的评论 Review 正文可使用 `reading.chatgpt-review` 打开。帮助标签页可独立关闭和移动，左侧“帮助”按钮或 F1 会重新打开。
