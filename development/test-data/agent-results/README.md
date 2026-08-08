# Agent 分析结果

此目录保存 Liteasy Agent 从“选中文献 → 选择模态”工作流生成的版本化 JSON 结果。

- 文件由本地 `dev-cloud` 原子写入，可以直接 `git add/commit/push`。
- 文件包含所选论文标识、Agent run、回答、citation、Evidence/Claim、结构化 `outlineNodes`、Markdown unordered-list 投影 `outlineMarkdown` 与渲染 DSL。
- 不包含 API key，但可能包含论文片段和用户问题；提交前需确认论文与项目数据允许共享。
- 格式版本为 `liteasy.agent-artifact/v1`。不要手工修改 `agent.status` 或证据定位来伪造完成状态。
- `outlineNodes` 是树形运行时事实源；`outlineMarkdown` 用于阅读、Git diff 与交换，不应反向用空格或制表符猜测节点关系。

## 使用与验证

本目录不启动服务。查看 JSON 可直接使用编辑器；修改生成链路后，通过 Desktop 连接 dev-cloud 重新生成结果，并运行：

```bash
cd development/dev-cloud && npm test
cd ../../products/liteasy/apps/desktop && npm test
```

不要手工执行或导入不明来源的结果文件；提交前检查 diff 中没有受版权或隐私限制的正文。

## 开发测试账号

读取这些稳定结果不需要账号。重新生成时使用测试人员自己的 dev-cloud 账号，目录内不得记录邮箱密码、session token、API key 或 MFA secret。
