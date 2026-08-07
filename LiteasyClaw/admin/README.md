# Liteasy 管理后台

独立的 `liteasy-admin` Web 客户端。所有构建均使用 OIDC Authorization Code + PKCE，token 和 OAuth 状态只保存在浏览器 `sessionStorage`。SQLite 开发账号只供 `dev-cloud` 的 loopback 内嵌控制台使用，不能进入该正式管理客户端。

```bash
npm install
npm run dev
npm test
npm run build
```

部署时将管理后台注册为独立 IdP public client，并把 client ID 配置到正式云的 `LITEASY_IDP_ADMIN_CLIENT_ID`。管理后台 origin 必须精确加入 `LITEASY_ALLOWED_ORIGINS`；不得使用通配符。前端只保存公开模型代理策略和公开 HTTPS 检索源元数据，不接收或展示 API 密钥。

`VITE_LITEASY_CLOUD_URL` 指向 Liteasy 正式云，`VITE_INTUECHO_API_URL` 指向 Intuecho 正式 API；生产构建中两者都必须是 HTTPS，省略时使用管理后台自身 origin。管理后台 origin 必须同时进入 Liteasy cloud 与 Intuecho 的精确 CORS 白名单。部署后还需用真实 IdP、MFA 和三个独立 audience 完成浏览器联调；仓库内测试会话不能替代该证据。
