# Shared platform

`platform/` 保存跨产品复用、但不属于任一产品业务域的运行服务。当前只有 `identity-service/`，负责账号生命周期协议与 Keycloak Admin REST 的窄适配。

平台服务不得读取 Liteasy 或 Intuecho 的业务数据库，也不得成为两个业务服务共享数据表的捷径。

## 运行与验证

推荐通过本地基础设施启动服务及其 Keycloak 依赖：

```bash
node deployment/local/foundation.mjs prepare
node deployment/local/foundation.mjs start
node deployment/local/foundation.mjs verify
```

只验证 identity-service 代码时运行：

```bash
cd platform/identity-service
npm install
npm test
```

## 开发测试账号

平台层没有可登录的人员账号。`identity-service` 使用独立机器凭据调用 Keycloak，并且不创建用户、不保存密码；Keycloak 的 bootstrap 管理员也不是产品测试账号。产品账号应由 Desktop/Intuecho 的注册流程或目标 IdP 创建。
