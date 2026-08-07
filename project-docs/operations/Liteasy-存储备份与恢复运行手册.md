# Liteasy 存储备份与恢复运行手册

状态：开发阶段运行基线。正式上线前由业务负责人确认 RPO、RTO、审计保留期和账号删除保留期，未确认前不得虚构 SLA 或将本文件标记为生产就绪。

## 1. 适配器与卷边界

开发服务使用以下本地路径，仅用于联调和恢复演练：

- `LITEASY_DEV_CLOUD_DATABASE_PATH`：事务数据库文件；服务账号可读写，备份账号只读。
- `LITEASY_LIBRARY_OBJECT_DIR`：私有 PDF 对象；服务账号可读写，禁止公开访问。
- `LITEASY_AUDIT_ARCHIVE_DIR`：审计归档；服务账号只能创建，不能覆盖或删除既有对象。
- 服务发布目录：只读构建产物，不包含上述数据、日志、密钥或备份。

`dev-cloud` 和 Intuecho SQLite 开发 API 在 staging 和 production 环境强制拒绝运行。`services/cloud` 提供 Liteasy PostgreSQL 与私有 S3 API 的正式基础设施边界；`Intuecho/services/api/src/productionServer.mjs` 提供独立的 Intuecho PostgreSQL 正式边界。两者都在监听端口前验证迁移、数据库可写和身份依赖，但使用不同数据库、在线账号、migrator、连接池、备份计划和恢复证据。文献树、治理、推荐、外部检索、个性化、平台角色、单文献支持访问、账号生命周期、独立管理前端及论坛业务已有正式仓库实现，但目标环境证据尚未完成，不能仅凭 `/readyz` 上线。

密钥通过部署密钥系统注入。备份介质启用静态加密，跨主机传输必须使用 TLS；数据库、对象和审计归档不得使用同一故障域作为唯一副本。

## 2. 备份

1. 开发 SQLite 演练使用 SQLite Online Backup API 或一致性快照，不直接复制正在写入的 WAL 文件集合。正式数据库必须在上线前实测时间点恢复。
2. 对对象存储启用版本化或不可变快照，并保存对象清单、大小和内容哈希。
3. 定时执行 `npm run archive:audit`，将哈希链快照写入独立归档卷；执行 `npm run verify:audit` 并对失败告警。
4. 推荐缓存、检索缓存和解析缓存不备份；恢复后允许重建。
5. 每次数据库迁移前创建数据库与对象清单的一致性恢复点，并记录应用版本和迁移版本。

桌面本地文献库不属于平台云备份承诺。设置页“导出完整备份”会在用户指定的已存在目录下创建唯一命名的完整副本，并以目录、文件大小和 SHA-256 全树清单校验 PDF、元数据、批注、索引及回收站；失败时清理不完整副本且不改变当前库。用户仍需把该副本保存到独立介质并自行验证可读性，不能把与当前库同一磁盘上的副本视为唯一备份。

正式服务迁移使用：

```bash
cd LiteasyClaw/services/cloud
npm run migrate
```

Intuecho 使用独立迁移任务：

```bash
cd Intuecho
npm run migrate --workspace=@intuecho/api
```

`INTUECHO_DATABASE_URL` 与 `INTUECHO_MIGRATION_DATABASE_URL` 必须指向 Intuecho 专属数据库并使用不同角色，不能与 `DATABASE_URL`、`LITEASY_MIGRATION_DATABASE_URL` 或其凭据相同。数据库备份清单必须分别记录 Liteasy 和 Intuecho 的数据库标识、恢复点、迁移集合与应用 Git SHA，不能用一次共享数据库快照充当两份隔离证据。

迁移命令必须使用与在线应用账号不同的部署期 migrator 账号；在线 runtime 只读取 `schema_migrations` 并校验完整迁移集合，不持有 DDL 权限。不得修改已应用 SQL 文件；迁移 runner 会比较 `schema_migrations.checksum_sha256` 并拒绝内容变化。迁移前后的备份标识、对象清单和应用 Git SHA 必须进入发布证据。

首次生产管理员引导必须作为独立、一次性的变更任务执行 `npm run bootstrap:admin`，仅写入已由 IdP 建立的 subject，不接收密码。引导原因、执行人、变更单和生成的审计 ID 必须进入发布证据；已有当前管理员时命令必须失败。管理员首次访问 `/v1/admin/me` 必须持有五分钟内的新鲜 MFA，IdP 另行强制首次改密。不得长期保留 `LITEASY_BOOTSTRAP_*` 环境变量。

`audit_events` 在正式 PostgreSQL 中是追加写表，在线账号即使拥有常规 DML 权限也会被触发器拒绝更新或删除。归档和保留期清理不得临时关闭该触发器；正式保留方案应使用独立归档、分区切换或部署期受审计流程实现。

Intuecho 的 `moderation_audit` 同样是数据库级追加写表，在线角色没有更新或删除权限，迁移角色也会被触发器拒绝篡改。论坛治理审计必须进入独立的 Intuecho 备份与保留清单；不能只备份 Liteasy `audit_events`。

### 2.1 账号生命周期运行契约

账号删除是跨 IdP、Liteasy PostgreSQL 和 Intuecho PostgreSQL 的持久、幂等工作流，不是单个数据库事务。操作顺序固定为：检查组织负责人前置条件，IdP 禁用并吊销三个产品 audience 的全部活动会话，Liteasy 清理个人业务数据，Intuecho 清理私人论坛状态并去身份化公开作者，IdP 最终删除，Liteasy 写入完成 tombstone。不得在业务清理完成前删除 IdP 主体，也不得因某一步失败重新启用账号。

IdP 管理 client 使用 client credentials，最小权限为 `accounts:write` 和 `sessions:revoke`，必须与桌面 public client、Liteasy introspection client 和 Intuecho client 分离。管理 API `POST /v1/accounts/:subjectId/status` 必须支持幂等键，并对 `disabled`、`deleted` 返回匹配主体、状态、更新时间、`allSessionsRevoked: true` 和精确的 `liteasy-desktop / intuecho-web / liteasy-admin` audience 集合。部署前应证明少吊销任一 audience 时 Liteasy 失败关闭；不得授予该 client 读取 PDF、论坛正文、画像或普通管理数据的权限。

删除失败后，值班人员先确认目标账号仍处于 IdP 禁用状态，再从 `account_deletion_jobs.last_completed_stage`、`last_error_code` 和关联审计定位失败服务，使用原 `actor_id + idempotency_key` 重试。不得新建操作键绕过 Intuecho 的回执绑定，也不得手工把阶段向后改写。`identity_delete_requested` 表示后续重试必须继续最终删除，`identity_deleted` 表示不得再次调用业务清理或把账号恢复为禁用状态。组织负责人未转移时属于禁用前冲突，应先完成所有权转移。

Liteasy 保留账号状态 projection、删除任务、追加写安全审计和已撤销授权；Intuecho 保留删除回执、生命周期审计以及已去身份化的公开正文。其保留时间由业务、法务和安全负责人批准，不能与可恢复业务账号混淆。真实 IdP management API、staging 三 audience 吊销及故障注入尚未取得部署证据；本机 PostgreSQL 16 和适配器自动化只证明仓库协议与事务行为。

## 3. 恢复

1. 在隔离环境停止写流量，恢复目标版本的数据库快照与对应对象版本。
2. 使用与备份记录一致的应用版本启动，只执行已记录且可回滚的迁移。
3. 运行 `npm run maintain:storage`。退出码 `2` 表示数据库仍引用缺失对象，禁止开放写流量。
4. 运行 `npm run verify:audit`，确认归档哈希链连续。
5. 抽样验证用户和组织作用域隔离、目录修订号、PDF SHA-256、配额、回收站与授权下载。
6. 恢复身份服务后验证三个 audience 的会话边界、禁用账号吊销和管理员 MFA。
7. 查询 `account_deletion_jobs` 中未完成任务并与 IdP、Intuecho 删除回执对账；账号保持禁用，使用原幂等键续跑。若数据库恢复点早于 IdP 最终删除，禁止重新创建或启用同一 subject 来掩盖差异。
8. 记录实际恢复时间、数据截止点、缺失对象和人工处置，经过负责人批准后再恢复流量。

Intuecho 恢复必须作为独立演练执行：

1. 恢复 Intuecho 专属 PostgreSQL 到隔离数据库，不复用已恢复的 Liteasy 数据库或在线角色。
2. 使用匹配的 Intuecho 应用版本校验 `schema_migrations` checksum；在线角色必须仍无 DDL 及治理审计更新/删除权限。
3. 验证空白或目标时间点后的主题、论文、帖子、草稿、标签、评论、关注、收藏、反馈与治理审计数量和外键一致性。
4. 用两个同名但不同 subject 的真实测试账号确认作者归属隔离，并用 `liteasy-admin` token、新鲜 MFA 和管理 API 角色回查完成撤回/恢复抽样。
5. 记录论坛实际数据截止点、恢复时长、审计连续性和审批。该证据必须与 Liteasy PostgreSQL/PDF 对象恢复证据分开归档。
6. 对账 `account_deletion_jobs` 与 `account_lifecycle_audit`；公开帖子/评论必须保持去身份化，已删除私人状态不得因恢复而重新开放。发现跨库时间点不一致时保持 IdP 账号禁用并按原操作键重新执行清理。

## 4. 演练门禁

至少在每次正式发布前和备份机制变更后执行隔离恢复演练。演练证据必须包含备份标识、数据库完整性检查、对象缺失报告、审计链校验、权限抽样和实际 RPO/RTO。未完成演练或存在缺失对象时不得宣称备份可恢复。

## 5. 发布证据验证

正式发布必须将证据文件与 `liteasy.filesystem-release-evidence/v1` manifest 放在同一受控目录，并执行：

```bash
node LiteasyClaw/scripts/verify-filesystem-release-evidence.mjs /path/to/evidence/manifest.json
```

验证器要求：

- 发布版本、完整 Git SHA、发布批准人和时间。
- Windows Tauri 外部增删改、监听溢出、junction、锁文件、大小写冲突、账号切换、四区域复制、窄视口和展开状态均为 `passed`。
- Liteasy PostgreSQL 适配集成、TLS、静态加密和时间点恢复均为 `verified`，并附恢复证据。
- Intuecho 独立 PostgreSQL 适配、独立凭据、TLS、静态加密和时间点恢复均为 `verified`，并附独立恢复证据。
- S3 适配集成、私有访问、静态加密、版本/不可变策略和跨故障域副本均为 `verified`，并附对象完整性证据。
- HTTPS IdP issuer、三个精确 audience、MFA、全会话吊销和支持授权过期证据。
- 业务批准的 RPO、RTO、审计保留期和账号删除保留期。

每份证据必须是 manifest 目录内的普通非符号链接文件，并在 manifest 中记录匹配的 SHA-256。验证器只证明证据包完整且未被替换；它不代替人工审核证据内容，也不将一组布尔值当成真实基础设施测试。
