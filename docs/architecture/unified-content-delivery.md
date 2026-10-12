# 统一内容与资产实施记录

基线：`b5ba9b7f`，分支 `feat/unified-content-assets`。用户已有 .gitignore、AGENTS.md 和 agent 终端评估文档不属于本次改动。

## WP00：真实调用链

`workspaceAgentAssetService` → `readAgentAssetText`（UTF-16 字符窗口）→ `runWorkspaceAgent.reads`（按路径覆盖）→ `evidenceReportFromAssetReads`（再次截取 4000 字符）→ `EvidenceLens.PassageCard`（裸字符串）。

已有底座：MarkdownContent、MineruMarkdown 的安全表格适配、ObjectRepository 的版本/CAS、ResourceFileService 的 provider 和 scope、AgentAssetService、ContextSnapshot、resourceReveal。只增量收敛，不另建存储。

## 待迁移清单

| 资产/表面 | 现有入口 | 需要补足 |
|---|---|---|
| 对象/笔记/消息/白板 | 对象仓库 + objects adapter | 内容合同、类型注册、原生表示保留 |
| 外部 Markdown/TXT/Canvas | NoteFileService + files adapter | 结构片段、固定版本定位 |
| 论文/PDF | papers adapter + paper anchors | 保留页坐标，不假造字符映射 |
| 产物/批注 | artifacts adapter + context bridge | 去除上下文 provider 白名单 |
| 阅读器/笔记/白板/消息/帮助 | MarkdownContent | 统一安全表格策略 |
| 证据 | PassageCard | typed body、源码切换、禁止远程图片自动加载 |
| 临时界面文本/诊断 | React literal | 保持字面文本，不文件化 |

合成 fixture 来自任务包，不是用户 Larimar 原文。WP00 使用 expected-failure 测试记录两个可重复失败，后续阶段转成正常断言。

## WP01：共享渲染

加入宿主固定 research profile（raw→sanitize→有界表格属性→受限 KaTeX），MinerU 不再自建净化流水线。Evidence 使用 ContentView，旧字符串通过集中 legacy adapter，标题保持 literal；证据禁用自动图片/嵌入加载，提供原样源码按钮。完整表格渲染不意味着残片已经修复。共享 Markdown/证据回归测试覆盖安全链接和攻击内容。

## WP02：结构片段

基于现有 remark 生态建立原始 UTF-16 块索引，保留 CRLF 与精确选区；完整父块/脚注定义仅进入 viewContext，记录展示扩展。超过结构预算保留原始摘录并明确降级。证据取消 4000 字符二次截断，快照可持久化 ContentFragment。上下文预算不再切开 HTML 表、fence、数学、列表。47 项相关断言通过；TypeScript 编译通过。
