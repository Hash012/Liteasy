# 帮助模块接口与内容维护

用户通过帮助按钮或 F1 进入离线用户手册。保留 `liteasy` provider、`getting-started.basics` 和 `reading.chatgpt-review` 路由；现有业务入口不需要改变。

## 正文与检索

- `manual/content/`：49 篇 Markdown 正文，是应用手册的唯一内容来源，覆盖 12 个主题。
- `manual/manifest.json`：标题、摘要、关键词、主题、适用条件、关联文章、材料来源和内容版本。
- `manual/manualCatalog.ts`：静态导入正文的生成文件，不能手工编辑。
- `manual/manualProvider.ts`：支持标题、关键词、摘要和正文加权搜索、全角字符归一化、多词同时匹配、取消请求及中文语言回退。
- 快捷键从 `workbenchCommands` 动态生成，不在手册中维护另一份键位表。
- `articles/` 保留原有两份文章的历史来源，不再参与注册。新增或更新正文应修改 `manual/content/`。

修改 manifest 后，在桌面目录执行：

```bash
node scripts/generate-manual-catalog.mjs
node scripts/generate-manual-catalog.mjs --check
npm test -- src/tests/manualProvider.test.ts src/tests/helpModule.test.tsx src/tests/workbenchCommands.test.tsx
```

生成目录校验也由 `manualProvider.test.ts` 执行；新增文章必须注册主题并使用唯一 ID，关联文章必须存在。生成文件统一使用 LF。

材料包来源与历史设计记录见仓库 `docs/user-manual/README.md`。历史验收记录不代表当前 Windows 安装包或用户外部服务已经验收。

## 接口边界

`HelpContentProvider` 以独立 ID 提供目录、搜索、Markdown 读取；请求包含语言和 AbortSignal。`createHelpCatalog` 通过 `{ providerId, articleId }` 聚合提供方，不存在的文章返回 null，错误由 UI 显示重试。

`HelpPanel` 仅消费 `HelpViewModel`，不访问账号、网络、文件系统或应用命令。`useHelpController` 管理加载、筛选、过期请求、错误重试和 F1。组合入口仍是 AppShell 的 helpProviders。

```ts
const help = useHelp();
help?.open({ providerId: "liteasy", articleId: "reading.references" });
```

帮助标签页可以关闭和移动；帮助按钮或 F1 可以重新打开。
