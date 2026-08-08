# Liteasy product

Liteasy 是桌面优先的科研阅读与学习 Agent 工作台。本目录是软件产品闭包：

```text
apps/desktop/      Tauri + React 用户客户端，也是安装包构建入口
apps/admin/        OIDC/PKCE 管理 Web
services/api/      PostgreSQL/S3 正式业务与管理 API
packages/shared/   Liteasy 内部共享的稳定数据
assets/brand/      产品品牌素材
```

运行链路：桌面开发默认连接仓库根的 `development/dev-cloud`；staging/production 必须连接 `services/api`。管理端连接 Liteasy API 和 Intuecho API，不接收供应商密钥。

## 运行与验证

从仓库根目录运行默认本地开发链路：

```bash
cd development/dev-cloud
npm install

cd ../../products/liteasy/apps/desktop
npm install
npm run dev
```

该命令同时启动 dev-cloud 和 Desktop Vite。完整 Tauri、独立管理端和正式 API 的配置见各子目录 README。

常用验证：

```bash
cd products/liteasy/apps/desktop && npm test && npm run build
cd products/liteasy/apps/admin && npm test && npm run build
cd products/liteasy/services/api && npm test
```

各入口的环境变量、业务边界和运行方式见其目录 README。

## 开发测试账号

Desktop 本地联调不提供固定账号；首次运行后注册 `qa.<姓名或工号>@liteasy.local`，密码由测试人员自行生成并只保存在本机。dev-cloud 管理员通过 `development/dev-cloud` 的 `npm run bootstrap:admin` 引导；正式 Admin/API 使用目标 IdP 中已存在且经授权的 subject，不创建或保存密码。不要把 dev-cloud 的 opaque session 当作正式 OIDC token。
