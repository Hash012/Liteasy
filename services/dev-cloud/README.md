# Liteasy Dev Cloud

这个目录提供一个最小开发后端，用来在本地模拟 Liteasy 的“云侧”两类能力：

- 控制平面策略接口
- 模型生成接口
- 开发云账号演示登录接口
- 关联推荐接口

它的目标不是替代正式云服务，而是让桌面端在开发阶段可以走真实 `http` 链路，而不是只依赖 `mock://` 端点。

## 1. 启动方式

在仓库根目录执行：

```bash
node services/dev-cloud/server.mjs
```

默认会监听：

```text
http://127.0.0.1:8787
```

如果你需要改端口，可以先设置环境变量：

```bash
LITEASY_DEV_CLOUD_PORT=8790 node services/dev-cloud/server.mjs
```

如果你要部署到云端做路演，可以进一步设置：

```bash
LITEASY_DEV_CLOUD_HOST=0.0.0.0 \
LITEASY_DEV_CLOUD_PORT=8787 \
LITEASY_DEV_CLOUD_PUBLIC_ORIGIN=https://你的演示域名 \
node services/dev-cloud/server.mjs
```

说明：

- `LITEASY_DEV_CLOUD_HOST` 控制监听地址
- `LITEASY_DEV_CLOUD_PORT` 控制监听端口
- `LITEASY_DEV_CLOUD_PUBLIC_ORIGIN` 控制根索引、策略返回和内部后台展示时使用的外部访问地址
- `LITEASY_DESKTOP_PUBLIC_ORIGIN` 可选，用于在内部后台中展示桌面入口地址

如果你希望它真正调用 OpenAI，而不是返回开发演示回答，请在启动前配置：

```bash
export OPENAI_API_KEY=你的密钥
```

可选地，你也可以覆盖 OpenAI 基础地址：

```bash
export OPENAI_BASE_URL=https://api.openai.com/v1
```

说明：

- 配置了 `OPENAI_API_KEY`：`POST /v1/model/generate` 会走真实 OpenAI Responses API
- 没配置 `OPENAI_API_KEY`：会自动回退到内置开发回答，便于本地演示

## 2. 提供的接口

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

### 开发云账号

```text
POST /v1/account/demo-login
```

当前用于桌面端原型中的“连接开发云账号”按钮，返回一个固定的演示会话：

```json
{
  "session": {
    "email": "researcher@liteasy.dev",
    "expiresAt": "2026-05-15T09:30:00Z",
    "name": "Liteasy Researcher",
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
      "title": "BERT: Pre-training of Deep Bidirectional Transformers"
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
      "id": "rec-bert-1",
      "reason": "同样关注大规模预训练语言模型的迁移能力。",
      "source": "Semantic Scholar",
      "title": "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
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
      "sourcePath": "fixtures/attention-is-all-you-need.pdf",
      "title": "Attention Is All You Need"
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

- `Liteasy Researcher`
- `researcher@liteasy.dev`

关闭并重新启动桌面端后，上述会话应自动恢复。

连接账号后，点击最左侧窄竖栏的 `设置`，左栏会显示 `文献元数据同步` 卡片。你应该看到：

- `文献同步：已同步 2 篇`
- `最近同步：2026-05-14T10:20:00Z`
- `同步批次：metadata-demo-session-1-r0`

如果你要验证推荐链路，可以在连接账号后于左栏勾选 `BERT: Pre-training of Deep Bidirectional Transformers`，然后检查 `关联推荐` 区域是否出现：

- `RoBERTa: A Robustly Optimized BERT Pretraining Approach`
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
