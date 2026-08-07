# Intuecho

Intuecho 是与 Liteasy 共用身份源、但保持独立业务数据和 `intuecho-web` 会话受众的文献批注社区。论坛不会读取 Liteasy 本地 PDF、私有笔记或桌面端会话。

社区的唯一广场内容实体是 `annotation`。`reply` 是独立互动记录，不复用 annotation 表：无文献目标时只保留回复；带文献目标时，同一事务再创建一条独立 annotation，并以 `sourceReplyId` 保持正文同步。删除父 annotation 会关闭回复投影，但派生 annotation 保留，详情只显示“原回复对象已删除”。每条 annotation 始终至少关联一篇文献或一处原文字句；薄读生成内容必须同时携带对应原文 evidence。旧 `topic/work/post/comment` API 只用于迁移兼容，不再作为新功能的数据模型。

## 本地开发

先启动统一身份服务：

```bash
cd LiteasyClaw/services/dev-cloud
npm start
```

再分别启动论坛 API 和 Web：

```bash
cd Intuecho
LITEASY_IDENTITY_ENDPOINT=http://127.0.0.1:8787 npm run dev:api
npm run dev:web
```

打开 <http://127.0.0.1:5174>。论坛 API 位于 `http://127.0.0.1:4040`，开发 SQLite 默认保存在操作系统用户数据目录（Linux 通常为 `~/.local/share/liteasy/intuecho/intuecho.sqlite`），不再写入服务发布目录。若新位置尚无数据库且检测到旧 `services/api/data/intuecho.db`，首次启动会校验复制到新位置，但保留旧文件。

可配置项：

- `LITEASY_IDENTITY_ENDPOINT`：论坛 API 用于校验 `intuecho-web` 和桌面交接 Bearer 会话的统一身份服务地址。未配置时写操作关闭并返回服务不可用。
- `INTUECHO_WEB_ORIGIN`：允许调用论坛 API 的 Web Origin，默认 `http://127.0.0.1:5174`。
- `INTUECHO_DESKTOP_ORIGINS`：逗号分隔的精确桌面 WebView Origin；开发默认只包含 `127.0.0.1/localhost:1420` 与 Tauri 本机 Origin，不接受通配符。
- `INTUECHO_DATABASE_PATH`：开发数据库的绝对或相对路径，必须位于 `services/api` 发布目录外。
- `VITE_LITEASY_IDENTITY_URL`：Web 登录、注册、恢复和退出所用身份服务地址。
- `VITE_INTUECHO_API_URL`：Web 所用论坛 API 地址。

数据库首次启动只创建空表，不自动写入主题、论文、帖子、账号或其他样例数据。测试数据仅由测试进程显式插入。

开发 SQLite 适配器在 `NODE_ENV=staging|production` 时强制拒绝运行，不得用配置外部路径绕过。Web 只有在 Vite 开发构建、论坛 API 和身份 API 都是 HTTP loopback，且正式身份配置端点返回 `404` 时才展示开发密码登录；其他环境失败关闭。

## 正式服务

`services/api/src/productionServer.mjs` 是独立的正式运行入口，`npm start --workspace=@intuecho/api` 默认启动该入口。它只接受 PostgreSQL，并在监听端口前验证：

- PostgreSQL 15+ 可写主库、强制 TLS 配置和完整不可变迁移集合；
- OIDC discovery、JWKS、JWT 签名以及每次请求的 RFC 7662 token 活跃状态；
- `intuecho-web`、`liteasy-desktop` 和 `liteasy-admin` 精确用户 audience；桌面 audience 只允许调用专用交接、批注和推荐路由；
- 独立 Liteasy 管理 API readiness。论坛治理会把管理员 token 交给 `/v1/admin/me` 再次确认 `platform_admin`，不信任 token 自报角色；治理写操作还要求五分钟内的新鲜 MFA。
- Intuecho 到 Liteasy 的组织权限调用使用专用 client-credentials 身份：`liteasy-internal` audience、`intuecho-organization-service` client 和 `organization:authorize` scope。用户 token 不跨服务转交，组织成员及邀请权限仍由 Liteasy PostgreSQL 实时裁决。

复制 `services/api/.env.example` 所列配置到部署密钥系统。论坛必须使用独立数据库、独立在线角色和独立 migrator，不能复用 Liteasy cloud 的数据库、连接池或凭据。先执行：

```bash
cd Intuecho
npm run migrate --workspace=@intuecho/api
npm start --workspace=@intuecho/api
```

迁移使用 advisory lock 和 SHA-256 校验；已经应用的 SQL 文件不可修改。在线账号没有 DDL 权限，旧 `moderation_audit`、批注治理审计、标签申诉审核审计和账号生命周期审计均禁止更新和删除。空数据库不会注入主题、文献、批注或账号。

正式 Web 从 `/v1/identity/web-config` 获取公开 OIDC 客户端配置，使用 Authorization Code + PKCE。OIDC token 和刷新状态只进入浏览器 `sessionStorage`；邮箱密码由统一身份页处理，不进入 Intuecho Web 或论坛 API。

账号删除由 Liteasy 的持久生命周期工作流调用 `POST /v1/admin/accounts/:subjectId/delete`。Intuecho 会重新验证 `liteasy-admin` audience、中心 `platform_admin` 角色和五分钟内的新鲜 MFA，不能仅信任内部网络或上游自报角色。事务会删除交接、同步、资料、关注/互关、私聊、保存/评价、标签申诉和非公开批注回复树及其版本；公开批注、公开回复以及迁移兼容的公开帖子/评论保留正文，但作者 ID 替换为不可反查的 `deleted:<uuid>`，资料快照和历史版本归属同步去身份化。治理审计保留原批注 ID 字符串，即使非公开正文已按生命周期删除，审计本身仍不可更新或删除。删除回执按操作键幂等保存，换键重放同一主体会拒绝；`account_lifecycle_audit` 由数据库触发器禁止更新和删除。

## 批注社区规则

- 可见范围为公开、仅自己、指定组织、仅互相关注用户；回复继承原批注的可见范围。带目标的回复会产生一条同范围的独立 annotation，只有公开范围可进入广场。
- 评分是 1–5 星整数；每位用户对每条 annotation 只有一个当前评分，可改分且禁止自评。纯 reply 没有独立评分入口。
- 用户标签持久保存；平台使用本地语义特征算法赋予持久标签，不依赖 LLM API。作者可申诉平台标签，管理员通过新鲜 MFA 审核，决定与原因写入追加写审计。
- `/A` 查询只把 `A` 作为本次请求的动态语义分类标准，不保存为标签或用户资料。
- 机构名称和学段来自作者资料的发布/最后编辑快照；机构没有额外“类型”字段，用户属于多个机构时按名称任一存在匹配。广场还支持最新、推荐、指定文献和文献类型筛选。
- 组织范围批注只对所选组织的当前成员可见；作者离开后保留查看和删除权，但不能编辑或新增该组织内容。当前 owner/admin 可通过组织权限服务实时授权后撤回或恢复，并留下追加写审计。
- 只有当前互相关注的用户可以新建私聊或发送新消息；解除互关后保留历史但禁止续发。组织邀请是结构化消息卡片，并由 Liteasy 组织权限服务实际创建邀请。
- Web 的“组织批注”从 Liteasy 机器身份接口取得当前组织清单，不要求用户手输组织 ID 才能浏览；普通成员只看到未撤回内容，owner/admin 可看到撤回项并填写治理原因执行恢复。

## 验证

```bash
cd Intuecho
npm test
npm run build
```

正式 PostgreSQL 集成测试还要求两个指向同一个 loopback `_test` 数据库、但使用不同角色的连接串：

```bash
INTUECHO_TEST_DATABASE_URL=postgresql://intuecho_app:...@127.0.0.1:5432/intuecho_test \
INTUECHO_TEST_MIGRATION_DATABASE_URL=postgresql://intuecho_migrator:...@127.0.0.1:5432/intuecho_test \
npm run test:postgres:integration --workspace=@intuecho/api
```

测试脚本会拒绝非 loopback、数据库名不以 `_test` 结尾、数据库不同或角色相同的目标。它验证 `001–009` 并在隔离测试库中清空业务表后执行，覆盖批注多目标与薄读 evidence、独立回复/派生 annotation、星级、筛选、标签申诉/审核、组织 owner/admin 授权回调、互关私聊/邀请、治理审计、编辑历史、账号删除、公开历史去身份化、幂等重放和审计防篡改。不要对共享开发或生产数据库运行。

本地基础设施已有不输出 secret 的包装命令：

```bash
node deploy/local/verify-intuecho-postgres-integration.mjs
```

## 边界

`apps/web/` 是 React Web，`services/api/` 同时包含明确隔离的开发 SQLite 适配器和正式 PostgreSQL 服务，`packages/contracts/` 保存共享 API 契约。公开广场允许匿名读取；批注发布、回复、互动及个人数据接口必须使用 `Authorization: Bearer <intuecho-web token>`。桌面端只把短期交接编号传给 Web，不把 `liteasy-desktop` token 交给浏览器；Web 使用自己的会话消费交接，并要求两个会话的统一用户 ID 相同。作者权限按统一用户 ID 判断，不按昵称判断。

仓库实现不等于生产部署完成。上线前仍需取得独立数据库时间点恢复、静态加密、TLS、真实 IdP/PKCE、管理员 MFA、全 audience 会话吊销和浏览器端到端证据。
