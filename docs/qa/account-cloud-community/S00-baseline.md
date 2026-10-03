# S00 · 账号、云端和社区基线

日期：2026-10-03。实现分支 `feat/account-cloud-community` 基于已通过 Windows Installer 的 `0d3e45bd`（0.1.34），保留此前客户端功能。原 main 工作区的 `.gitignore` 与用户未跟踪文档未修改。任务包 ZIP 的逐项 SHA-256 全部校验通过，来源为用户提供的 `Liteasy-account-cloud-community-Codex-pack-2026-10-03.zip`。

## 权威与现状

| 边界 | 当前实现 | 当前缺口 / 验证层次 |
| --- | --- | --- |
| 身份 | `platform/identity-service` 管身份，Desktop 系统浏览器 PKCE 与宿主凭据；各产品 audience/allowed-client 独立 | S01 核查发现账号 hook 迟到响应无世代约束、离线校验可能清登录、Web 切号后编辑器未清；真实 IdP/三平台回调未运行 |
| 个人云 / 组织 | Liteasy API 的 PostgreSQL 权威；组织成员/角色/上传/导出策略、owner 导出例外 | 原列表无可解释动作快照；S06 增量补 allowedActions，不给客户端新授权 |
| 组织社区 | Intuecho 独立数据库；专用机器身份实时查 Liteasy 组织权限 | Web 浏览已有组织清单，但发布仍要求手填组织 ID；不复制成员权威 |
| 批注权威 | Liteasy 团队批注与 Intuecho annotation/reply 各自单一可写来源 | 后续显式发布副本用 namespace/sourceRef 关联，不启用双向覆盖 |
| 发布 | PDF 逐项 publication operation/receipt；薄读兼容队列；短期 handoff，Web 自己认证并要求同主体 | 新 Web 草稿与 handoff 默认 public/广场；S00 先修 Web，S03 继续服务契约和上传前预检 |
| 数据持久化 | 私有 S3 暂存、扫描证明、发布 workflow、幂等/配额、维护账本已存在 | S12 发现 prepare COMMIT 结果不确定时 catch 可能删暂存；不能用本地替身替代 PG/S3 验收 |
| 撤回 / 回复 | 已有回复时 scope 锁，派生 annotation 独立；离组作者旧内容例外 | 保留现语义，后续验证迟到队列和投影不会复活撤回内容 |
| 生命周期 | 阶段账本、owner 无主保护、作者去标识 | 文档 three audiences 与包含 mobile 的代码存在漂移；真实全会话吊销/备份恢复未验收 |

### 组织动作增量契约

权威组织列表和 summary 将增加 `allowedActions`、`denialReasons`、`policyRevision`、`authorizationRevision`、`policyExceptions` 和 `actionConstraints.inviteRoles`。它们只是当前授权解释；提交仍由服务重查。机器组织列表仅发送名称、ID、当前角色及上述快照，不发送成员或 ownerSubject。`edit_own` 要对象上下文；`share_excerpt`、`publish_public`、`run_external_model` 在 D01 未批准时不可用。保持既有 owner 导出例外。

### 状态与错误

`store/upload`、`sync`、`share`、`publish`、`shareToPlaza` 独立。沿用 `published/retracted/failed/pending_public/synced` 的既有协议；待核实不标未发布，撤回需权威回执。保留 `ORGANIZATION_ACCESS_DENIED`、`ORGANIZATION_AUTHORIZATION_UNAVAILABLE`、`ANNOTATION_SCOPE_LOCKED_BY_REPLIES` 等稳定错误；新缺受众路径需稳定错误而非默认公开。不能把网络离线、权限不足、身份过期混为退出。

## 最小真实修正

`AnnotationComposer` 新草稿缺受众时保持未选，禁用发送并在 submit 再检查；广场默认关闭。明确公开草稿保留公开选择，但不隐式加入广场；旧公开内容的编辑保持 scope/广场选择，回复沿用父受众。没有数据迁移或旧资料重写。

新增回归先复现 2 项失败（默认 public、默认广场），修复后该文件 25 项通过；既有回复/派生批注路径继续通过。日志：`/tmp/liteasy-account-s00-red.log`、`/tmp/liteasy-account-s00-green.log`；Web 生产构建见 `/tmp/liteasy-account-s00-build.log`。这是 jsdom API 替身测试与构建，不是正式社区发布或真实浏览器/IdP 验收。一次新增测试 fixture 漏字段的 TypeScript 失败已修正并重建；系统 npm 的 workspace 外层退出码不可靠，必须同时核对日志及直接工作区命令。

本切片尚未解决服务端默认受众、handoff 上传前确认与组织选择器；S03 继续处理。按 UI 片段通过不能把完整 AC06/AC08 标为全部完成，44 项验收从 not_run 开始。

## 决策与执行边界

D01–D08 均保持 HOLD：不自行启用新的组织外发/离线留存、匿名身份、公开全文、计费、遥测或邀请投递政策。现有作者与 owner 例外不改。本轮仅本地隔离合成数据；没有访问生产/共享库、真实账号、真实存储，不发邀请/帖子/通知，不调用收费模型。

本机初始未发现 PostgreSQL/Docker 工具；真实 PG 双库/独立角色测试待建立隔离环境或记录阻塞。Web、SQLite、PostgreSQL、IdP、原生 OS、部署恢复分别记证据。迁移只能增量；生产 readiness 不放宽。默认不 push、不合入 main、不发布。
