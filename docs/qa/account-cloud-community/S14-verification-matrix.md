# S14 — 44 场景验证矩阵

记录日期：2026-10-03。依据 `scenarios.json` 的 AC01–AC44，对集成工作树当前实现、已保存日志和各切片记录作交叉核查。核查开始时 HEAD 为 `d3458e2d`；随后 root 已合入 `95bd22a1` 本人云资料包与 `495ea13c` 只读 publication lookup，期间仍在修改 AppShell 和修复全测问题，本文不是最终干净提交的发布签字。本文不修改 `verification.json`，也不把其中原始 `not_run` 自动改写为通过。

本次矩阵整理没有重跑全套测试、重置已有数据库、连接生产或真实 IdP。针对核查发现的 visualization 队列 issuer 缺口运行了红绿回归；随后在新建隔离库补跑 AC37 的旧备份与较新事件重放演练。所有数据均为合成数据；日志中的测试数不能跨运行相加为“总覆盖数”。

## 判定与证据层次

- `passed`：已有证据覆盖该 AC 在其指定层次的预期；只表示表内明确的测试边界，不表示生产、原生或跨产品 E2E 已验收。
- `partial`：实现或其中若干边界已验证，但完整步骤、指定环境、当前最终提交或政策条件尚未覆盖。不能将其改称通过。
- `not_run`：没有执行该 AC 要求的真实环境流程；相关单测可以列为辅助证据。
- `HOLD` 是政策门槛，和环境缺失不同。D01–D08 没有获得新的业务批准；现有受限行为和保留规则不因此改变。特别是 D01 组织内容外发/公开升级、D02 离组可见性细节、D03 删除后保留政策不能由测试代替决策。

路径缩写仅用于缩短表格，均相对仓库根目录：

| 缩写 | 精确目录 |
| --- | --- |
| D | `products/liteasy/apps/desktop/src/`；测试位于 `D/tests/`，实现位于 `D/app/` |
| W | `products/intuecho/apps/web/src/` |
| L | `products/liteasy/services/api/`；模块/Node 测试位于 `L/src/` |
| I | `products/intuecho/services/api/`；模块/Node 测试位于 `I/src/` |
| ID | `platform/identity-service/src/` |
| M | `products/liteasy/apps/mobile/src/` |

### 已执行日志索引

以下路径是当前机器的本地日志，不是已上传的 CI artifact。提交文档后仍需由交付人保存对应无凭据证据；不要提交连接文件、token、keyring 内容或私有 dump。

| 证据编号 | 实际结果及日志 | 真实层次与边界 |
| --- | --- | --- |
| E-DESKTOP | `/tmp/liteasy-account-desktop-full-final.log`：515 文件通过、2 文件跳过；3,524 项通过、4 项跳过，退出 0。原首轮两处失败已修：转移确认行为与工作流来源字段契约，focused 34 通过。 | Vitest/DOM/模拟 transport/native；包含 issuer、导出、资料预览和只读核实。随后新增的组织动作/邀请切片另跑受影响测试并重建，见最终机器记录；不把它说成这次全测包含的代码。 |
| E-PREVIEW | `/tmp/liteasy-account-preview-controller.log`：`usePdfAnnotationPublicationController.test.tsx` 48、`useArtifactWorkflowController.test.ts` 20，共 68 通过；`/tmp/liteasy-account-artifact-team-fence.log`：`useTeamAnnotationController.test.ts` 4、`artifactResultClient.test.ts` 8，共 12 通过。 | 控制器真实代码 + mock HTTP/宿主；覆盖快照、发送时机、迟到响应，非原生联网发送。 |
| E-WEB | `/tmp/liteasy-s11-inbox-root-web-all.log`：88 项通过；`/tmp/liteasy-s11-inbox-root-web-build.log`：直接 tsc/Vite/资产检查退出 0，3 个产物验证。 | Web DOM/transport fixture。含显式阅读任务、参与者提及、quiet inbox→本人处理记录实际接线；没有真实 IdP 登录。 |
| E-INTUECHO | `/tmp/account-intuecho-api-full-final.log`：279 项通过，退出 0。新恢复 guard 两文件另有 11 项通过，见 `/tmp/liteasy-account-recovery-guard-tests.log`。 | Node HTTP injection + 真实 SQLite；`desktopPublicationRecoveryHttp.test.mjs` 6 项验证开发/生产入口实际 audience 边界和丢响应→只读查询→撤回（身份 verifier 为替身）。PG 查询替身仍不算真实 PG。 |
| E-LITEASY | `/tmp/liteasy-account-liteasy-api-integrated.log`：500 项中 496 通过、4 跳过，退出 0。 | Node 服务测试，含 mock PG/S3/scanner/IdP；跳过不算通过。真实 PG 另列。 |
| E-PG-L | `/tmp/liteasy-account-liteasy-pg-final.log`：原 `L/scripts/verify-postgres-integration.mjs` 输出 `migrations:28, auditEvents:73, revision:12, accountDeletion:true, accountDeletionConcurrency:true, organizationActivity:true, verified:true`。 | 真实本地 PostgreSQL 16.15，独立 migrator/app，合成库。包括 `scripts/accountDeletionConcurrency.mjs` 通过 `pg_blocking_pids` 观察两种锁顺序。未使用真实 S3、IdP 或生产组织。 |
| E-PG-I | `/tmp/account-intuecho-pg-full-final.log`：`migrations:27, accountDeletion:true, communityGovernance:..., structuredCommunityEvents:..., platformGovernance:..., authorProfileRevision:true, verified:true`；profile/lookup 与 withdrawal 脚本分别在 `/tmp/account-intuecho-pg-profile-final.log`、`/tmp/account-intuecho-pg-withdrawal-final.log` 通过。 | 真实隔离 PostgreSQL 16.15，独立 migrator/app；含旧通知迁移保留、事务回滚、实际行锁、各通知类型和读时撤权。非真实 IdP/跨服务部署。 |
| E-RESTORE | [S14-backup-restore.md](S14-backup-restore.md) 与其中两个 `restore-drill-*/result.json`；`I/scripts/verify-thin-reading-withdrawal.mjs` 在第二个隔离恢复库通过。 | 真实 `pg_dump`/`pg_restore`、非超权限角色、5 个既有删除墓碑、既有撤回账本和旧版本拒绝。**备份已经包含删除/撤回事件**；不是旧备份恢复后补放更新事件。 |
| E-BEFORE-EVENT | [S14-before-event-evidence.json](S14-before-event-evidence.json)；仓库 `I/scripts/verify-before-event-replay.mjs` 实跑 `/tmp/liteasy-account-before-event-repo.log`，15 cases、`verified:true`；源/恢复新库均 **27 个 migration**，最后 `027_tag_appeal_submission_audience.sql`。guard 两文件 11 项通过。 | 真实旧备份（删除/撤回前）、备份外较新账本、既有 repository 重放及 PostgreSQL CONNECT gate。显式 loopback/专用测试 control DB/cluster ID/非超管理员校验；只操作随机新合成库，不连接或重置两座主 testDB。 |
| E-S08 | `/tmp/liteasy-account-s08-final-focused.log`：`durableWorkflows.test.ts` 10、`workspaceAgent.test.ts` 7、`workspaceAgentSafety.test.ts` 9，共 26 通过；早期 `/tmp/liteasy-account-s08-focused.log` 为 6 文件 53 项。 | 真实 Agent/controller 代码 + 模拟 provider/assets；断言组织来源不进入模型请求，无实际付费调用。 |
| E-IDENTITY | `/tmp/liteasy-account-identity-full.log`：ID 7 项通过；S01/S13 较早红绿与 Rust identity 6 项见 [S01-S02-S13.md](S01-S02-S13.md)。 | Keycloak HTTP mock、纯状态/模拟 keyring；不是测试 IdP 的真实会话吊销。生命周期恢复四 audience 回执的结构验证也不能替代真实 refresh/access token 验证。 |
| E-CATALOG | `/tmp/liteasy-account-legacy-catalog-tests.log`：`artifactLocalRepository.test.ts` 15 项；`/tmp/liteasy-account-legacy-rust-tests.log`：Rust catalog 3 项。`/tmp/liteasy-account-legacy-source.log`：4 文件 42 项。 | 旧无主体目录不自动认领、来源绑定校验；不涉及真实 OAuth/keyring。 |
| E-ISSUER | `/tmp/liteasy-account-visualization-issuer-red.log`：新增回归 6 失败/9 通过；修复后 `/tmp/liteasy-account-visualization-issuer-green.log`：3 文件 26 通过。 | `visualizationPendingRequestStore.test.ts`、`visualizationOrchestrationClient.test.ts`、`useCloudAccountController.test.ts`；真实 localStorage/控制器 + mock 网络。issuer 变化隔离、旧 v1 保留不认领、无 subject/issuer/endpoint 不恢复。 |
| E-EXPORT | [S01-S02-S13.md](S01-S02-S13.md) 的子任务会话 stdout：`D/tests/accountDataExport.test.ts`、`AccountDataExportPanel.test.tsx` 两文件 17 项；`L/src/server.test.mjs` 与 `agentArtifactRepository.test.mjs` 60 项、另有吊销身份 GET 单项通过。已由 `95bd22a1` 合入 root。 | 真实 ZIP 解包/DOM/controller + mock HTTP/PG；包含取消、过期、A→B、A→退出→A、endpoint 变化、未知/组织来源失败关闭。没有持久测试日志时明确引用会话记录；不是 native 下载或全账号包。 |
| E-MOBILE | `/tmp/liteasy-account-mobile-final.log`：10 文件 19 项通过；`/tmp/liteasy-account-mobile-build-final.log`：构建通过，退出均 0。 | Mobile Web/TypeScript/Vite。不是 Android native/APK/设备或真实 IdP 验收。 |
| E-BUILD | `/tmp/liteasy-account-desktop-build-integrated.log`：生产构建、7 个 Tauri 资源和 158 个资产通过；`/tmp/liteasy-account-desktop-smoke-final.log`：9 项通过；`/tmp/liteasy-account-rust-check.log`：cargo check 通过。最终组织切片与干净提交 contracts 的结果见 `verification.json`。 | Linux Rust 1.98.0/Node 22.13.1；不是 Windows Installer CI 或三平台原生验收。 |

组织切片的后续验证：`/tmp/liteasy-s06-final-focused.log` 8 文件 49 项、`/tmp/liteasy-s06-leftpane.log` 28 项通过；根补充“旧回调不得启动请求”后 `/tmp/liteasy-account-organization-final.log` 3 文件 23 项通过。覆盖严格主体/issuer/endpoint、reset/unmount/session generation、邀请列表和双 revision 确认撤回、成员治理迟到回执，以及真实 Sidebar/client 与 AppShell 调用方。它们是 DOM/transport 替身测试，不是发出真实邀请。邀请投递策略没有变化，令牌不再进入通用分析提示。

## 逐场景矩阵

### AC01–AC11：身份、来源和发送预览

| AC / 判定 | 当前实现 | 具体测试与证据 | 缺口或待运行环境 |
| --- | --- | --- | --- |
| AC01 无账号本地工作 — `partial` | 本机库、PDF/Markdown、批注/搜索独立于账号；退出不删除 OS 文件；`useAccountSession` 保留离线与失效的区别。 | `D/tests/localLiteratureMode.test.tsx`、`localFileOperations.test.tsx`、`pdfReaderSearch.test.ts`、`useAccountSession.test.ts`；E-DESKTOP、S01 文档。 | 未在真实断网原生客户端完成打开→批注→检索→关闭重启全链，也未记录该链的网络捕获。 |
| AC02 登录不改变资料归属 — `partial` | `accountSessionBinding`、`cloudLibraryStorageClient`、`useLibraryResourceTransferController` 固定本人/组织 scope；转移入口显式确认。旧未绑定目录不归给当前账号。 | `D/tests/useLibraryResourceTransferController.test.ts`、`LibraryPaneFileManagement.test.tsx`、`cloudLibraryStorageClient.test.ts`、`artifactLocalRepository.test.ts`；E-DESKTOP、E-CATALOG、S02 红绿记录。 | 需要真实桌面本机合成资料 + 登录/加入组织，观察无自动上传及所有标签。不得用目录单测代替网络零上传证明。 |
| AC03 切号迟到请求 — `partial` | `useAccountSession`、Web identity generation、固定请求 binding、artifact save 临时 epoch 栅栏；持久身份和运行世代分开。 | `D/tests/useAccountSession.test.ts`、`accountSessionBinding.test.ts`、`useCloudLibraryTree.test.ts`、`useArtifactActions.test.ts`、`artifactResultClient.test.ts`；`W/identitySessionIsolation.test.ts`、`oauthSessionIsolation.test.ts`、`AnnotationAppSession.test.tsx`；E-PREVIEW/E-WEB/E-DESKTOP/E-ISSUER。 | A→B、旧 401、A→退出→A 由控制器/transport 测试覆盖；真实多窗口 OAuth、浏览器/宿主缓存与关闭重启仍未验收。 |
| AC04 Web/桌面主体不一致 — `partial` | `desktop annotation handoff` 由桌面 audience 建立，消费时绑定 Web 当前 subject；猜测/错主体不可读取正文，桌面 token 不进入 URL。 | `I/src/server.test.mjs` 的 `desktop draft handoffs require the desktop audience and remain bound to one subject`；`W/AnnotationAppSession.test.tsx`；E-INTUECHO/E-WEB，`/tmp/liteasy-account-handoff-green.log`。 | HTTP fixture 不等于实际 desktop A + browser B + 真实 IdP；该身份组合需集成环境运行。 |
| AC05 交接过期与重建 — `partial` | 服务端 handoff TTL/缺上下文错误，桌面保留草稿，明确重建；不因过期自动发布。 | `I/src/server.test.mjs` 的 `stable missing-context and expiry errors`；`D/tests/forumClient.test.ts`、`usePdfAnnotationPublicationController.test.tsx`；E-INTUECHO/E-PREVIEW。 | 未在真实关闭客户端后的过期交接、重新登录及原生深链重建中验收。 |
| AC06 新分享无受众 — `passed`（DOM/API） | Web 新建初始受众为空；无受众禁用发送；服务端拒绝缺少显式 audience 的新批注/handoff。 | `W/AnnotationComposer.test.tsx`、`I/src/server.test.mjs` 的 `new annotation and handoff requests require an explicit audience before persistence`；`/tmp/liteasy-account-s00-red.log` → `s00-green.log`（25 项）、E-WEB/E-INTUECHO。 | 仅此 DOM/请求边界通过；真实浏览器键盘/辅助技术验收及 native 不在该结果内。 |
| AC07 预检先于上传 — `partial` | `usePublicationPreview`、PDF publication controller、team annotation controller、Web `AnnotationSendPreview` 使用选中内容快照，在确认前不建立交接。 | `D/tests/usePublicationPreview.test.tsx`、`usePdfAnnotationPublicationController.test.tsx`、`useTeamAnnotationController.test.ts`；`W/AnnotationComposer.test.tsx`；E-PREVIEW/E-WEB。 | 请求 payload 有单测；未以实际联网客户端抓包逐入口证明本机路径、未选批注及附件从未发送。 |
| AC08 编辑保持 scope — `passed`（contract/SQLite/PG） | 旧批注编辑保留 audience；reply projection 继承父级/root scope，不能借编辑扩大。 | `I/src/literatureContracts.test.mjs`、`server.test.mjs` 的 `reply projections inherit every parent visibility` / `reply scope locks and transitive root audiences`；`I/scripts/verify-postgres-integration.mjs` scope 循环与锁冲突；E-INTUECHO/E-PG-I。 | 通过的是既有协议及服务存储边界；不宣称所有已发布旧客户端二进制均完成回归。 |
| AC09 组织选择与伪造 ID — `partial` | Web `OrganizationAudienceSelector` 只展示当前授权列表；服务仍逐次校验组织 scope、角色和 revision，不信任 UI 选择。 | `W/AnnotationComposer.test.tsx` 的 named organization/permissions unavailable；`I/src/server.test.mjs` organization choices；`L/src/libraryAuthorization.test.mjs`、`organizationAccessSnapshot.test.mjs`；E-WEB/E-INTUECHO/E-LITEASY/E-PG-L。 | PG 含权限拒绝，UI 使用 mock authority；完整 Web→Intuecho→Liteasy 服务身份链及真实组织切换尚需部署测试环境。 |
| AC10 确认后内容/目标变化 — `partial` | preview 固定 actor、正文和目标；编辑/换号失效。回复提交绑定已审阅 parent revision/scope，服务拒绝变化。 | `W/AnnotationComposer.test.tsx` 的 `invalidates preview when content changes`；`D/tests/usePublicationPreview.test.tsx`；`I/src/replyParentSnapshot.test.mjs`、`server.test.mjs` changed-parent 测试；E-PREVIEW/E-WEB/E-PG-I。 | 既有用例证明多个变化维度；所有桌面/AppShell 新接线的最终组合仍待最终版本检查与实际交互。 |
| AC11 非 DOI/不同文件版本 — `partial` | 已确认 literature identity/版本来源独立于 PDF 授权；不把候选 alias 当 DOI；locator 降级保留明确状态。 | `D/tests/literatureIdentityConformance.test.ts`、`literatureVersioning.test.ts`、`thinReadingAnchorQuality.test.ts`；`I/src/literatureContracts.test.mjs`、`literatureIdentityConformance.test.mjs`；E-DESKTOP/E-INTUECHO。 | 尚无同一真实浏览器/桌面流程下多版本文件、精确/近似/不可定位全部状态及授权拒绝截图/抓包。 |

### AC12–AC25：发布、组织与可见性

| AC / 判定 | 当前实现 | 具体测试与证据 | 缺口或待运行环境 |
| --- | --- | --- | --- |
| AC12 伪造/缺失发布回执 — `passed`（contract） | PDF/thin-reading 队列逐项检查 queue/remote ID/revision、重复/缺失 receipt，不凭 HTTP 成功标记 published。 | `D/tests/pdfAnnotationPublicationClient.test.ts`、`thinReadingIntuechoSyncQueue.test.ts`、`usePdfAnnotationPublicationController.test.tsx`；E-DESKTOP/E-PREVIEW；[S04-publication-boundaries.md](S04-publication-boundaries.md)。 | 这是合成响应契约测试，无生产回执或真实网络注入声明。 |
| AC13 提交成功但响应丢失 — `partial` | 发送前持久化冻结 operation/revision/timestamp；PG 既有账本 digest/锁使精确重放幂等；unknown 不当成功。 | 上述 S04 文档；`D/tests/thinReadingPublicationPersistence.test.ts`、`usePdfAnnotationPublicationController.test.tsx`；`I/src/server.test.mjs` replay 测试；E-PG-I/E-RESTORE。 | 真实 PG 精确/并发重放已跑，但“服务已 commit→实际断线→native 重启→恢复”的整链未跑。现已增加 unknown thin-reading create 的只读 lookup（原 queue/source/timestamp/canonical digest）；其 PG `BEGIN READ ONLY` 证据见 S04 文档。PDF 路径仍按原冻结 operation 重放。 |
| AC14 批量部分成功 — `partial` | 逐条确认/保留失败项；只重试可重试项，同 operation 不升级 scope。 | `D/tests/usePdfAnnotationPublicationController.test.tsx`、`thinReadingIntuechoSyncQueue.test.ts`；`I/src/server.test.mjs`、PG mixed-publication fixture；E-PREVIEW/E-DESKTOP/E-PG-I。 | mock 响应和实际仓库批次已验；跨服务断线与客户端重启时的完整重试预算未做实际网络演练。 |
| AC15 取消/在途提交竞争 — `partial` | 客户端取消不假称服务未提交；撤回是单独已授权 operation；已知映射与 exact replay reconcile。 | `D/tests/usePdfAnnotationPublicationController.test.tsx`、`useArtifactWorkflowController.test.ts`；`I/src/thinReadingWithdrawal.test.mjs`、`I/scripts/verify-thin-reading-withdrawal.mjs`；E-PREVIEW/E-RESTORE/S04 文档。 | 实际 PG 撤回/重放/回滚通过；客户端取消恰逢远程 commit 并重启的全链未复现。新版只对拥有原 durable intent/digest 的 unknown create 做只读 lookup；缺原请求、未匹配、冲突或旧无主条目仍保留未解决，不重发 create。 |
| AC16 带回复内容改受众 — `passed`（SQLite/PG） | 父级已有回复时 scope 锁定；并发父修改以 row lock/revision 防止扩大，409 不改原记录。 | `I/src/server.test.mjs` scope locks、changed parent snapshot；`I/scripts/verify-postgres-integration.mjs` 等待父锁、`PARENT_ANNOTATION_REVISION_CONFLICT` 与零新 reply 断言；E-INTUECHO/E-PG-I。 | 真实合成 PG 边界通过；不由此授权任何 D01 公共升级路径。 |
| AC17 父删除/派生批注 — `partial` | 回复与独立 projection 生命周期分离；父删除保留既有独立成果与来源缺失提示，现有可见性继续裁决。 | `W/AnnotationComposer.test.tsx` 的 fixed deleted-parent context；`I/src/server.test.mjs` reply lifecycle；PG projection/parent deletion fixture；E-WEB/E-INTUECHO/E-PG-I。 | 核心存储/卡片已有证据；所有 feed、索引与 AI 引用入口同步失效不由该 fixture 全部证明，关联 AC30。 |
| AC18 组织讨论公开摘要 — `partial` + D01 HOLD | reading-group 生成组织内人工摘要并保留引用 revision/异议；组织来源直接公开 publication 被阻止，不挪用他人回复。 | `W/reading-group/OrganizationReadingGroup.test.tsx`；`D/tests/useArtifactWorkflowController.test.ts`、`workspaceAgentSafety.test.ts`；E-WEB/E-PREVIEW/E-S08。 | 未批准也未验收“组织讨论→公开摘要”新通道。组内摘要不是公开流程的通过证据。 |
| AC19 互关解除范围 — `partial` | 当前 mutual-follow 约束批注和新 DM；既有会话历史与新发送能力分开。 | `I/src/server.test.mjs` 的 `direct messages require a current mutual follow...`；PG mutual visibility/projection fixture 与会话创建；E-INTUECHO/E-PG-I。 | SQLite 覆盖解除后历史/发送拒绝；PG 日志没有单列完整“解除→所有相关读写+DM历史”同链验收，不将创建会话算解除后的通过。 |
| AC20 移除成员后新请求 — `partial` | 实时组织授权/版本复核，目录、导出及发帖不信任缓存角色；上传 staging 后仍复核。 | `L/src/organizationAccessSnapshot.test.mjs`、`libraryAuthorization.test.mjs`、`libraryRepository.test.mjs`；`I/src/organizationAuthorizationClient.test.mjs`、`server.test.mjs`；E-LITEASY/E-PG-L/E-INTUECHO。 | 实际 PG 含成员/权限变化；带缓存原生客户端及跨服务旧 token 下所有读取/下载/写入链尚需实环境验证。 |
| AC21 离组作者保留例外 — `partial` + D02 HOLD | 作者自有历史内容处理沿用既有边界，不据此授予组织其他资料访问；reply 继承父/root audience。 | `I/src/server.test.mjs` annotation visibility/reply lifecycle；`I/scripts/verify-postgres-integration.mjs` scope fixture；E-INTUECHO/E-PG-I。 | “作者离组后具体哪些回复仍可见”的政策未新定；没有将作者例外扩展为全组织 access 的验收。需要独立离组作者/其他成员/非成员矩阵。 |
| AC22 owner 导出例外 — `partial` | `L/src/libraryAuthorization.mjs` 保留 owner 权限与 export policy 区别；UI storage policy 提示；未改既有政策。 | `L/src/libraryAuthorization.test.mjs`、`organizationPolicyRepository.test.mjs`；`D/tests/organizationStoragePolicy.test.ts`、`OrganizationStoragePolicyPanel.test.tsx`；E-LITEASY/E-DESKTOP。 | 有逻辑/展示测试；尚未单列 owner 在 disabled export 下真实 PDF stream 的端到端记录。变更例外需 D01 批准。 |
| AC23 定向邀请撤销/过期 — `partial` | 既有 authoritative invitation 绑定 recipient、token hash、expiry/revoked 状态，并复核 inviter 当前权限；DM 卡片不是授权。 | `L/src/organizationInvitationAcceptance.test.mjs`、`organizationGovernanceRepository.test.mjs`；`L/scripts/verify-postgres-integration.mjs` invitation/revoke/owner-change fixture；E-LITEASY/E-PG-L。 | PG 权限/撤销边界已有证据；未进行两个真实登录主体经 DM 卡片完整接受/误用的浏览器链。 |
| AC24 负责人并发交接/退出 — `partial` | 事务锁和组织 revision 保证一名 owner；最后 owner 不能直接删除；不静默转给管理员。 | `L/scripts/verify-postgres-integration.mjs` concurrent owner transfer、唯一 owner、last-owner deletion 拒绝；`L/src/accountLifecycleService.test.mjs`；E-PG-L/E-LITEASY。 | 并发交接和删除预检分别真实验证；交接与退出/账号删除混合竞争、实际 UI 反馈尚未完成同链演练。 |
| AC25 跨组织资源/公开引用 — `partial` | literature 公共 metadata 与 PDF scope 授权分离；每次字节流前授权 source，跨 scope copy 同时核查目标。 | `L/src/server.test.mjs` scope-bound document、PDF export、cross-scope copy；`libraryRepository.test.mjs` source export 复核；`I/src/literatureContracts.test.mjs`；E-LITEASY/E-PG-L。 | 当前拒绝路径有测试；未建立系统性时间/大小/计数等 side-channel 测量及全部 reference 卡片的实环境校验。 |

### AC26–AC37：服务边界、恢复与账号离开

| AC / 判定 | 当前实现 | 具体测试与证据 | 缺口或待运行环境 |
| --- | --- | --- | --- |
| AC26 错 audience/client — `partial` | desktop/web/admin/mobile 各自 issuer/audience/client/scope；正式身份验证保留 JWT+introspection/current policy，不放宽 token。 | `L/src/identityVerifier.test.mjs`、`server.test.mjs` mobile client bound；`I/src/identityVerifier.test.mjs`、`productionIdentity.test.mjs`；`ID/authorization.test.mjs`、`keycloakClient.test.mjs`；E-LITEASY/E-IDENTITY/E-INTUECHO。 | 合成 JWT/JWKS/introspection/mock token 覆盖错误分支；四真实 client 的测试 IdP 登录/refresh/access 组合未跑。 |
| AC27 组织授权不可用 — `partial` | organization authority 故障 fails closed；不能降级 public；本机工作不依赖该服务；注销本机与远程撤销分开。 | `I/src/organizationAuthorizationClient.test.mjs`、`server.test.mjs` organization choices fail closed；`D/tests/useAccountSession.test.ts`、`cloudAvailabilityBoundary.test.ts`；E-INTUECHO/E-DESKTOP。 | 未通过部署环境主动停授权服务，验证两个产品、原生本机阅读与删除回执的整体行为。 |
| AC28 组织数据经个人 BYOK — `partial` + D01 HOLD | Agent 按来源 metadata 阻止组织 PDF/组织来源本机笔记进入模型上下文，未知来源失败关闭；没有开放静默 BYOK 绕行。 | `D/tests/workspaceAgentSafety.test.ts` 两条组织资料零 model request 回归；`durableWorkflows.test.ts`、`agentRequestScope.test.ts`；E-S08/E-CATALOG。 | 已跑的是阻断路径；provider+数据范围批准 UI 和获准组织外发流程未获政策批准、未真实调用，不能声称已完成可用外发通道。 |
| AC29 不可信内容诱导发布 — `partial` | 证据/原文不给 Agent 新工具权限；资源 scope/写入 expectedRevision/动作能力检查继续生效；组织来源读取有阻断。 | `D/tests/workspaceAgentSafety.test.ts`、`promptInjectionGenerativeUi.test.ts`、`policyEngine.test.ts`、`capabilityToolAdapter.test.ts`；E-S08/E-DESKTOP。 | 单测注入样本不等于完整 paper/community→所有 file/social/invitation/publication 工具链攻击验收；需多入口合成攻击集且无真实发送。 |
| AC30 撤回后缓存/索引/推荐 — `partial` | publication tombstone/revision 禁止旧消息复活；动态读取重新授权；本机 actor cache 隔离；既有撤回和删除来源约束。 | `I/src/thinReadingWithdrawal.test.mjs`、`server.test.mjs` reply lifecycle；`I/scripts/verify-thin-reading-withdrawal.mjs`；`D/tests/cloudLibraryStorageClient.test.ts`、`artifactRevalidation.test.ts`；E-RESTORE/E-PG-I/E-DESKTOP。 | PG 旧 publication replay 拒绝已验；所有搜索 snippet/count/recommendation/AI 索引的撤回事件时序和外部缓存清理未统一演练。 |
| AC31 通知去重/历史正文 — `partial` | Intuecho inbox 事务内事件去重、读取重新授权、失权不返回旧 target metadata；订阅/屏蔽显式。组织 activity 已读本机 actor 分区，不等同邀请已接受/任务已处理。 | `I/src/communityGovernance.test.mjs` 的 dedupe/revoked access/rollback；`W/community-governance/CommunityGovernance.test.tsx`；`D/tests/organizationNotificationStorage.test.ts`、`OrganizationActivityInbox.test.tsx`；E-INTUECHO/E-WEB/E-PG-L、`/tmp/liteasy-account-org-activity-ui.log`。 | 真实 PG 已覆盖 025–027 通知事务、各来源事件、旧事件/已读保留和撤权脱敏；未启用或发送真实外部邮件/通知，不能断言外部渠道已经验收。 |
| AC32 PDF 扫描失败 — `partial` | `pdfUploadService` 先扫描、校验 hash-bound proof，再发布；拒绝/不可用不把未扫描对象标 available，legacy recovery 要重扫。 | `L/src/pdfUploadService.test.mjs`、`pdfSecurityScanner.test.mjs`、`server.test.mjs` scanner stable errors；E-LITEASY。 | 使用 scanner/S3 替身；没有真实 scanner 进程故障、对象存储 staging/最终 bucket 可读性及清理恢复的组合演练。 |
| AC33 S3/DB 分步失败 — `partial` | staged publication 工作流保留修复状态，object publish 与 DB complete 明确分阶段，不宣称跨系统原子事务。 | `L/src/pdfUploadService.test.mjs` 的 preserves repair state/replays unfinished workflows；`libraryRepository.test.mjs`、`s3ObjectStore.test.mjs`、`storageMaintenance.test.mjs`；E-LITEASY/E-PG-L。 | PG 数据库部分真实，S3 为测试替身；缺实际兼容 S3 中断、DB commit 失败/进程杀死后 readiness 恢复及孤儿对象清理。 |
| AC34 配额/重试预算 — `partial` | 服务配额、idempotency、受限批次/模型预算及任务重试保留；失败不删除本机文件。 | `L/src/pdfUploadService.test.mjs`、`libraryRepository.test.mjs`、`visualizationGenerationRepository.test.mjs`；`D/tests/modelResponseBudget.test.ts`、`useLibraryResourceTransferController.test.ts`；E-LITEASY/E-PG-L/E-DESKTOP。 | 未跑真实 provider/S3 并发成本与计费故障演练；不能从逻辑限额推导真实费用、账单恰一次或成本收益。 |
| AC35 销号多阶段失败恢复 — `partial` | 既有 deletion job 分阶段/idempotency；先 owner 预检，四 audience 结构化回执落原 result；缺回执重核实，adapter 不可用返回 pending。写入共用 deletion fence；本机退出不称全局注销。 | `L/src/accountLifecycleService.test.mjs`、`identityAdminClient.test.mjs`、`accountDeletionFence.test.mjs`、`accountDeletionDeviceVisualization.test.mjs`；`I/src/accountLifecycleRepository.test.mjs`；E-IDENTITY/E-LITEASY/E-PG-L/E-PG-I/S13 文档。 | PG 验证业务清理/锁，IdP 是合成回执；device/visualization 补充入口只有 mock PG 并发边界。未完成真实 IdP 四 audience、多阶段跨服务中断、全平台退出验证；D03 未改变。 |
| AC36 账号资料导出/跨 scope — `partial` | `AccountDataExportPanel` / `accountDataExport` 已接个人中心：仅本人当前云清单/云画像及明确勾选、来源可核实的产物；5 分钟计划绑定 endpoint/issuer/subject/epoch，逐项 GET 重鉴权/revision/取消复核，再生成 ZIP。字段白名单排除配置；包内列明 PDF/本机/组织/Intuecho/历史记录等排除项。 | `D/tests/accountDataExport.test.ts`、`AccountDataExportPanel.test.tsx`；`L/src/server.test.mjs` artifact GET 与 revoked identity、`agentArtifactRepository.test.mjs` subject+artifactId/revision；E-EXPORT。原 PDF 转移另见 E-DESKTOP/E-LITEASY。 | 有实际 ZIP 解包与取消/过期/换号/不同 endpoint/org source 失败关闭测试；尚需 root 最终 build 与真实 Tauri 用户下载、IdP 吊销时导出拒绝。不自动取本机/org，更不是全产品全账户备份。 |
| AC37 旧备份恢复删除复活 — `partial`（真实 PG 核心链已通过） | 先对无删除墓碑、publication 未撤回的新合成源库 dump，再用既有 repository 删除/撤回；从备份外较新账本导出精确 command，旧备份恢复到新库后在隔离 recovery role 下重放。业务 role 的 CONNECT 只在重放及全部状态验证成功后开放。 | E-BEFORE-EVENT 15 cases：旧私有/公开状态确实存在；缺 journal、不完整 journal、重放中断均保持 SQLSTATE 42501；删除清私有、公开去标识、撤回保留回复、重复幂等、旧消息/已删作者迟到写入拒绝。原 E-RESTORE 另验证含既有墓碑快照恢复。 | 已补跑 AC 的真实 PG before-event/replay/gate 部分；尚未验证真实 IdP revocation ledger、S3 资料、生产独立 journal 异地备份/完整性来源和部署路由 readiness。合成角色门禁不是已上线的自动恢复系统，不能声称生产整体通过。 |

### AC38–AC44：个人资料、协议与真实平台

| AC / 判定 | 当前实现 | 具体测试与证据 | 缺口或待运行环境 |
| --- | --- | --- | --- |
| AC38 公开资料预览 — `partial` | composer 预览作者可选公开字段及 profile revision；来源贡献者展示绑定审阅快照，改变需重审；不以 profile 推断权限。 | `W/AnnotationComposer.test.tsx` 的 optional author details/profile revision；`I/src/server.test.mjs` profile snapshot/provenance；E-WEB、`/tmp/liteasy-account-profile-web.log`、E-INTUECHO/E-PG-I。 | DOM/API/PG 快照字段已有证据；旧内容是否刷新资料必须遵循明确规则，未做真实多客户端 profile 改动与历史内容整链验收。 |
| AC39 新旧协议共存 — `partial` | 增量 migration 保持既有 PDF/thin-reading/reply 契约；ambiguous draft 无默认 public；旧 unbound 队列/目录保留不认领；旧 publication 重放不能复活已撤回内容。 | `I/src/literatureContracts.test.mjs`、`migrations.test.mjs`、`thinReadingWithdrawal.test.mjs`；E-PG-I/E-RESTORE/E-CATALOG/E-ISSUER；`/tmp/liteasy-account-s03-contracts.log` typecheck。 | schema/fixture 和 PG 迁移不等于发布过的旧 desktop/mobile/web 二进制与新服务滚动部署兼容性；最终干净提交 contracts 仍待记录。 |
| AC40 小组贡献可复用结论 — `partial` | Web reading-group 建包需选材预览；问题/定位普通 reply；主持摘要保留异议和引用 revision；个人 reflection 可导出，不自动独立公开。 | `W/reading-group/OrganizationReadingGroup.test.tsx` 11 项、`readingGroup.test.ts` 4 项、`OrganizationAnnotations.test.tsx`；E-WEB、`/tmp/liteasy-account-s07-integrated-web.log`（72 项）。 | 只有合成 UI/API fixture，没有 3 位自愿参与者试点。`docs/S15-pilot.md` 是脚本，不是用户研究、AI 共识、留存或费用结论。 |
| AC41 Windows 原生 — `not_run` | Tauri identity 世代/本机退出/远程回执实现、资源和安全配置存在。 | 辅助：E-IDENTITY/E-BUILD，以及 `D/tests/desktopIdentityClient.test.ts`、Rust `desktop_identity::tests`。 | 缺真实 Windows Credential Manager、系统浏览器 OAuth、refresh、关闭应用后 deep link、切号/退出；未执行 Windows Installer CI。Linux/mock 不能替代。 |
| AC42 Linux 原生 — `not_run` | 同一 Tauri host；纯状态 Rust 测试和 cargo check 可在 WSL/Linux 运行。 | 辅助：`/tmp/liteasy-account-rust-check.log`，Rust identity 6/catalog 3 项，E-BUILD/E-CATALOG。 | 缺真实桌面 Secret Service/session bus、系统浏览器回调、应用关闭/重开与 keyring 撤销流程。WSL cargo check 不等于 Linux native GUI 验收。 |
| AC43 macOS 原生 — `not_run` | 同一身份/世代/远程回执代码路径。 | 只有跨平台源码及 E-IDENTITY 的模拟状态证据。 | 缺 macOS Keychain、签名应用、系统浏览器 OAuth/refresh/关闭后回调、切号和退出；未运行 macOS 原生。 |
| AC44 Mobile 受众吊销 — `not_run`（真实 IdP） | mobile audience/client 绑定已有验证，删除回执必须含 mobile，旧缺 mobile 回执不得自动 completed；私有数据写入 deletion fence。 | `L/src/accountLifecycleService.test.mjs` completed replay/resume、`identityAdminClient.test.mjs`、`server.test.mjs` mobile audience；E-IDENTITY/E-LITEASY/E-MOBILE。 | 未在测试 IdP 启用 mobile 并建立真实活动会话，然后 disable/delete 验证 refresh/access 全拒绝。Mobile 10 文件 19 项与 Web build 不是 Android native，也不是本 AC 的通过。 |

## AC37 仓库内 before-event 演练复现

可重跑脚本：[verify-before-event-replay.mjs](../../../products/intuecho/services/api/scripts/verify-before-event-replay.mjs)，配置校验 [postgresRecoveryGuard.mjs](../../../products/intuecho/services/api/scripts/postgresRecoveryGuard.mjs)。脚本使用仓库相对 import，复用既有严格 PostgreSQL URL guard 和 migration runner，不需要 `/tmp` 原脚本或某个开发者工作树。没有默认数据库、默认端口、PG 环境变量或生产 URL 回退；无显式配置直接拒绝。

先由操作者在**专用、可丢弃、非生产的 loopback PostgreSQL 实例**准备控制数据库和测试管理员。不要给生产实例或含未知数据的共享实例加标记以绕过门禁：

- 使用非默认显式端口、字面量 `127.0.0.1` 或 `::1`；控制库名为 `account_recovery_control_<6–32 位小写字母或数字>_test`。
- 专用角色名为 `recovery_test_admin_<同样格式随机后缀>`，`LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT`；仅因演练创建新库/新角色而需要两个创建权限。通过安全交互设置密码，不把密码写入 shell history 或仓库。
- 控制库归该角色；撤销 PUBLIC CONNECT，再仅授该角色 CONNECT。在控制库授它 `EXECUTE ON FUNCTION pg_control_system()`，用于校验实例标识。
- 操作者从该隔离实例读取 `SELECT system_identifier::text FROM pg_control_system()`，并设置控制库注释为 `liteasy-isolated-recovery-control:v1:<该 system_identifier>`。脚本校验连接目标、注释、实际 cluster ID 和非超管理员属性，全部通过后才创建演练库。
- 准备库外、仓库外的既有 evidence 目录，以及该 PostgreSQL 版本的 `pg_dump`/`pg_restore` 二进制目录。Linux portable PostgreSQL 必要时显式给 `libraryDirectory`；普通安装可省略。

私有配置文件的结构如下；示例中的值都是占位符，不能直接连接任何服务。文件权限必须为 0600，目录/凭据均由操作者显式提供：

```json
{
  "schema": "liteasy.postgres-recovery-test/v1",
  "disposableTestInstance": true,
  "adminDatabaseUrl": "postgresql://recovery_test_admin_example:REPLACE_PRIVATE_PASSWORD@127.0.0.1:55433/account_recovery_control_example_test",
  "expectedSystemIdentifier": "REPLACE_WITH_ACTUAL_SYSTEM_IDENTIFIER",
  "binaryDirectory": "/absolute/path/to/postgresql/bin",
  "evidenceDirectory": "/absolute/path/outside/repository/evidence"
}
```

从仓库根目录执行：

```bash
node products/intuecho/services/api/scripts/verify-before-event-replay.mjs --config /absolute/private/test-recovery-config.json
```

每次只创建随机新 source/restore `_test` 数据库，不覆盖任何已有数据库。source 为 owner/app 两角色，restore 为 owner/recovery/app 三角色；均 `NOSUPERUSER NOCREATEDB NOCREATEROLE`，恢复操作与业务访问分开。脚本保留随机新库/角色和受限证据供复核，没有自动清理共享资源的步骤。只有输出目录下的无凭据 `result.json` 可归档；`credentials.json`、dump、journal 和工具日志仍保持本机 0600，不能公开或提交。

仓库版实际运行：`/tmp/liteasy-account-before-event-repo.log`；受限原结果为 `/tmp/liteasy-account-postgres-THQsE7/repository-recovery-evidence/before-event-drill-507a91a66c/result.json`。可提交的白名单证据为 [S14-before-event-evidence.json](S14-before-event-evidence.json)，包含脚本内容 hash、真实 27 个 migration、15 个 case 和明确未验收项，不含任何连接 URL、密码或正文。

实际步骤与断言：

1. 新建 `account_before_source_507a91a66c_test` 与 `account_before_restore_507a91a66c_test`。撤销 PUBLIC CONNECT，目标 business 未授 CONNECT。源库从空库运行当前全部 27 个 migration；恢复后再次验证仓库 migration 名称及 checksum。
2. seed 合成私人批注、应按 D03 保留的公开批注、另一作者的公开 publication/legacy mapping 和回复。确认无删除墓碑和撤回记录，然后真实 `pg_dump`。备份 hash 固定，源库之后才执行现有 `deleteAccount` 和 publication retract。
3. 从较新的 `account_deletion_jobs` + `account_lifecycle_audit` 和 `desktop_annotation_publications` 提取两条恢复命令；绑定备份 hash、批次 hash/数量、源/目标库和高水位。它是本次合成恢复材料，不是新线上平行账本，也不证明生产 journal 持续备份能力。
4. 将旧 dump 恢复到目标新库，确认被删私有批注仍存在、待撤回 publication 仍为 public、对应 tombstone 不存在。以 business role 新连接实际被拒绝。
5. 缺失 journal、不完整 journal、成功重放删除后故意中断撤回，均保持 SQLSTATE 42501。补全后复用既有 repository 完成撤回；重复全部命令，确认不重复匿名化、不升 revision、不重复操作。
6. 开放前确认私有消失、公开正文按 D03 保留并去标识、撤回 private/non-plaza、他人回复仍在；旧 publication 与已删主体新写入都拒绝。全部断言成功后，唯一 `GRANT CONNECT` 才开放该恢复库 business role，再验证数据及非超权限。

历史临时脚本的 15 case 通过保留在此前 `before-event-drill-2aa21242af`（当时实际 26 个 migration）中，不能替代本次仓库版 27 个 migration 的结果。仓库版首次配置校验因数据库注释使用错误系统函数而在创建演练库之前失败；改用共享对象注释函数后全链通过。严格 URL/配置 guard 两文件 11 项也通过；没有放宽数据库约束或跳过步骤。

仍需运营设计和环境验收：独立 journal 来源可信度/连续高水位、跨地域保留与恢复、事件缺页检测、真实 IdP/S3 顺序及部署路由门禁。本脚本的 CONNECT gate 是可执行的合成恢复门禁，没有修改线上默认启动行为。

## 云缓存 issuer 核查结论

不能笼统报告“所有 cloud cache 均已验收”。本次识别与确认的边界如下：

| 位置 | 当前边界 / 状态 |
| --- | --- |
| `D/app/features/library/cloudLibraryStorageClient.ts` / `accountSessionBinding.ts` | PDF 授权缓存 v2 使用 `accountActorStorageKey`：endpoint + issuer + 已验证 subject；session.endpoint 必须与当前 endpoint 相符；缺绑定不读写旧 actor cache。 |
| `D/app/features/visualization/visualizationPendingRequestStore.ts` | 本次由 v1 的 endpoint+subject 改为 v2 endpoint+**精确 issuer**+subject。旧 v1 原件保留且不读/不迁移。E-ISSUER 证明相同 endpoint/subject 不同 issuer 隔离。 |
| `D/app/controllers/useCloudAccountController.ts` / `visualizationOrchestrationClient.ts` | 只有有效完整 actor binding 才建 client；不再用 email 回退主体；issuer 进入 memo deps 并传到 store。缺 userId/issuer/endpoint 不能发恢复请求。 |
| `D/app/features/library/useCloudLibraryTree.ts` | 内存请求 key 通过会话 generation 隔离，generation 随 issuer 变化推进。该点是运行态隔离，不意味着其所有持久衍生物天然获得授权。 |
| `D/app/layout/AppShell.tsx` / artifact repository/recovery | 持久作用域已改为包含 endpoint/issuer/subject 的 JSON 元组；运行任务另绑定 session epoch，避免把 epoch 放进持久 key 造成每次登录失去资料。已纳入最终桌面全测与生产构建；旧未验证目录不自动迁移见 E-CATALOG。 |
| `D/app/features/library/LibraryPane.tsx` 的展开偏好 | collection/folder expanded key 仍主要按 accountScopeId/organization ID，未全部包含 endpoint/issuer；这是目录展开 UI 偏好，不是 PDF/正文授权缓存。不能以此断言正文已泄漏，也不能声称所有 UI 状态完全 issuer 分区。 |
| `D/app/features/library/paperCacheClient.ts` | native PDF 字节按 content hash 的本机缓存属于设备文件层，不能把它强制等同云账户所有权；任何云资料使用仍必须经当前 scope 的授权/调用入口。离线 OS 原件不因注销删除。 |

最终提交和受影响检查结果见 `verification.json`；以上 `partial`、政策 HOLD、三平台 native 与真实 IdP `not_run` 不因编译通过自动消失。
