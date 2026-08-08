# Product domains

`products/` 只存放用户或运营人员直接使用的产品主体，以及与主体强内聚的业务 API/契约。

- `liteasy/`：桌面客户端、管理端、Liteasy 正式 API 和共享产品数据。
- `intuecho/`：论坛 Web、独立论坛 API 和接口契约。
- `marketing/`：独立静态营销站。

跨产品基础能力进入 `platform/`；开发替身、测试数据和工具进入 `development/`；部署编排进入 `deployment/`。

## 运行与验证

Liteasy Desktop 与 dev-cloud：

```bash
npm install --prefix development/dev-cloud
cd products/liteasy/apps/desktop && npm install && npm run dev
```

Intuecho 需要保持 dev-cloud 已运行，并为 API 与 Web 分别打开终端：

```bash
# 终端一
cd development/dev-cloud && npm install && npm start
```

```bash
# 终端二
cd products/intuecho && npm install
LITEASY_IDENTITY_ENDPOINT=http://127.0.0.1:8787 npm run dev:api
```

```bash
# 终端三
cd products/intuecho && npm run dev:web
```

静态营销站：

```bash
python3 -m http.server 8080 --directory products/marketing
```

正式 Liteasy API 和管理端依赖 PostgreSQL、S3、OIDC 等部署配置，不属于默认本地桌面链路；各产品的完整前置条件和测试命令见其 README。

## 开发测试账号

`products/` 不保存固定账号或密码。Desktop 与 Intuecho 的本地联调账号由测试人员在 dev-cloud 注册，建议使用 `qa.<姓名或工号>@liteasy.local`；管理账号由 dev-cloud 引导脚本或目标环境 IdP 创建。Marketing 无登录。详细边界见仓库根 [README](../README.md#开发测试账号)。
