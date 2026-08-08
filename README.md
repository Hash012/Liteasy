# Liteasy workspace

本仓库包含三个并列产品主体，以及它们依赖的服务、部署和开发支持代码：

```text
products/
  liteasy/                 Liteasy 桌面软件、管理端、正式 API 与共享产品数据
  intuecho/                Intuecho 论坛 Web、论坛 API 与 API 契约
  marketing/               独立营销站点
platform/
  identity-service/        两个产品共用的账号生命周期与 Keycloak 适配器
development/
  dev-cloud/               仅限本地开发的真实业务链路
  scripts/                 smoke、发布证据和文档工具
  test-data/               可重复使用的测试与评估数据
  tools/                   开发工具依赖
deployment/                可重建的基础设施、迁移与部署验证入口
docs/                      产品、设计、工程、QA 与运维文档
archive/                   历史材料，不作为当前实现依据
.github/workflows/         Windows 安装包构建与分发自动化
```

目录按业务域组织，运行边界保持独立。详细约束见 [仓库结构与命名规范](docs/engineering/repository-structure.md)。

## 核心链路

```text
Liteasy Desktop - local development -> development/dev-cloud
                - staging/production -> products/liteasy/services/api

Intuecho Web -> products/intuecho/services/api
                    - OIDC/token verification -> shared identity provider
                    - organization authorization -> Liteasy API

Liteasy Admin -> Liteasy API + Intuecho API
deployment -> PostgreSQL + Keycloak + identity-service + migrations/verification
```

`development/dev-cloud` 使用 SQLite 和本地对象目录实现真实注册、会话和持久化，但会拒绝在 staging/production 运行。正式 Liteasy API 使用 PostgreSQL/S3；Intuecho 正式 API 使用独立 PostgreSQL。仓库中存在实现不代表已完成生产环境验收，具体门禁见 [部署与验收计划](docs/operations/Liteasy-后续部署与验收执行计划.md)。

结构调整后的验证覆盖与未完成能力见 [仓库结构与能力审计](docs/qa/2026-08-08-repository-structure-and-capability-audit.md)。

## 主体入口

- [Liteasy 产品](products/liteasy/README.md)
- [Liteasy Desktop](products/liteasy/apps/desktop/README.md)
- [Liteasy Admin](products/liteasy/apps/admin/README.md)
- [Liteasy API](products/liteasy/services/api/README.md)
- [Intuecho](products/intuecho/README.md)
- [Marketing](products/marketing/README.md)
- [公共身份服务](platform/identity-service/README.md)
- [本地开发支持](development/README.md)
- [部署](deployment/README.md)
- [文档索引](docs/README.md)

## 构建与分发边界

桌面安装包定义与应用版本强相关，因此保留在 `products/liteasy/apps/desktop/src-tauri/`；GitHub 要求自动化入口位于 `.github/workflows/`。标签或手动触发 `windows-installer.yml` 后，Windows runner 会测试前端和 Rust、构建 NSIS，并上传临时安装包 artifact。生成的 `.exe`、`dist/` 和 `target/` 不进入源码仓库。服务器环境编排独立位于 `deployment/`，不得与桌面安装包混用。

## 本地开发

要求 Node.js 20+；完整桌面打包还要求 Rust/Cargo 和 Tauri 的系统依赖。

首次安装依赖后，从桌面目录用一个命令同时启动本地开发 API 和 Vite：

```bash
cd development/dev-cloud
npm install

cd ../../products/liteasy/apps/desktop
npm install
npm run dev
```

默认打开 `http://127.0.0.1:1420`，dev-cloud 默认位于 `http://127.0.0.1:8787`。只运行前端或完整 Tauri 壳的命令见 [桌面 README](products/liteasy/apps/desktop/README.md)。

启动论坛时保持 dev-cloud 已运行，并在两个终端分别启动 API 和 Web：

```bash
# 终端一
cd products/intuecho
npm install
LITEASY_IDENTITY_ENDPOINT=http://127.0.0.1:8787 npm run dev:api

# 终端二
cd products/intuecho
npm run dev:web
```

模型和外部服务密钥只写入 `development/dev-cloud/.env.local`，不得提交。不要创建演示账号或用 mock 结果冒充业务成功。

## 开发测试账号

仓库不内置、也不共享固定的普通用户账号和密码。开发或测试人员首次运行后在 Desktop 或 Intuecho 的注册界面创建自己的账号，建议邮箱使用 `qa.<姓名或工号>@liteasy.local`，密码使用个人密码管理器生成的 12–128 位值；账号和密码只保存在本机开发数据中，不写入 README、Git 或群聊。同一账号可分别登录 `liteasy-desktop` 和 `intuecho-web`，但两个客户端会签发各自 audience 的会话，不能互换 token。

需要验证本地治理能力时，由测试人员在 `development/dev-cloud/.env.local` 自行设置 `LITEASY_ADMIN_EMAIL`、`LITEASY_ADMIN_PASSWORD` 和至少 32 字符的 `LITEASY_MFA_MASTER_KEY`，再执行 `npm run bootstrap:admin`。管理员没有仓库级固定账号；具体引导与 MFA 步骤见 [dev-cloud README](development/dev-cloud/README.md)。正式 Keycloak、本地基础设施以及生产 API 同样不预置产品测试用户。

## 验证

```bash
cd products/liteasy/apps/desktop && npm test && npm run build
cd products/liteasy/apps/admin && npm test && npm run build
cd products/liteasy/services/api && npm test
cd products/intuecho && npm test && npm run build
cd development/dev-cloud && npm test
cd platform/identity-service && npm test
```

本地基础设施命令见 [deployment/local/README.md](deployment/local/README.md)。

## 桌面代码边界

桌面端保持以下依赖方向：

```text
layout -> controllers -> features -> shared types / clients
```

`AppShell` 只做组合；跨模块行为进入 `src/app/controllers/`；领域实现进入对应 feature；feature 不得反向导入 layout。Fluent 2 组件、图标、活动栏和布局 token 是当前 UI 基线。
