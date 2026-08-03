# LiteasyClaw

> 桌面优先、AI 原生的科研阅读与学习 Agent 工作台。
> 目标：把研究者的「建立工作区 → 勾选文献 → 导入解析 → 提问/分析 → 生成可追溯产物 → 沉淀为知识、会话与画像」收敛为一个可持续闭环。

LiteasyClaw 不是通用聊天工具。它的 Agent 在任何与论文相关的回答或产物上都必须**可追溯到原始来源**；自然语言只能提出目标，不能绕过策略直接改写应用状态。当前首轮用户是**个人科研用户**，架构上已为组织协作、平台治理、插件/MCP 与云端能力预留空间。

## 现状速览

| 能力域 | 状态 | 说明 |
|---|---|---|
| 三栏工作台（文献库 / Reader / AI Assistant） | ✅ 可用 | 桌面端核心交互壳 |
| 本地文献库 | ✅ 可用 | Tauri 文件系统，限定 `~/LiteasyLibrary`，递归目录、拖拽、稳定 ID |
| PDF Reader / 批注 / 证据定位 | ✅ 可用 | pdfjs + Unicode offset 句级定位；OCR（Tesseract.js）兜底扫描件 |
| **薄读（Thin Reading）2.0** | ✅ 可用 | 旗舰模态：类型驱动的可下钻阅读 + 严格证据门 + 外部知识检索，OpenAI/DeepSeek 真实链路 |
| 思维导图 / 树 / 层级图 / 对比表 / PPT 产物 | 🟦 雏形 | 多模态 artifact 工作流已落地，部分仍为雏形 |
| 账号 / 会话 | ✅ 可用 | Argon2id + SQLite 真实鉴权；demo 登录并存 |
| 关联推荐 | 🟦 雏形 | 真实 OpenAlex/Crossref/arXiv 检索 + RRF 排序已通；仍有 fixture 兜底 |
| 学术画像 / 个性化 | 🟠 较薄 | 仅 stage/disciplines 等基础字段；五视图画像为规划态 |
| 组织空间 / 治理 / 共享文献库 | 🟦 demo | 两个种子组织 + 治理面板，多为硬编码 fixture |
| 模型网关 / 策略 / 审计 | ✅ seam | 真实 OpenAI/DeepSeek 代理 + 确定性审计规则（可替换为第二模型） |
| 生成式 UI（L-GUI） | 🟦 雏形 | schema 约束的 UI DSL + 组件/数据源注册表，非模型直出 React |

- ✅ 已具备　🟦 雏形/demo　🟠 规划/较薄

## 技术栈

- **桌面端**：Tauri 2 + React 18 + TypeScript，Fluent UI v9 图标与组件基线，`pdfjs-dist`、`tesseract.js`、`zod`、`@xyflow/react` + `d3-force`（图画布）、`chevrotain`（CGL DSL）。无状态库——手写 store 工厂 + hooks；无 HTTP 库——原生 `fetch`。
- **开发云**：原生 `node:http`（无框架）+ `better-sqlite3` + `argon2` + `undici`。Node 20+。
- **外部检索**：OpenAlex（图关系唯一来源）、Crossref（仅 `topic_search`）、arXiv（Atom）。用户自备 OpenAlex API Key。

## 架构总览

### Client-First / Local-First

桌面客户端是用户的「本地自然代理」：携带机构 IP/Cookie 访问 IEEE/Elsevier/CNKI 等数据库；PDF、笔记、批注默认落本地磁盘，云端只做元数据与可选向量同步。Tauri 优于 Electron（更小的包体与内存）。长期推荐栈：Tauri + SQLite + LanceDB（本地）+ FastAPI/Go + Qdrant（云端）。

### 桌面端分层

```text
layout/AppShell → controllers → feature modules → shared types / clients
```

- `AppShell` 只做组合；跨模块编排进入 `src/app/controllers/`；领域能力放在 `src/app/features/`；状态改变逐步收敛到 action contract。
- feature 模块不得反向导入 `layout/AppShell` 或壳层组件。

### Agent 四层

1. `agent-api`：统一 session/run/event/confirmation/cancel/CLI/MCP 入口。
2. `agent-core`：每轮上下文装配（`prepareTurn` / `observeTurn`），加载 `agent.md`、能力摘要、长期记忆、文献/组织/画像上下文，施加预算与安全约束。
3. `agent-runtime`：把命令式自然语言规划为 `SemanticActionPlan`，做契约校验、策略裁决、确认、注册 action 执行。
4. 领域能力层：`actions` / `skills` / `retrieval` / `models` / `artifacts` / `generative-ui` / `workspace`。

运行路径：`用户输入 → AgentCore.prepareTurn → agent-runtime（规划、契约、策略、执行）→ AgentCore.observeTurn → Assistant UI / 产物标签页`。模型可返回结构化计划，但**只能调用已注册 action**；低风险操作可乐观执行，删除/覆写/上传/组织写/付费资源/画像采样需确认。

## 仓库结构

```text
LiteasyClaw/
  desktop/              桌面产品入口：Tauri + React
    src/app/layout/      AppShell 与三栏面板
    src/app/controllers/ 跨模块编排（含 agent/ 子目录）
    src/app/features/    ~30 个领域模块（见下）
    src/app/styles/      全局样式
    src/tests/           Vitest 单测 + Playwright 浏览器规格
    src-tauri/           Rust 桌面宿主
    scripts/             薄读与各类 eval 脚本
  services/dev-cloud/   本地开发云：账号、推荐、模型、缓存等 demo/真实 API
    db/                  SQLite 迁移与仓库（real）/ JSON 文件仓库（demo）
    auth/                Argon2id 鉴权、会话令牌、限流
    providers/           OpenAI Responses / DeepSeek / mock
    payloads/            推荐排序、外部知识、画像、组织等响应构建
  scripts/              demo 数据重置、播种、smoke check
  shared/               跨端共享资源（如学科目录）
  logos/                Logo 与形象素材

project-docs/           工程、产品、QA、设计、SaaS、阶段计划文档
archive/                历史记录、报告、日志、非核心生成物
BRAINSTORM/             L-GUI 等设计头脑风暴
```

### 桌面端主要 feature 模块

`thin-reading`（旗舰）、`artifacts`、`agent-runtime`、`agent-core`、`agent-api`、`assistant`、`models`、`organization`、`recommendations`、`library`、`profile`、`intuition-graph`（CGL DSL）、`layered-reading`、`generative-ui`、`retrieval`、`import`、`metadata`、`collection`、`account`、`network`、`settings`、`workspace`、`selection`、`dock`、`pdf`、`paper-identity`、`paper-analysis`。

## 数据与持久化模型

### 开发云（dev-cloud）

**SQLite（`.liteasy-data/liteasy.sqlite`，WAL + FK + 权限收紧 0600）——真实关系数据：**

| 表 | 用途 | 是否被使用 |
|---|---|---|
| `users` / `password_credentials` / `auth_sessions` | 账号、Argon2id 口令、SHA-256 散列会话令牌（7 天） | ✅ |
| `academic_profiles` | 学段 + 学科（≤12）画像 | ✅ |
| `personalization_states` / `personalization_terms` | 个性化快照版本 + 加权词条（−4..6） | ✅ |
| `recommendation_suppressions` | 已隐藏推荐 | ✅ |
| `external_knowledge_runs` | 可恢复的外部知识检索运行（按 artifactId + requestKey） | ✅ |
| `projects` / `artifacts` / `artifact_versions` / `generation_runs` / `generation_steps` | 可迁移的 AI 内容数据模型 | ⏳ 前瞻预留，当前无端点使用 |

**JSON 文件（`.liteasy-data/*.json`）——demo / 缓存：** `collections`、`organizations`（含两个种子组织）、`recommendation-cache`、`recommendation-candidates`、`recommendation-feedback`、`sessions`、`admin-activity`。每次改动整文件重写，适合单用户开发态。

**文件系统——agent 产物：** `project-docs/agent-results/<artifactId>.json`（`liteasy.agent-artifact/v1`，原子写）。

### 桌面端（三层运行时选择）

运行时按 **Tauri invoke → IndexedDB → localStorage** 顺序选择传输：

- **Tauri 命令**：`load/save_artifact_catalog_state`、`load/save_agent_state`、`load_local_library_snapshot`、`import/read/move_local_library_*`。
- **IndexedDB**：`liteasy-artifact-cache`（catalog 快照，浏览器兜底）。
- **localStorage（`liteasy.*` 版本键）**：`academic-profile.v1`、`account.session.v1`、`artifact-catalog.v1`、`agent-state.v1`、`ui.dock-layout.v1`、`ui.pane-layout.*` 等。

> 当前画像与记忆的主要缺口：会话内内存为主，缺 SQLite/过期/显式删除/跨设备同步与写入抽取管线。详见开发计划文档。

## 薄读（Thin Reading）——旗舰模态

薄读不是「把 PDF 压成一段话」，而是一个**围绕单篇论文、可持续下钻的阅读产品**：

1. **类型驱动的总述**：按论文类型（实验/理论/系统/数据集/综述/基准/立场/人文）选「读完真正该记住什么」，而非均匀摘要。
2. **遗漏板块悬浮按钮**：由「论文应有板块 − 总述已覆盖」差集决定，软上限 ~8。
3. **选区下钻**：在总述中选文「深入了解」，可选附加提示；同标签页内前进/后退。
4. **闭包与外部边界**：到达论文原文闭包后，依赖外部知识的内容以背景色变化警示；外部文献只能补充背景/挑战/后续/知识图谱位置，**不能冒充目标论文结论**。
5. **共享批注推荐**：右侧面板仅接受 Intuecho 社区 API 结果（`intuecho_community` 源 + 论文身份），未连接时空面板，绝不伪造社区内容。
6. **严格质量门**：prompt 约束 → 来源/关系门 → 句级溯源 → 数字保真 → 命题级复核（supported/partial/contradicted/insufficient）→ 至多一次定向修复 → 二次结构失败即显式失败。无可用证据/无可信外部源/连续失败时**停止并给出原因**，绝不输出本地拼接的「成功」。

**管线**：`选论文/选区/遗漏板块 → 本地证据计划（轻量目录，非全文）→ 确定性工具执行（read/search/view，≤12 证据/轮，≤2 轮）→ 观察 → 严格 JSON 生成 → 结构/来源/数字门 → 命题级复核 → 投影为不可变 ThinReadingDocument → artifact 持久化 / UI`。深度阈值（默认 3）触发外部知识并发检索（OpenAlex + Crossref + arXiv，`Promise.allSettled`）。

**论文身份链**：`doi → arxivId → semanticScholarId → title+authors+year hash → local paper id`。`artifactId` 是薄读产物边界；`PaperIdentity` 只用于跨产物/社区「同一篇论文」识别，二者不可互换。

## 如何启动

真实论文 Agent 的推荐启动方式（读取 `project-docs/test-api.md`，使用 `gpt-5.5`，同时拉起开发云与前端）：

```bash
cd LiteasyClaw/services/dev-cloud && npm install
cd ../../desktop && npm install
npm run dev:test-api
```

默认端口占用时自动选空闲端口，以终端日志为准。OpenAlex 外部检索需在 `LiteasyClaw/.env.openalex.local` 配置自备 key（`.env.openalex.example` 为模板，勿提交真实 key）。

完整 Tauri、普通 mock、分终端调试、健康检查与故障恢复见 **[启动与本地联调指南](project-docs/qa/environment-startup-guide.md)**。

## 常用命令

```bash
# 桌面端
cd LiteasyClaw/desktop
npm test                       # Vitest
npm run build                  # tsc + vite build（提交前必跑）
npm run tauri dev              # 完整桌面应用
npm run test:thin-reading-eval                       # 薄读离线 gold
npm run test:thin-reading-live-model                 # 薄读真实模型
npm run test:thin-reading-openalex-live              # OpenAlex 图关系活测
npm run test:thin-reading-external-live              # 外部知识聚合活测
npm run test:thin-reading-ocr-offline                # OCR 离线包

# 开发云
cd LiteasyClaw/services/dev-cloud
npm start                      # 127.0.0.1:8787
npm test                       # node --test

# 路演前恢复 demo 数据（仓库根）
node LiteasyClaw/scripts/reset-demo-data.mjs
node LiteasyClaw/scripts/reseed-demo-data.mjs
node LiteasyClaw/scripts/smoke-roadshow.mjs http://127.0.0.1:8787
```

## 配置与密钥

- `LiteasyClaw/services/dev-cloud/.env.local`：OpenAI / DeepSeek / embedding / reranker key（勿提交）。
- `project-docs/test-api.md`：实验链路 `gpt-5.5` 配置（被忽略的本地文件）。
- `LiteasyClaw/.env.openalex.local`：用户自备 OpenAlex key，仅作为 `X-OpenAlex-Api-Key` 私有头传给 dev-cloud，服务端转为 `api_key` 查询参，绝不进 artifact/cache/prompt/log/test。

## 并行开发规则

1. 新建分支开发，提交 PR 合并；提交用简短祈使式前缀（`feat:` / `test:` / `docs:`）。
2. 新功能先判断归属模块，不直接堆到 `AppShell`；跨模块组合放 `controllers/`。
3. feature 模块不得导入 `layout/AppShell` 或壳组件。
4. 状态改变优先走 action contract，按钮/AI 命令/快捷键复用同一动作。
5. 分析类功能依赖 `SelectedDocumentSetSnapshot`，不直接耦合 checkbox UI state。
6. 新增模块写 focused tests；`AppShell.test.tsx` 只保留 smoke 与关键集成路径。
7. **Fluent 2 基线不可回退**：图标优先活动栏、紧凑分层面板、4–8px 圆角、浅边框低阴影；交互组件优先 `@fluentui/react-components`，图标统一 `@fluentui/react-icons`，不用 emoji 或混用其他库；图标按钮须有可访问名称与 tooltip；不以颜色单独表达状态；不在常驻文案暴露模型/实现/开发状态。基线提交 `7c0da2c`。
8. 不提交 `node_modules/`、`dist/`、`src-tauri/target/`、`.liteasy-data/`、真实密钥等生成物与敏感配置。

## 真实 vs demo 边界（诚实声明）

**真实**：Argon2id 鉴权与 SQLite 会话；OpenAlex/Crossref/arXiv 检索与图关系扩展；BM25 + RRF + 可选 embedding/reranker 排序；SSRF 加固的 PDF 拉取；OpenAI/DeepSeek 真实链路；薄读完整管线与质量门。

**demo/mock**：`mockProvider`（无 key 时回退「开发云回答：…」）；确定性审计规则（非第二模型）；按标题关键词的推荐 fixture；demo 登录；文档元数据同步 receipt；两个种子组织及其共享库/治理 fixture；策略 `syncedAt` 等硬编码时间。当前导入解析、推荐兜底、审计与组织治理仍有 demo 成分，验收前请看 `project-docs/qa/` 限制说明。

## 新开发者建议阅读顺序

1. 本 README
2. [项目上下文与设计总览](project-docs/项目上下文与设计总览.md)
3. [软件架构备忘录](备忘录/软件架构.md)
4. [产品功能与 UI 设计文档 1.0](project-docs/product/LiteasyClaw_功能与UI设计文档1.0.md)
5. [项目结构可视化](project-docs/engineering/project-structure-overview.html) / [三人分工](project-docs/engineering/three-person-worksplit.html) / [模块边界](project-docs/engineering/module-boundaries.md)
6. [Agent 架构审计](project-docs/engineering/agent-architecture-audit.md)
7. [薄读技术架构与商业化演进](project-docs/engineering/薄读-技术架构与商业化演进.md) / [薄读完成标准](project-docs/design/薄读-完成标准.md)
8. [桌面端说明](LiteasyClaw/desktop/README.md) / [开发云说明](LiteasyClaw/services/dev-cloud/README.md)
9. [启动与本地联调指南](project-docs/qa/environment-startup-guide.md) / [路演指南](project-docs/qa/roadshow-demo-guide.md)
10. [AI 原生交互运行时设计](project-docs/superpowers/specs/2026-07-01-liteasyclaw-ai-native-interaction-runtime-design.md) / [模块化地基设计](project-docs/superpowers/specs/2026-07-01-liteasyclaw-modular-foundation-design.md)

> 下一阶段重点见 [用户画像与文献推荐：开发计划与数据关系模型](project-docs/Saas/2026-08-03-用户画像与文献推荐-开发计划与数据模型.md)。

## 启动失败先检查

```bash
node -v      # 桌面端需 Node 20+，开发云强制 >=20
npm -v
cargo --version   # Tauri 需要 Rust 工具链
```

`cargo --version` 失败时：`source "$HOME/.cargo/env"`。仍失败请把执行的命令、报错最后 20 行、系统与 Node/npm/Cargo 版本发给当前开发负责人。
