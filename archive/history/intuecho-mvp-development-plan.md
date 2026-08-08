# Intuecho 独立 MVP 开发计划

## 目标

跑通一条可真实使用的闭环：用户可在 Intuecho Web 浏览论文和研究主题；在 Liteasy 阅读时可把当前句段作为上下文带到 Intuecho Web，发布一条用户帖子；发布后，Liteasy 的薄读右栏能重新读到相关帖子。

Intuecho 是独立产品：独立部署、独立数据库、独立 Web 前端。Liteasy 是它的高质量上下文客户端，不与 Intuecho 共享数据库或私有阅读数据。

## MVP 边界

本期只做：

- 公开浏览 Web：主题页、论文页、帖子详情；
- 登录后发布用户帖子，研究主题必填，论文和引用文段可选；
- Liteasy 选区创建短期上下文草稿，并打开 Web 编辑抽屉；用户开始输入后自动转为可继续编辑的个人草稿；
- 薄读右栏显示当前论文或句段最相关的 3 条用户帖子；
- DOI/arXiv/PMID 元数据解析，失败时允许最低限度手动补全；
- 页码/章节、短摘录、文本指纹组成的锚点；
- 用户撤回后立即从公开读取、搜索、推荐和模型上下文移除。

本期不做：图片上传、实时通知、私信、关注流、复杂推荐、向量检索、自动审核工作流、PDF 托管、完整主题自动生成。

## 技术架构

```text
Intuecho Web (React + TypeScript + Vite)
  -> Intuecho API (Node 20 + TypeScript + Fastify + Zod)
  -> PostgreSQL

Liteasy Desktop (现有 Tauri + React)
  -> Intuecho Public API
```

- `intuecho-web`：独立 Web 应用，负责浏览、编辑、发布和个人内容管理。
- `intuecho-api`：独立服务，负责账户令牌验证、内容、论文元数据、草稿和上下文查询。
- `PostgreSQL`：Intuecho 的唯一业务数据源；Liteasy 不直接读写它。
- `intuecho-contracts`：版本化 Zod schema 与 API 类型；Web、API、桌面端共同使用。
- Liteasy：只创建上下文草稿、查询精简推荐、打开 Web URL；不维护第二套社区编辑器。

本地开发可用 SQLite 作为 API 的替代 repository；上线前切换 PostgreSQL。业务 service 和 API 契约不依赖数据库实现。

## 目录建议

```text
LiteasyClaw/
  intuecho-web/
  services/intuecho-api/
  packages/intuecho-contracts/
  desktop/src/app/features/intuition-community/
```

桌面端依赖方向保持为：

```text
layout -> controllers -> intuition-community -> contracts / client
```

`AppShell` 只组装入口；创建草稿、读取推荐和打开浏览器由 controller 编排。

## 核心主链

```text
Liteasy 选中原文或薄读节点
  -> POST /v1/drafts/contextual
  -> API 创建短期 draftId
  -> 桌面端打开 Intuecho Web /?draft=:draftId
  -> 保持当前 Web 页面不变，由右侧抽屉读取草稿并发布
  -> POST /v1/posts
  -> Liteasy GET /v1/contextual-feed
-> 薄读右栏显示最多 3 条相关帖子
```

URL 只包含 `draftId`，不包含身份令牌、原文或私有笔记。草稿仅可由创建者读取和发布，30 分钟后过期；同一草稿重复提交只返回第一次发布的内容，避免产生重复帖子。

## 开发分期

### Phase 1：独立服务骨架

目标：Intuecho 能单独启动、登录并提供受版本约束的 API。

- 建立 `intuecho-api`、`intuecho-web`、`intuecho-contracts`；
- 定义 `Work`、`Topic`、`SourceAnchor`、`ContextualDraft`、`Post` 的最小 schema；
- 接入账户令牌验证，不复制 Liteasy 私有资料；
- 建立数据库 migration、fixture 和健康检查；
- 实现 `POST /v1/drafts/contextual`、`GET /v1/drafts/:draftId`、`POST /v1/posts`。

完成标准：Web 可用固定 fixture 创建并发布一条帖子；未登录、过期草稿、无效锚点和重复发布都有确定错误响应。

### Phase 2：Web 社区最小体验

目标：没有 Liteasy 也能独立浏览和发表。

- 路由：`/`、`/topics/:topicId`、`/works/:workId`；外部入口使用 `/?draft=:draftId` 自动打开页面内抽屉；
- 主题页：导览、精选内容、核心论文、待讨论问题；
- 论文页：论文元数据、可选原文引用、用户帖子、通往主题页的入口；
- 发布抽屉：先选择研究主题，再填写正文、可选引用和最多 5 个标签；
- 页眉右侧提供轻量反馈入口，不建立反馈论坛。

完成标准：公开用户可浏览，登录用户可从论文页发布，发布后可在论文页与主题页读到同一条内容。

### Phase 3：Liteasy 上下文接入

目标：把阅读现场带到 Web，不把社区复杂度带进桌面端。

- 新增 `intuition-community` feature 与 API client；
- PDF 选区和薄读节点生成受控上下文草稿；
- 使用系统浏览器打开带 `draftId` 的 Web 页面，由页面内抽屉编辑；
- 不在桌面端保存 Web 草稿或实现完整编辑器；
- 失败时显示可恢复提示，保留用户当前阅读位置。

完成标准：从 Liteasy 发起发布可正确带入论文、页码、短摘录和主题候选；URL 中不泄露原文和令牌。

### Phase 4：社区回流到薄读

目标：验证用户帖子确实能改善阅读体验。

- 实现 `GET /v1/contextual-feed`；
- 薄读右栏最多展示 3 条高相关帖子；
- 右栏可收起为 `∿` 图标；
- 每条内容均可打开 Web 详情页；
- 初版排序采用确定性规则：锚点匹配优先，其次论文匹配和“有帮助”信号。

完成标准：发布的内容可在对应论文或句段的薄读右栏回显，且社区文字始终带有用户内容标识。

## 最小 API

```text
POST /v1/drafts/contextual
GET  /v1/drafts/:draftId
POST /v1/posts
GET  /v1/works/:workId
GET  /v1/topics/:topicId
GET  /v1/contextual-feed
```

每个写接口都要求登录、请求 schema 校验、幂等保护和审计字段。读草稿接口按创建者权限过滤；公开内容读取始终过滤撤回状态。互动信号按“帖子 + 用户”唯一保存，用户可在有帮助与有误导性之间切换或撤销；只有有帮助数量对外展示。

## 验收与测试

- API：Node 集成测试覆盖草稿过期、发布幂等、互动信号切换、撤回和权限边界；
- Contracts：Zod schema 和客户端请求/响应契约测试；
- Web：Vitest + Testing Library 覆盖路由、编辑抽屉和错误状态；
- Desktop：定向测试覆盖选区到草稿请求、URL 安全性、右栏加载与失败恢复；
- 端到端：一条“Liteasy 选区 -> Web 发布 -> 薄读右栏回显”的 smoke 流程；
- 构建：桌面端 `npm run build`、Web 构建和 API 测试全部通过。

## 上线前再补齐

PostgreSQL 生产运维、对象存储、Redis 任务队列、图片、通知、关注关系、可信用户编辑权限、审核队列、搜索增强和个性化推荐，都以 MVP 使用数据为依据再引入。
