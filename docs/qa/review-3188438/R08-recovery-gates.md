# R08 恢复门禁与隔离云端故障验证

## 本轮实际执行

Linux x86_64 / PostgreSQL 16.15 / Node 22.13.1。在本轮新建的 SCRAM loopback 实例中创建全新 source/restore 数据库和不同的 owner/recovery/business 身份，业务角色没有管理权限。`verify-before-event-replay.mjs` 实际 pg_dump/pg_restore **事件发生前**的数据库，再回放事件后的删除与撤回：30 migrations，15 个演练检查通过。不是 SQL mock，也未接生产库。

原实现使用演练内存中的 digest 对比；现增加 `recoveryJournal.mjs`：独立生产者的 Ed25519 签名检查点绑定源/目标、备份摘要、时间高水位、起止序号、前后链 hash 和完整 journal digest。恢复者另传所需最新高水位，不能从待验证日志推断。逐条回执必须覆盖全部序号及 hash；缺失、截断、改写、错误签名、错误目标、旧高水位和部分回放都拒绝。恢复库唯一的业务 CONNECT 授予仍位于所有回放与数据库语义检查之后。不能通过持有一份旧的合法签名日志绕过最新检查点。

本次演练的生产者密钥也是合成的，**不是生产独立备份可信链的验收**。实际部署必须将签名私钥留给独立事件生产者，将可信公钥和最新必要高水位存于恢复备份之外；生产者必须保证高水位以前的事件已经完整持久化。签名只能证明指定生产者提供了这些内容，不能证明一个漏写事件的生产者是完整的。D03 公开正文匿名保留、已批准回复保留等现有政策未改变。

## 可运行的真实服务脚本

`products/liteasy/services/api/scripts/verify-cloud-faults.mjs --config /private/config.json` 使用真实 Postgres repository、S3 client 和 HTTP scanner，不生成假的 clean 结论；顺序执行 scanner 缺失、prepare 提交后响应丢失、对象发布失败、DB 完成失败、prepare 后 SIGKILL、对象发布后 SIGKILL，重启正常 service 修复并验证对象字节摘要。前三类发布前故障验证 staging 保留。未扫描内容不生成可读 entry；扫描不可用会清理 staging。故障注入位于调用边界，不能冒称底层 S3/PG 节点实际宕机。只生成合成 PDF，不读取 OS 用户文件。

配置必须 0600，`schema: liteasy.isolated-cloud-fault/v1`、`disposableTestInstance: true`、16 位小写十六进制 `runId`。显式提供 `databaseUrl` / `migrationDatabaseUrl`（不同 role，同一非 5432 loopback `_test` 数据库）；管理员预先把 public schema comment 设为 `liteasy-isolated-cloud-fault:v1:<runId>`。数据库需新建、无业务 entry。`s3` 需 loopback 非特权端口 endpoint、独立 bucket `liteasy-review-<runId>`、prefix `review/<runId>` 和仅该测试 bucket 的 `accessKeyId` / `secretAccessKey`。预置 `<prefix>/.isolated-test.json` 内容为 `{ "schema": "liteasy.isolated-cloud-fault/v1", "runId": "..." }`；不满足标记不进行故障注入。`scanner` 需 loopback endpoint、secret 和实际进程名 `expectedScanner`；须实现当前 `pdfSecurityScanner.mjs` 的响应契约并真实扫描。脚本保留独立 fixture 供复查，不清空共享库或其他 bucket。

`platform/identity-service/scripts/verify-isolated-refresh.mjs --config /private/config.json` 对**实际启用**的四个客户端分别执行成功 refresh、真实 userinfo 核对、禁用合成主体后再次 refresh 必须 `invalid_grant`。不会把静态 `revokedAudiences` 字段当实测。配置为 `liteasy.isolated-refresh-test/v1`、`disposableTestInstance: true`、16 位 `runId`、loopback origin、subjectId、admin clientId/clientSecret、sessions 数组（clientId/refreshToken/可选 clientSecret）。仅接受 `liteasy-review-<runId>` 测试 realm，主体需预置 `attributes.liteasyTestRun: [runId]`；从真实 admin clients 列表核对所有已启用 audience，缺会话即失败。token、用户数据和原始错误不会进入摘要。验证后该合成主体保持禁用。

## 未执行与交付边界

当前环境没有 Docker/Podman、兼容 S3 服务、ClamAV 进程或隔离 Keycloak realm/会话，因此上述组合服务脚本和真实 refresh 为 **not_run / 环境阻塞**。配置拒绝测试、脚本语法及恢复 journal 负例已通过；不能据此称 RV23/RV25 已通过。Windows/Linux/macOS 原生 OAuth/keyring/handoff、真实本机原件操作与目标云提供商故障也未执行。不要启用生产故障注入来填补这些空项。

旧 checkpoint 格式不再通过新演练入口；已有应用数据库和内容格式无需迁移。生产接入独立 journal 写入/备份、签名 key 生命周期和路由 readiness 仍需部署环境验收；本轮不把演练私钥或备份打进工件。最终同提交测试及白名单摘要见本目录总验收记录。
