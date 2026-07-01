# LiteasyClaw

LiteasyClaw 是一个桌面优先的科研阅读与学习 agent 工作台。产品目标是具备 AI 原生的用户交互方式，以及准确、高性能、可追溯的多模态表达能力。

当前仓库已经整理为可并行开发的模块化结构。核心工程规则是：

```text
shell -> controllers -> feature modules -> shared types / clients
```

`AppShell` 只做组合；跨模块编排进入 `controllers`；具体领域能力放在 `features`；状态改变逐步收敛到 action contract。

## 快速入口

- 项目结构可视化：`project-docs/engineering/project-structure-overview.html`
- 三人分工可视化：`project-docs/engineering/three-person-worksplit.html`
- 模块边界文档：`project-docs/engineering/module-boundaries.md`
- 产品方案原文：`project-docs/product/LiteasyClaw_功能与UI设计文档1.0.md`
- 当前启动指南：`project-docs/qa/environment-startup-guide.md`
- 路演指南：`project-docs/qa/roadshow-demo-guide.md`
- 桌面端说明：`LiteasyClaw/desktop/README.md`
- 开发云说明：`LiteasyClaw/services/dev-cloud/README.md`

## 目录结构

```text
LiteasyClaw/
  desktop/              当前桌面产品入口：Tauri + React
  services/dev-cloud/   本地开发云服务：账号、组织、推荐、模型、缓存等 demo API
  scripts/              demo 数据重置、播种、smoke check 脚本
  logos/                Logo 与形象素材

project-docs/
  engineering/          工程边界、模块图、协作规则
  product/              产品方案原文
  qa/                   启动、验收、路演说明
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
- 云账号 demo 登录、本地会话、云端可用性状态
- 模型策略同步、模型生成、模型审计 seam
- 文献元数据同步、关联推荐、推荐缓存、云端收藏
- 组织空间、组织列表/摘要/治理、通知、共享文献库切换
- 本地文献库、个人中心、学术档案、画像采样开关
- 多模态 artifact 工作流雏形：任务、标签页、预览、脑图等入口
- 模块化 controller 地基，支持多人并行开发

注意：当前仍有 demo/mock 部分，尤其是导入解析、推荐、审计、账号系统和组织治理。验收前请看 `project-docs/qa/` 下的限制说明。

## 如何完整运行

完整体验需要两个终端：一个启动本地开发云服务，一个启动桌面端。

### 终端 1：开发云服务

```bash
cd /home/octopus/Liteasy
node LiteasyClaw/services/dev-cloud/server.mjs
```

看到下面输出表示启动成功：

```text
LiteasyClaw dev cloud listening on http://127.0.0.1:8787
```

开发云服务地址：

```text
http://127.0.0.1:8787/
```

内部 demo admin 地址：

```text
http://127.0.0.1:8787/admin/
```

如果要调用真实 OpenAI，而不是内置开发回答：

```bash
export OPENAI_API_KEY=你的密钥
node LiteasyClaw/services/dev-cloud/server.mjs
```

### 终端 2：桌面端

```bash
cd /home/octopus/Liteasy/LiteasyClaw/desktop
source "$HOME/.cargo/env"
npm install
npm run tauri dev
```

后续依赖已安装时，通常可以直接：

```bash
cd /home/octopus/Liteasy/LiteasyClaw/desktop
source "$HOME/.cargo/env"
npm run tauri dev
```

如果暂时不打开 Tauri 桌面窗口，只看前端页面：

```bash
cd /home/octopus/Liteasy/LiteasyClaw/desktop
npm install
npm run dev
```

默认前端地址通常是：

```text
http://127.0.0.1:1420/
```

## 常用验证命令

桌面端：

```bash
cd /home/octopus/Liteasy/LiteasyClaw/desktop
npm test
npm run build
```

开发云：

```bash
cd /home/octopus/Liteasy
node --test LiteasyClaw/services/dev-cloud/server.test.mjs LiteasyClaw/services/dev-cloud/providers/openaiResponses.test.mjs
```

路演前恢复 demo 数据：

```bash
cd /home/octopus/Liteasy
node LiteasyClaw/scripts/reset-demo-data.mjs
node LiteasyClaw/scripts/reseed-demo-data.mjs
node LiteasyClaw/scripts/smoke-roadshow.mjs http://127.0.0.1:8787
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
5. `LiteasyClaw/desktop/README.md`
6. `LiteasyClaw/services/dev-cloud/README.md`
7. `project-docs/product/LiteasyClaw_功能与UI设计文档1.0.md`
8. `project-docs/superpowers/specs/2026-07-01-liteasyclaw-ai-native-interaction-runtime-design.md`
9. `project-docs/superpowers/specs/2026-07-01-liteasyclaw-modular-foundation-design.md`
10. `project-docs/superpowers/plans/2026-07-01-liteasyclaw-modular-foundation-phase1.md`

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
