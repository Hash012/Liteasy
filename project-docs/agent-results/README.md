# Agent 分析结果

此目录保存 Liteasy Agent 从“选中文献 → 选择模态”工作流生成的版本化 JSON 结果。

- 文件由本地 `dev-cloud` 原子写入，可以直接 `git add/commit/push`。
- 文件包含所选论文标识、Agent run、回答、citation、Evidence/Claim、结构化 `outlineNodes`、Markdown unordered-list 投影 `outlineMarkdown` 与渲染 DSL。
- 不包含 API key，但可能包含论文片段和用户问题；提交前需确认论文与项目数据允许共享。
- 格式版本为 `liteasy.agent-artifact/v1`。不要手工修改 `agent.status` 或证据定位来伪造完成状态。
- `outlineNodes` 是树形运行时事实源；`outlineMarkdown` 用于阅读、Git diff 与交换，不应反向用空格或制表符猜测节点关系。
