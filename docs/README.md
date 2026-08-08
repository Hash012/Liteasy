# Documentation

`docs/` 与运行代码隔离，是当前产品和工程资料入口：

- `product/`、`saas/`：产品目标与商业化规划。
- `design/`、`agent-dev/`：功能、交互和 Agent 设计。
- `engineering/`：架构、模块边界和仓库规范。
- `operations/`：部署、备份、恢复和验收。
- `qa/`：本地启动、测试与已知限制。
- `superpowers/`：按日期保存的规格和实施计划。
- `research/`、`reference/`：研究材料与外部参考。
- `notes/`：仍有参考价值的工作记录。
- `assets/`：仅供文档引用的素材。

生成的运行结果不放在这里；稳定评估数据进入 `development/test-data/`，历史报告进入 `archive/`。新增正式计划采用 `YYYY-MM-DD-topic.md`。

早期 Phase 1–4 的 demo 验收指南、过期交接和待办已移入 `archive/`，只用于追溯当时状态，不能作为当前功能或运行方式依据。

当前仓库结构、验证覆盖和生产缺口见 [仓库结构与能力审计](qa/2026-08-08-repository-structure-and-capability-audit.md)。

## 使用与检查

本目录是 Markdown/HTML/PDF 资料，不启动服务。Markdown 可直接在仓库浏览器或编辑器预览；需要生成 PDF 时从仓库根目录执行：

```bash
npm install --prefix development/tools/md-to-pdf
node development/scripts/md-to-pdf.mjs docs/<文档路径>.md
```

实际产品运行步骤以根 README 和各产品 README 为准，历史文档中的命令不得覆盖当前入口。

## 开发测试账号

阅读和生成文档不需要账号。本目录不得记录共享密码、API key、会话 token 或真实人员凭据；涉及测试登录时只引用对应产品 README 中的账号创建流程。
