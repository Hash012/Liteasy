# LiteasyClaw Dev Cloud

这个目录提供 LiteasyClaw 的本地开发后端：

- 控制平面策略接口
- 模型生成接口
- 持久化账号注册、登录、会话校验与退出
- 关联推荐接口
- 可迁移的 AI 内容数据模型

它让当前设备充当单机开发服务器。默认只监听回环地址；若进入公网或不可信局域网，必须在前方部署 HTTPS 反向代理。

## 1. 启动方式

第一次启动先安装服务端依赖：

```bash
cd LiteasyClaw/services/dev-cloud
npm install
npm start
```

默认会监听：

```text
http://127.0.0.1:8787
```

如果你需要改端口，可以先设置环境变量：

```bash
LITEASY_DEV_CLOUD_PORT=8790 npm start
```

如果你要部署到云端做路演，可以进一步设置：

```bash
LITEASY_DEV_CLOUD_HOST=0.0.0.0 \
LITEASY_DEV_CLOUD_PORT=8787 \
LITEASY_DEV_CLOUD_PUBLIC_ORIGIN=https://你的演示域名 \
LITEASY_DEV_CLOUD_ALLOWED_ORIGINS=https://你的桌面Web域名 \
npm start
```

说明：

- `LITEASY_DEV_CLOUD_HOST` 控制监听地址
- `LITEASY_DEV_CLOUD_PORT` 控制监听端口
- `LITEASY_DEV_CLOUD_PUBLIC_ORIGIN` 控制根索引、策略返回和内部后台展示时使用的外部访问地址
- `LITEASY_DESKTOP_PUBLIC_ORIGIN` 可选，用于在内部后台中展示桌面入口地址
- `LITEASY_DEV_CLOUD_ALLOWED_ORIGINS` 是额外允许的浏览器 Origin，多个值用英文逗号分隔
- `LITEASY_DEV_CLOUD_DATABASE_PATH` 可覆盖 SQLite 文件位置

默认数据库位于：

```text
LiteasyClaw/services/dev-cloud/.liteasy-data/liteasy.sqlite
```

服务首次启动会自动执行 `db/migrations/` 中尚未应用的迁移。SQLite 使用 WAL、外键约束和 busy timeout；数据库目录权限收紧为 `0700`，数据库及 WAL 文件为 `0600`。

## 2. 账号与安全

桌面端登录面板支持创建账号和已有账号登录。账号重启服务后仍然存在。

```text
POST /v1/account/register
POST /v1/account/login
POST /v1/account/session
POST /v1/account/logout
```

注册请求示例：

```json
{
  "displayName": "Tian",
  "email": "tian@example.com",
  "password": "a long private passphrase"
}
```

安全边界：

- 密码要求 12–128 位，使用带独立随机盐的 Argon2id 哈希；明文密码不会落盘。
- 登录令牌由 256-bit 安全随机数生成，数据库只保存 SHA-256 摘要。
- 会话默认 7 天有效，可校验和主动撤销。
- 注册与登录有单进程限速；反向代理仍应增加 IP 级限流。
- JSON 请求限制为 64 KiB，并设置 `no-store`、`nosniff` 等响应头。
- 浏览器 CORS 默认只允许 localhost/127.0.0.1；额外来源必须显式配置。

不要把本服务以裸 HTTP 直接暴露到公网。HTTPS 是保护传输中密码和会话令牌的必要条件。

## 3. 可扩展数据模型

`001_identity_and_content.sql` 已建立以下稳定关系：

- `users` / `password_credentials` / `auth_sessions`
- `projects`
- `artifacts` / `artifact_versions`
- `generation_runs` / `generation_steps`

流程图、思维导图、动画等类型使用 `artifact_type` 区分；具体结构进入版本化 JSON 载荷。模型输入、运行状态和中间生成产物分别进入 run/step，避免覆盖最终成品，也便于以后审计、重放和迁移到 PostgreSQL 或对象存储。

### 路演前重置或重新播种旧 Demo 数据

如果你要在路演前恢复稳定演示状态，可以在仓库根目录运行：

```bash
node LiteasyClaw/scripts/reset-demo-data.mjs
node LiteasyClaw/scripts/reseed-demo-data.mjs
```

说明：

- `reset-demo-data.mjs` 会清空当前 demo 持久化数据
- `reseed-demo-data.mjs` 会写回稳定的路演初始状态
- 两个脚本只重置旧组织、收藏、推荐缓存等 JSON demo 数据，不删除真实账号 SQLite 数据

如果你希望启动后先做统一 smoke check，可执行：

```bash
node LiteasyClaw/scripts/smoke-roadshow.mjs http://127.0.0.1:8787
```

它会检查：

- `/`
- `/healthz`
- `/admin/`
- `/v1/admin/demo-state`

如果你希望它真正调用 OpenAI，而不是返回开发演示回答，请在启动前配置：

```bash
export OPENAI_API_KEY=你的密钥
```

也可以写入不会提交的本地文件，dev-cloud 启动时会自动读取：

```bash
cd LiteasyClaw/services/dev-cloud
printf 'OPENAI_API_KEY=你的密钥\n' > .env.local
node server.mjs
```

可选地，你也可以覆盖 OpenAI 基础地址：

```bash
export OPENAI_BASE_URL=https://api.openai.com/v1
```

若兼容端点不提供默认的 `gpt-5-mini`，启动桌面开发进程前设置：

```bash
export VITE_LITEASY_OPENAI_MODEL=端点实际支持的模型ID
```

说明：

- 配置了 `OPENAI_API_KEY`：`POST /v1/model/generate` 会走真实 OpenAI Responses API；`POST /v1/model/generate-stream` 把 Responses SSE 转成浏览器易消费的 NDJSON delta
- 没配置 `OPENAI_API_KEY`：会自动回退到内置开发回答，便于本地演示；命令模式 planner 不会再为主题命令合成结构化动作

如果你希望改用 DeepSeek，请配置 DeepSeek key 和默认 provider：

```bash
export DEEPSEEK_API_KEY=你的密钥
export DEEPSEEK_BASE_URL=https://api.deepseek.com
export LITEASY_MODEL_PROVIDER=deepseek
```

对应的 `.env.local` 写法：

```bash
cd LiteasyClaw/services/dev-cloud
printf 'DEEPSEEK_API_KEY=你的密钥\nDEEPSEEK_BASE_URL=https://api.deepseek.com\nLITEASY_MODEL_PROVIDER=deepseek\n' > .env.local
node server.mjs
```

说明：

- 配置了 `DEEPSEEK_API_KEY` 且请求体 `provider` 为 `deepseek`：`POST /v1/model/generate` 会走 DeepSeek Chat Completions API
- 桌面端在默认 provider 为 `deepseek` 时会使用 `deepseek-v4-flash`

## 4. 其他接口

### 控制平面

```text
GET /v1/admin/model-policy
```

返回：

- `cloudProxyEndpoint`
- `defaultProvider`
- `localDirectEnabled`
- `localDirectEndpoint`
- `modelAccessMode`
- `policyVersion`
- `syncedAt`

### Admin Demo State

```text
GET /v1/admin/demo-state
```

返回当前路演 demo 的聚合状态，例如：

- 活跃会话数
- 收藏总数
- 推荐缓存条目数
- 组织数
- 最近活动列表

这个接口主要给 `/admin/` 运维端使用。

### 模型生成

```text
POST /v1/model/generate
```

请求体示例：

```json
{
  "model": "gpt-5-mini",
  "prompt": "问题：BERT 的核心方法是什么？",
  "provider": "openai",
  "source": "cloud_proxy"
}
```

当前开发版会返回一个确定性的演示回答，例如：

```json
{
  "answer": "开发云回答：BERT 的核心方法是什么？",
  "execution": {
    "backend": "dev_cloud",
    "mode": "mock_fallback",
    "provider": "mock"
  }
}
```

如果已配置 `OPENAI_API_KEY`，则这里会返回真实 OpenAI 生成结果。

DeepSeek 请求体示例：

```json
{
  "model": "deepseek-v4-flash",
  "prompt": "问题：LiteasyClaw 的命令模式应该做什么？",
  "provider": "deepseek",
  "source": "cloud_proxy"
}
```

### 模型审计

```text
POST /v1/model/audit
```

请求体示例：

```json
{
  "answer": "开发云回答：BERT 的核心方法是什么？",
  "citations": [
    {
      "paperId": "demo-2",
      "page": 7,
      "snippet": "deep bidirectional representations are pre-trained"
    }
  ],
  "model": "gpt-5-mini-auditor",
  "provider": "openai",
  "question": "BERT 的核心方法是什么？",
  "retrievalConfidence": 0.86,
  "source": "cloud_proxy"
}
```

当前开发版会返回确定性的审计回执：

```json
{
  "audit": {
    "model": "gpt-5-mini-auditor",
    "rationale": "开发云审计确认回答包含可追溯引用。",
    "score": 0.86,
    "verdict": "pass"
  }
}
```

说明：

- 桌面端在使用 `http` 云代理端点时，会在生成回答后调用这个审计接口
- 如果审计接口不可用，桌面端会回退到本地审计 seam，保证问答流程不中断
- 当前开发云审计仍是确定性规则，后续可以替换成第二个真实大模型调用

### 兼容 Demo 账号

```text
POST /v1/account/demo-login
```

当前用于桌面端原型中的“连接开发云账号”按钮，返回一个固定的演示会话：

```json
{
  "session": {
    "email": "researcher@liteasy.dev",
    "expiresAt": "2026-05-15T09:30:00Z",
    "name": "LiteasyClaw Researcher",
    "sessionId": "demo-session-1"
  }
}
```

说明：

- 这不是正式账号体系，只是开发阶段的可视化联调入口
- 目的是先打通“桌面端连接云账号并在本地恢复会话”的产品链路
- 后续真正账号体系会替换成正式鉴权与云端会话管理

### 关联推荐

```text
POST /v1/recommendations
```

请求体示例：

```json
{
  "selectedDocuments": [
    {
      "id": "demo-2",
      "title": "Survey of Vector Database Management Systems"
    }
  ],
  "sessionId": "demo-session-1"
}
```

当前开发版会返回一组固定的演示推荐，例如：

```json
{
  "recommendations": [
    {
      "id": "rec-vdbms-1",
      "reason": "同样关注向量数据库系统架构与相似度检索能力。",
      "source": "Semantic Scholar",
      "title": "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
    }
  ]
}
```

说明：

- 当前只是开发期演示推荐，不代表真实线上召回
- 目的是先把“账号已连接 -> 勾选文献 -> 左栏显示推荐”这条链路打通
- 后续可以在这里替换成真实推荐、缓存和可信度排序服务

### 文献元数据同步

```text
POST /v1/documents/metadata-sync
```

请求体示例：

```json
{
  "documents": [
    {
      "id": "demo-1",
      "sourcePath": "/papers/colbert-late-interaction.pdf",
      "title": "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
    }
  ],
  "sessionId": "demo-session-1",
  "workspaceRevision": 0
}
```

当前开发版会返回固定的同步回执：

```json
{
  "result": {
    "acceptedCount": 1,
    "rejectedCount": 0,
    "syncId": "metadata-demo-session-1-r0",
    "syncedAt": "2026-05-14T10:20:00Z"
  }
}
```

说明：

- 当前只同步当前工作区可见文献的基础元数据
- 不上传 PDF 原文或解析块内容
- 目的是先打通“连接云账号 -> 当前工作区元数据同步 -> 桌面端可见回执”的链路

## 3. 如何和桌面端联调

启动桌面端后，在右栏 `命令` 模式依次输入：

```text
设置云代理端点为 http://127.0.0.1:8787
设置云端控制平面端点为 http://127.0.0.1:8787
同步云端策略
```

然后点击最左侧窄竖栏的 `设置`，你应该在模型策略卡片中看到：

- `同步状态：已同步`
- `策略版本：dev-policy-v1`
- `最近同步：2026-05-14T09:30:00Z`

之后再完成左栏文献选择与导入，并在右栏发起问答，你会看到回答前缀变为：

```text
开发云回答：
```

这说明桌面端已经不再走内置 `mock://` provider，而是走本地 `http` 开发云服务。

如果你已经配置 `OPENAI_API_KEY`，这里通常不会再看到 `开发云回答：` 前缀，而会得到真实模型输出。

同一条问答回复下方还会显示 `模型审计` 卡片。使用开发云端点时，审计结果来自：

```text
POST /v1/model/audit
```

你应该能看到 `审计模型 gpt-5-mini-auditor`、`审计评分` 和审计理由。

如果你要同时验证账号链路，可以在桌面端顶部点击 `连接开发云账号`，然后检查是否出现：

- `LiteasyClaw Researcher`
- `researcher@liteasy.dev`

关闭并重新启动桌面端后，上述会话应自动恢复。

连接账号后，点击最左侧窄竖栏的 `设置`，左栏会显示 `文献元数据同步` 卡片。你应该看到：

- `文献同步：已同步 3 篇`
- `最近同步：2026-05-14T10:20:00Z`
- `同步批次：metadata-demo-session-1-r0`

如果你要验证推荐链路，可以在连接账号后于左栏勾选 `Survey of Vector Database Management Systems`，然后检查 `关联推荐` 区域是否出现：

- `VBASE: Unifying Online Vector Similarity Search and Relational Queries`
- 推荐来源，例如 `Semantic Scholar`
- 推荐理由文字

在当前桌面端中，你还会同时看到：

- 助手消息下方的 `模型链路：...`
- 左边栏 `设置` 页面模型策略卡片中的 `最近执行：...`

它们会帮助你区分当前是：

- `云代理 -> 桌面内置 Mock`
- `云代理 -> 开发云回退 Mock`
- `云代理 -> 开发云 -> OpenAI`

## 4. 适用边界

当前目录只用于开发联调，不包含：

- 正式鉴权
- 多租户隔离
- 真实 PDF 解析
- 正式模型计费与限流
- 管理员控制台

这些属于后续真正云服务的范围。
