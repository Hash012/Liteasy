# Liteasy Personal Context v0.2

2026-11-26，依据用户提供的 `Liteasy-Personal-Context-SPEC-2026-11-26.zip`。

## 决定

采用 owner-private 的通用 ContextEntry：profile、understanding、progress、idea、group_background、reference。
`scopeKey` 只允许 `personal` 或 `project/<slug>`，表示同一账号内归组和凭据范围，不代表共享权限。
不要求创建 Project 或 Session。`owner`、`actor`、ID、revision 和时间均由服务端注入。
普通 update 提交完整 entry，必须保持原 scope；跨 scope 迁移不在 v1 普通更新接口中提供。

`basis` 区分用户写作、用户陈述、Agent 总结、来源摘录和导入；status 仅表示 active/draft/archived。
来源 revision/hash 与条目 revision 各自独立。缺失来源版本保持缺失。
来源的 nativeRef 直接引用现有 ResourceRef/ObjectRef/ContextRef 契约，不能把项目 scope 当成资源授权域。
group_background 也是用户私有背景，不能据此推断组员共享、指导或合作意愿。

CLI 是短生命周期的 HTTP 客户端，一次调用后退出；不加载模型，不安装默认 hooks，不扫描全库，不运行后台同步。
理解、总结和研究建议由用户显式唤起的宿主 Skill 完成。API 的成功读取只表示内容已返回客户端。
所有入口复用正式 PostgreSQL 应用服务；本地 dev-cloud 不作为正式服务的替代品。

## 契约与生成

真源为 `products/liteasy/packages/context-contracts/schemas.mjs`。运行：

```bash
node products/liteasy/packages/context-contracts/generate.mjs
```

生成 `packages/shared/contextEntry.v1.schema.json`、`contextWrite.v1.schema.json`、`contextApi.v1.schema.json`。
共享 schema 遵循已有 `.gitattributes` 的 LF 规则；重复生成必须一致。
ContextEntry 顶层是写入内容，其 `$defs/stored` 是服务端完整条目。ContextApi 的 `$defs` 分别定义请求与响应。
六类合成样例和 update/delete 样例位于 `packages/context-contracts/examples/`，不得作为用户真实成果。
未知顶层字段拒绝。v1 请求体最多 128 KiB；attributes 最多 20 个字段、8 KiB JSON；来源最多 20 个。
标题/正文限制和有界读取的计数单位为 Unicode code point，不是 UTF-16 单元或 token。

## HTTP

所有响应使用 `schemaVersion: liteasy.context-api/v1`；写入输入使用 `liteasy.context-write/v1`。
下表路径以 `/v1/context` 为前缀。授权主体只能来自验证后的桌面账号或专用 Context grant。
移动映射后续通过有限 `/v1/mobile/context` 路由调用同一服务，不能使用外部 Agent 凭据。

| 方法与路径 | 输入 / 响应 |
| --- | --- |
| GET `/whoami` | 无正文；主体、actor、readScopes/writeScopes、到期、幂等窗口 |
| POST `/entries` | create envelope / receipt |
| GET `/entries/:id` | 当前 entry，包括 revision 和来源 |
| GET `/entries` | `scope`、`kind`、`tag` 可重复；`query/status/limit/cursor`；分页 entries |
| POST `/entries/:id/revisions` | update envelope，entryId 必须等于路径 / receipt |
| POST `/entries/:id/delete` | delete envelope，entryId 必须等于路径 / receipt |
| GET `/entries/:id/revisions` | `limit/cursor`；分页历史，包含当时 actor、正文和来源 |
| POST `/query` | queryRequest / 整条 selectedEntries、budget、omitted、nextCursor |
| GET `/operations/:operationId` | 当前凭据需拥有原操作 scope 的写权限；无正文 receipt |
| POST/GET/DELETE `/grants[/:id]` | 仅正常桌面账号管理；创建仅一次返回 secret |

默认 list/query 仅 active；指定 status 可读取 draft/archived。limit 默认 50，最多 100；分页 cursor 必须与筛选一致。
query 先授权再按 scope/kind/tag/文本过滤，按更新时间和 ID 稳定排序；中文与英文都使用规范化文本匹配。
maxChars 为选中标题与完整正文之和。放不下的整条省略，返回 ID、revision、标题、长度和原因。
单响应最多检查 100 条匹配记录，剩余以 nextCursor 继续；不自动裁掉 Markdown 限制条件。
导出使用受权分页读取，在客户端生成 JSON/Markdown。

## 一致性、凭据与失败

一次写入在同一数据库事务中提交当前条目、revision 快照和不含正文的回执。
更新/删除使用 expectedRevision；不匹配返回 HTTP 409、`context_revision_conflict` 和 currentRevision。
归档是普通状态更新。删除移除当前正文和所有历史正文；保留无正文墓碑及窗口内回执，旧请求不能复活内容。

幂等窗口默认 604800 秒（7 天），由 whoami 返回。键为稳定 owner + operationId，不绑定轮换的 token。
在窗口内，同 ID 同规范请求返回原回执；不同请求返回 `context_operation_conflict`。
重放和查询回执均重新校验当前凭据对原 scope/action 的权限与有效性。
网络超时是结果未知：先查原回执，或以完全相同输入/operationId 重试。
客户端恢复文件保留首次尝试时间；窗口外停止自动重放，要求先核查当前条目。
服务不承诺回执清除后的永久去重。

grant 使用随机 opaque secret，仅 Context 路由识别，服务只存 hash；具有名称、显式读写范围与到期时间。
`*` 表示用户明确选择全部 scope；空数组表示无该动作权限。
凭据不能增发 grant，不能用于普通账号、模型或管理 API。撤销、到期、账号禁用/注销后拒绝调用。
CLI 凭据绑定 API origin 与账号：优先系统凭据库，不可用时用户明确选择临时 stdin 或受限文件，不能静默降级。

错误为 `{schemaVersion,error:{code,message,retryable,requestId,currentRevision?}}`，不含用户正文或凭据。
400/413 为输入或体积错误；401 身份失效；403 范围不足；404 不存在或其他 owner 的条目；409 版本/操作冲突；
503 服务不可用。未知主要版本返回 400 `context_schema_unsupported`，客户端映射为能力不兼容。
CLI 退出码：0 成功，2 输入，3 身份，4 权限，5 不存在，6 冲突，7 网络/服务，8 协议/能力。
成功 JSON 单独写 stdout，诊断和结构化失败写 stderr；不得把超时当成已保存。

## 后续与验收边界

桌面整理、选择式画像发布、Zotero reference 快照、Android 草稿/提交和六个显式 Skills 按原计划独立推进。
后台归纳、向量搜索、全库本地镜像、强制实验记录、团队共享、CLI 浏览器登录不属于 v0.2 核心前置。
代码/自动化测试通过不等同于 Windows/Linux 发行验证或 Android 真机通过；完整 pilot 需要用户选择的真实材料和各端证据。
