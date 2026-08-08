# Liteasy identity-management adapter

This service is the narrow adapter between Liteasy's account-lifecycle protocol
and Keycloak Admin REST. It does not create accounts and does not store passwords.

`POST /v1/accounts/:subjectId/status` accepts only a token issued to the dedicated
`liteasy-account-lifecycle` caller with audience `liteasy-identity-management` and
both `accounts:write` and `sessions:revoke` scopes. A separate confidential client
authenticates RFC 7662 introspection, and another confidential client holds
Keycloak's least-privilege user-management role. Caller, verifier, and administrator
credentials cannot be shared. Authorization also requires the configured issuer.

For `disabled` and `deleted`, the adapter invokes Keycloak's all-session logout
before returning the exact three Liteasy product audiences. A repeated delete is a
desired-state operation: an already absent Keycloak subject is returned as deleted.
Liteasy Cloud still owns the durable cross-service stage ledger and idempotency key.

## 运行与验证

要求 Node.js 20+。推荐由 `deployment/local` 连同 Keycloak 和生成的机器凭据一起启动；只执行代码测试时：

```bash
cd platform/identity-service
npm install
npm test
```

独立启动前必须按 `.env.example` 提供 issuer、introspection 和 Keycloak Admin REST 配置，然后运行 `npm start`。本地完整链路使用：

```bash
node deployment/local/foundation.mjs prepare
node deployment/local/foundation.mjs start
node deployment/local/foundation.mjs verify
```

## 开发测试账号

本服务没有人员登录界面，不提供测试用户，也不存储密码。它只接受 `liteasy-account-lifecycle` 机器 token，并分别使用 introspection client 和最小权限 Keycloak 管理 client。相关 secret 由 `deployment/local/.env` 或目标环境密钥系统生成，不能作为人员账号使用。产品用户须在统一 IdP 注册。

The local foundation in `deployment/local` supplies generated development secrets and
the matching realm clients. Staging and production must use HTTPS, a secret manager,
network isolation, Keycloak audit events, and deployment-specific client roles.
