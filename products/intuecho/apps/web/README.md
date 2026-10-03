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

## 草稿、提交与版本恢复

本机草稿和社区发送记录按 API 环境、身份 issuer、verified subject 与目标隔离；登录会话的 generation 仅作为运行期栅栏，不参与持久所有权。退出不清除原账号草稿，重新登录后必须点击恢复，不自动发送。保存按钮和发送前的本机保存都会核对实际存储结果；配额或存储失败不会显示“已保存”，也不会开始创建请求。本机存储不构成同一 OS 用户内的物理隔离。

普通 annotation/reply（包括读书包）创建使用 `communityCommands.ts`：先在浏览器 Web Locks 下持久化冻结 payload、稳定 operationId 和规范化 SHA-256，再发送 command v1。浏览器不支持 Web Locks 或持久化失败时关闭创建写入。断网、响应丢失、无法验证的回执均为 `outcome_unknown`；操作中心只有用户点击才 GET 原操作回执。查无回执后，显式重试仍使用原 ID 和冻结内容；核实已提交的原草稿不能新建副本。用户主动新建草稿有独立意图 ID，允许合法重复内容。已提交记录不保留冻结正文。

Annotation/reply 内容更新发送客户端看到的 `expectedRevision`。409 保留已保存草稿；可只读查看当前版本，再明确选择以当前修订继续编辑，正文不会自动覆盖。编辑批注、生成独立回复副本、资料或受众变更均重新冻结发送预览；作者资料变化会取消旧确认。普通同范围回复使用轻量发送预览，显示实际接收范围、正文与作者资料；确认发送时再次核对资料，并提交 `expectedAuthorProfileRevision`。派生批注正文编辑绑定原回复修订，冲突核对后仅更新草稿的基础修订，不替换正文。

读书组使用 `collaboration.schemaVersion:1` 识别资料包和主持人摘要；旧标签/中文 Markdown 前缀不自动升级业务类型。空组织可检索可用的已确认资料，或沿用文献 resolver/confirm 流程，不建立占位批注。日期明确按 UTC 当日结束保存。引用保存命名空间、ID、修订与定位信息；引用版本读取和 Desktop 深链接始终保留版本，服务器按当前权限裁决历史读取。个人笔记下载仅包含本人填写的复盘、来源引用及组织来源标识，不复制组织正文或覆盖既有笔记。

运行本地 Web 回归：

```bash
cd products/intuecho
npm ci
npm run test --workspace=@intuecho/web
npm run build --workspace=@intuecho/web
```

Vitest 的 DOM/transport 测试使用合成内容和 mock，不代表真实 IdP、原生端或生产部署通过。API、SQLite 和隔离 PostgreSQL 验证由相应服务测试另行执行。
