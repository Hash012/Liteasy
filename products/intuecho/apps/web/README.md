# Intuecho Web

Intuecho 论坛的 React Web 客户端。它通过 OIDC Authorization Code + PKCE 获取 `intuecho-web` 会话，并调用同产品域下的 `services/api`；不读取 Liteasy 本地 PDF、私有笔记或桌面会话。

## 核心结构

- `src/main.tsx`：唯一运行入口，加载 `AnnotationApp` 和对应样式。
- `src/AnnotationApp.tsx`：标注广场、关注、消息、个人批注、组织治理和学术资料的界面编排。
- `src/communityApi.ts`：现行标注社区 HTTP 客户端；不包含历史主题、帖子和草稿接口。
- `src/community.types.ts`：社区领域的请求、响应和展示类型。
- `src/identityClient.ts`：OIDC、开发身份会话和鉴权失效处理。
- `src/identity.types.ts`：身份模式与会话类型。开发身份模块只依赖此文件，避免动态导入形成循环。
- `src/runtimeConfig.ts`：Intuecho API 地址的唯一解析入口。
- `src/developmentIdentity.ts` 与 `src/DevelopmentAuthForm.tsx`：仅在 Vite 开发模式加载的真实本地账号链路。

依赖方向为：

```text
main -> AnnotationApp -> communityApi -> identityClient -> runtimeConfig
                         community.types   identity.types
DevelopmentAuthForm -> developmentIdentity -> identity.types
```

界面层不得直接拼接 API 地址或读写身份存储；社区类型不得依赖 React、身份实现或界面组件。文件名遵循现有 TypeScript 约定：组件用 `PascalCase.tsx`，客户端与配置用 `camelCase.ts`，领域类型用 `<domain>.types.ts`。

## 运行与验证

使用三个终端依次启动身份服务、论坛 API 和 Web：

```bash
# 终端一
cd development/dev-cloud
npm install
npm start

# 终端二
cd products/intuecho
npm install
LITEASY_IDENTITY_ENDPOINT=http://127.0.0.1:8787 npm run dev:api

# 终端三
cd products/intuecho
npm run dev:web
```

验证 Web 构建：

```bash
cd products/intuecho
npm run build --workspace=@intuecho/web
```

浏览器地址为 `http://127.0.0.1:5174`。本地默认身份地址为 `http://127.0.0.1:8787`，论坛 API 为 `http://127.0.0.1:4040`；需要覆盖时设置下述 Vite 变量后重启开发服务器。

公开配置使用 `VITE_LITEASY_IDENTITY_URL` 和 `VITE_INTUECHO_API_URL`。生产构建、会话存储和跨端交接边界见上级 [README](../../README.md)。

## 开发测试账号

Web 没有预置账号。本地三项服务均为 loopback 时，登录页会提供真实 dev-cloud 注册入口；建议邮箱为 `qa.<姓名或工号>@liteasy.local`，密码为个人保管的 12–128 位值。公开广场可匿名查看，其余写操作使用注册后签发的 `intuecho-web` 会话。不要在浏览器配置、截图或缺陷单中记录密码和 token。
