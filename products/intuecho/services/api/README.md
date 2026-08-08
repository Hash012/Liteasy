# Intuecho API

Intuecho 的独立论坛后端。开发入口 `src/server.mjs` 使用外置 SQLite；正式入口 `src/productionServer.mjs` 只接受 PostgreSQL，并在监听前验证迁移、OIDC/JWKS、token introspection 和 Liteasy 管理 API readiness。

## 运行与验证

```bash
cd products/intuecho
npm install
LITEASY_IDENTITY_ENDPOINT=http://127.0.0.1:8787 npm run dev:api
```

在另一个终端验证：

```bash
cd products/intuecho
npm test
npm run check --workspace=@intuecho/api
```

开发 API 默认位于 `http://127.0.0.1:4040`。写接口联调前还需启动 `development/dev-cloud`；未设置 `LITEASY_IDENTITY_ENDPOINT` 时写操作会失败关闭。SQLite 数据路径和其他开发变量见上级 [README](../../README.md)。

正式迁移和启动：

```bash
npm run migrate --workspace=@intuecho/api
npm start --workspace=@intuecho/api
```

论坛必须使用独立数据库、在线角色和 migrator。组织权限通过专用机器身份调用 Liteasy API，不能转交用户 token。完整路由、数据模型和环境变量见上级 [README](../../README.md) 与 `.env.example`。

## 开发测试账号

API 本身不创建账号、不保存密码。公开读取不需要账号；写接口使用 dev-cloud/统一 IdP 签发的 `intuecho-web` Bearer token。测试人员通过 Web 注册 `qa.<姓名或工号>@liteasy.local`，不要使用数据库角色或 confidential client 凭据登录。治理接口还要求 Liteasy 平台管理员身份和新鲜 MFA，没有仓库固定管理员。
