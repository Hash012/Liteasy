# Deployment

这是仓库唯一的基础设施与部署编排入口。应用实现仍位于各产品/平台目录；本目录只保存环境配置 schema、容器编排、迁移调用和部署验证。

当前 `local/` 是可重建的本地 Linux 基础设施，包含 PostgreSQL、Keycloak 和公共身份适配器，明确不是生产部署。运行方式见 [local/README.md](local/README.md)。`staging/` 是面向阿里云香港 ECS、托管 PostgreSQL 和私有对象存储的首个远程预发布定义，部署门禁、域名、容量边界及已知阻断见 [staging/README.md](staging/README.md)。

`scripts/` 保存部署门禁检查。未来 production 定义应使用独立环境目录，并使用受审镜像 digest、密钥管理、可信 TLS、备份/PITR、监控和网络策略；不得把 staging 原地提升为生产，也不得复制本地 SQLite、Docker volume、自签名私钥或 `.env` 上线。

## 运行与验证

要求 Node.js 20+、Docker Engine 和 Docker Compose v2。从仓库根目录执行：

```bash
node deployment/local/foundation.mjs prepare
node deployment/local/foundation.mjs start
node deployment/local/foundation.mjs migrate
node deployment/local/foundation.mjs verify
node deployment/local/foundation.mjs status
```

停止但保留 volume：`node deployment/local/foundation.mjs stop`。故障诊断和独立 PostgreSQL 集成测试见 [local/README.md](local/README.md)。

## 开发测试账号

基础设施不会导入产品测试用户。`prepare` 生成的 Keycloak bootstrap 管理员只用于维护 Keycloak，不得用于 Liteasy/Intuecho 登录；产品测试人员应通过本地 Keycloak 注册流程创建个人账号。生成的数据库角色和 confidential client 均为机器身份，其凭据位于被 Git 忽略且权限为 `0600` 的 `deployment/local/.env`，不得当作人员账号或写入文档。
