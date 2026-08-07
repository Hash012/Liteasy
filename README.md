# LiteasyClaw

LiteasyClaw 是一个桌面优先的科研阅读与学习 agent 工作台。产品目标是具备 AI 原生的用户交互方式，以及准确、高性能、可追溯的多模态表达能力。

当前仓库已经整理为可并行开发的模块化结构。核心工程规则是：

```text
shell -> controllers -> feature modules -> shared types / clients
```

`AppShell` 只做组合；跨模块编排进入 `controllers`；具体领域能力放在 `features`；状态改变逐步收敛到 action contract。

## 快速入口

首次运行或需要联调论文 Agent，请先看：

- **[启动与本地联调指南](project-docs/qa/environment-startup-guide.md)**：包含 `test-api.md`、`gpt-5.5`、端口冲突、Tauri、健康检查与 Agent 故障排查。

- 项目结构可视化：`project-docs/engineering/project-structure-overview.html`
- 三人分工可视化：`project-docs/engineering/three-person-worksplit.html`
- 模块边界文档：`project-docs/engineering/module-boundaries.md`
- Dock 工作台与新功能 UI 归位规范：`project-docs/engineering/dock-workbench-ui-placement.md`
- 产品方案原文：`project-docs/product/LiteasyClaw_功能与UI设计文档1.0.md`
- 文件系统与存储实施审计：`project-docs/design/Liteasy-文件系统与存储边界实施审计.md`
- 桌面端说明：`LiteasyClaw/desktop/README.md`
- 开发云说明：`LiteasyClaw/services/dev-cloud/README.md`
- 正式云服务边界：`LiteasyClaw/services/cloud/README.md`
- 独立管理后台：`LiteasyClaw/admin/README.md`

## 目录结构

```text
LiteasyClaw/
  desktop/              当前桌面产品入口：Tauri + React
  admin/                独立管理后台：React + OIDC/PKCE + Fluent 2
  services/dev-cloud/   本地开发云服务：真实账号、组织、文献树、推荐和模型代理
  services/cloud/       PostgreSQL/S3 正式服务与管理 API
  scripts/              只读 smoke check 与文档工具
  logos/                Logo 与形象素材

project-docs/
  engineering/          工程边界、模块图、协作规则
  product/              产品方案原文
  qa/                   启动与验收说明
  superpowers/          设计规格与阶段计划
  Saas/                 SaaS 化、路演、工作台设计文档
  assets/               文档素材

archive/                历史记录、报告、日志、非核心生成物
```

核心源码闭包在 `LiteasyClaw/`。核心文档在 `project-docs/`。历史和非核心材料在 `archive/`。

## 当前已具备的能力

桌面端已经具备：

- 三栏工作台：文献库 / Reader / AI Assistant
- 工作区、选中文献集、锁定选择、导入、分析入口
- 真实云账号注册/登录、持久会话和云端可用性状态
- 模型策略同步、真实 provider 模型生成和模型审计
- 文献元数据同步、关联推荐、推荐缓存、云端收藏
- 组织空间、组织列表/摘要/治理、通知、共享文献库切换
- 本地文献库、个人中心、学术档案、画像采样开关
- 多模态 artifact 工作流雏形：任务、标签页、预览、脑图等入口
- 模块化 controller 地基，支持多人并行开发

注意：`dev-cloud` 的 SQLite 和本地对象目录是真实的开发持久化，进程在 staging/production 环境会拒绝启动。`services/cloud` 已提供正式 PostgreSQL/S3、OIDC 和主要业务/管理 API，`admin` 是独立 `liteasy-admin` PKCE 客户端；凭据化供应商、私有连接器和目标环境验收仍未完成，生产门禁见实施审计文档。

## 如何启动

开发联调的推荐启动方式：

```bash
cd LiteasyClaw/services/dev-cloud
npm install

cd ../../desktop
npm install
npm run dev
```

该命令同时启动开发云与 Vite 前端。模型或检索 provider 未配置时，相应功能返回明确不可用，不会生成静态假结果。

完整 Tauri、分终端调试、健康检查与故障恢复请查看 **[启动与本地联调指南](project-docs/qa/environment-startup-guide.md)**。

## 常用验证命令

桌面端：

```bash
cd LiteasyClaw/desktop
npm test
npm run build
```

开发云：

```bash
cd LiteasyClaw/services/dev-cloud
npm test
```

正式存储适配器：

```bash
cd LiteasyClaw/services/cloud
npm test
```

独立管理后台：

```bash
cd LiteasyClaw/admin
npm test
npm run build
npm run dev
```

开发云只读 smoke：

```bash
# 在仓库根目录执行
node LiteasyClaw/scripts/smoke-dev-cloud.mjs http://127.0.0.1:8787
```

## 当前模块地基

已收敛出的 shell-facing controllers：

- `LiteasyClaw/desktop/src/app/controllers/useWorkspaceSelectionController.ts`
- `LiteasyClaw/desktop/src/app/controllers/useCloudAccountController.ts`
- `LiteasyClaw/desktop/src/app/controllers/useArtifactWorkflowController.ts`
- `LiteasyClaw/desktop/src/app/controllers/useKnowledgeSyncController.ts`
- `LiteasyClaw/desktop/src/app/controllers/useOrganizationShellController.ts`

主要 feature 模块：

- `workspace`：工作区、论文、选择状态、workspace source
- `selection`：选中文献集快照和 ready validation
- `agent-runtime`：AI 原生交互运行时契约
- `actions` / `skills`：动作契约、策略、注册执行
- `assistant`：右侧 AI 对话和 runtime event 展示面
- `artifacts`：多模态产物任务、标签页、预览和生成流程
- `import` / `ingestion`：导入、解析、切块、索引生命周期
- `retrieval`：chunk、引用、source-grounded lookup
- `knowledge-sync`：收藏、推荐、元数据同步的 shell 协调层
- `collection`：云端收藏
- `recommendations`：关联推荐与缓存
- `metadata`：文献元数据同步
- `account` / `network`：账号、云端连接、可用性状态
- `models` / `settings`：模型网关、策略同步、设置状态
- `organization`：组织空间、治理、通知、共享文献库
- `library` / `profile`：本地文献库与个人画像

更完整的图请打开：

```text
project-docs/engineering/project-structure-overview.html
```

## 并行开发规则

1. 新建分支开发，提交 PR 合并。
2. 新功能先判断归属模块，不要直接堆到 `AppShell`。
3. 跨模块组合放到 `LiteasyClaw/desktop/src/app/controllers/`。
4. feature 模块不能导入 `layout/AppShell` 或 shell 组件。
5. 状态改变优先走 action contract，后续按钮、AI 命令、快捷键都应复用同一动作。
6. 分析类功能依赖 `SelectedDocumentSetSnapshot`，不要直接耦合 checkbox UI state。
7. 新增模块逻辑写 focused tests；`AppShell.test.tsx` 只保留 smoke 和关键集成路径。
8. 不要提交 `node_modules/`、`dist/`、`src-tauri/target/` 等生成产物。

## 新开发者建议阅读顺序

1. `README.md`
2. `project-docs/engineering/project-structure-overview.html`
3. `project-docs/engineering/three-person-worksplit.html`
4. `project-docs/engineering/module-boundaries.md`
5. `project-docs/engineering/dock-workbench-ui-placement.md`
6. `LiteasyClaw/desktop/README.md`
7. `LiteasyClaw/services/dev-cloud/README.md`
8. `project-docs/product/LiteasyClaw_功能与UI设计文档1.0.md`
9. `project-docs/superpowers/specs/2026-07-01-liteasyclaw-ai-native-interaction-runtime-design.md`
10. `project-docs/superpowers/specs/2026-07-01-liteasyclaw-modular-foundation-design.md`
11. `project-docs/superpowers/plans/2026-07-01-liteasyclaw-modular-foundation-phase1.md`

## 启动失败先检查

```bash
node -v
npm -v
cargo --version
```

如果 `cargo --version` 失败：

```bash
source "$HOME/.cargo/env"
```

如果仍然失败，请把以下信息发给当前开发负责人：

- 执行的命令
- 报错最后 20 行
- 操作系统和 Node/npm/Cargo 版本
