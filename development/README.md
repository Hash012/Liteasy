# Development support

本目录与产品主体隔离，包含仅用于开发、测试和维护的能力：

- `dev-cloud/`：本地真实业务链路；SQLite/本地对象存储，拒绝 staging/production。
- `scripts/`：smoke、发布证据和文档转换脚本。
- `test-data/`：稳定、可审查的测试与评估输入/期望结果。
- `tools/`：脚本所需的独立工具依赖。

`development/` 中的服务不得被生产部署引用。稳定测试放在所属包内，运行时生成结果、数据库、缓存和密钥由 `.gitignore` 排除。

## 运行与验证

```bash
cd development/dev-cloud
npm install
npm start

# 另一个终端执行服务测试或运行态 smoke
npm test
node ../scripts/smoke-dev-cloud.mjs http://127.0.0.1:8787
```

其他仓库脚本及参数见 [scripts/README.md](scripts/README.md)，测试数据本身不作为服务运行。

## 开发测试账号

dev-cloud 不注入固定演示账号。普通测试人员在客户端首次注册 `qa.<姓名或工号>@liteasy.local`；本地管理员由每位开发者自行配置 `.env.local` 后执行 `npm run bootstrap:admin`。`scripts/`、`test-data/` 和 `tools/` 不需要账号。完整步骤见 [dev-cloud/README.md](dev-cloud/README.md#开发测试账号)。
