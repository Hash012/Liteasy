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

## 3. 如何和桌面端联调

启动桌面端后，在右栏 `命令` 模式依次输入：

```text
设置云代理端点为 http://127.0.0.1:8787
设置云端控制平面端点为 http://127.0.0.1:8787
同步云端策略
```

然后你应该在右栏策略卡片中看到：

- `同步状态：已同步`
- `策略版本：dev-policy-v1`
- `最近同步：2026-05-14T09:30:00Z`

之后再完成左栏文献选择与导入，并在右栏发起问答，你会看到回答前缀变为：

```text
开发云回答：
```

这说明桌面端已经不再走内置 `mock://` provider，而是走本地 `http` 开发云服务。

如果你已经配置 `OPENAI_API_KEY`，这里通常不会再看到 `开发云回答：` 前缀，而会得到真实模型输出。

如果你要同时验证账号链路，可以在桌面端顶部点击 `连接开发云账号`，然后检查是否出现：

- `Liteasy Researcher`
- `researcher@liteasy.dev`

关闭并重新启动桌面端后，上述会话应自动恢复。

如果你要验证推荐链路，可以在连接账号后于左栏勾选 `BERT: Pre-training of Deep Bidirectional Transformers`，然后检查 `关联推荐` 区域是否出现：

- `RoBERTa: A Robustly Optimized BERT Pretraining Approach`
- 推荐来源，例如 `Semantic Scholar`
- 推荐理由文字

在当前桌面端中，你还会同时看到：

- 助手消息下方的 `模型链路：...`
- 右栏策略卡片中的 `最近执行：...`

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
