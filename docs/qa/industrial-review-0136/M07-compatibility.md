# M07：候选范围与兼容边界

本切片不改变服务数据库迁移，不新增权限真相库。M00/M01/M04 使用 0.1.36 已有的 Intuecho command、revision、plaza cursor 和来源接口；部署时仍须先确认服务契约存在，再启用新 Web 客户端。反思草稿增加本机命名空间，不改变服务格式。

| 客户端 / 服务组合 | 实际行为与要求 |
| --- | --- |
| 新 Web + 现有 command protocol 1 | 创建携带稳定 operationId 和规范化 payload SHA-256；未知结果只读核实，合法 not_found 后由用户明确重试原 ID。 |
| 缺少 command lookup 的旧服务 | 不能把 HTTP 错误或空响应当 not_found；原操作继续待核实，不能改用无 command 请求重发。 |
| 旧客户端编辑，缺少 expectedRevision | 现有 HTTP annotation/reply 编辑接口返回 `EXPECTED_REVISION_REQUIRED` / 428；不得恢复 last-write-wins。 |
| 旧客户端创建，缺少 command | 现有服务仍接受部分历史创建入口；这不具备本轮安全恢复保证，不属于候选可靠发送范围。不能声称服务已全面强制最小写协议。 |
| latest + 无筛选或 literatureId | 复用 `/v1/plaza/page`；现有契约只支持 limit、cursor、literatureId。 |
| recommended 或旧版扩展筛选 | 保留 `/v1/plaza` 的排序与筛选含义；不能将 unsupported 参数悄悄传给 page 接口后忽略。 |
| 本地 receipt 已 committed，但当前来源撤回或撤权 | 保留“曾提交”的事实；重新读取结果时仍须鉴权，不展示缓存正文。 |

本仓库尚无覆盖所有客户端的最低语义版本协商。此处列协议条件，而非编造一个服务端已实施的 minClientVersion。后续全面收紧旧创建入口必须先盘点 Desktop、Web、Mobile 的调用方并补服务兼容回归，不在首波客户端存储修复中顺带破坏已有发布。

## 运行层次和停止条件

本轮候选覆盖 Intuecho Web 的合成资料工作流，以及 Desktop 社区来源反思控制器的本机回归；不包括原生安装验收。实际浏览器使用真实 Chromium、Web Locks 和 localStorage，身份和 HTTP 响应明确由合成测试夹具提供。任何重复发送、冻结 payload 被改写、旧回执覆盖新状态、跨账号正文泄露、草稿覆盖或虚假保存确认，均停止扩大候选范围。

体验延迟、内存和容量基线与上述正确性不变量分开；65 条分页场景不等于 10k 题录 / 50k 批注的容量承诺。不新增遥测，不使用实际私有文档或付费模型。

## 尚需独立环境的验证

- 真实 PostgreSQL：沿用 `products/intuecho/services/api/scripts/verify-postgres-integration.mjs` 和 `verify-before-event-replay.mjs` 的隔离 guard；不连接共享开发库填补结果。
- 真实 IdP refresh：`platform/identity-service/scripts/verify-isolated-refresh.mjs`，需专用测试 realm 与合成主体。
- 真实 S3/scanner：`products/liteasy/services/api/scripts/verify-cloud-faults.mjs`，需专用 bucket、隔离数据库和实际扫描进程。
- Windows Installer 构建、Windows 安装运行、Linux/macOS 原生阅读与登录分别报告，不能以 Web 构建代替。
- 自愿小组试点沿用 `development/pilots/account-community.mjs`；没有真人参与时不填成功率、满意度或复用率。

以上脚本参数与保护规则见 [既有云端故障验证说明](../review-3188438/R08-recovery-gates.md)。未配置或未运行的层保持 not_run / blocked，不自动部署获取证据。
