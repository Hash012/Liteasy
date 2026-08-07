# Liteasy 文件系统与存储边界实施审计

状态：整体尚未完成；本地库、正式文献树、组织治理、团队批注、Intuecho 批注社区、推荐、个性化隐私、桌面与 Intuecho Web 身份客户端、独立 Intuecho PostgreSQL、独立管理前端、正式模型代理、固定外部检索与受控 PDF、公开控制面、平台 RBAC/单文献支持访问及账号生命周期已有仓库实现，发布环境证据仍待完成  
审计日期：2026-08-07  
设计基线：`project-docs/design/Liteasy-文件系统与存储边界设计.md` 第 1–20 节

## 1. 审计方法与结论

本审计没有以设计第 19 节或第 21 节作为唯一清单，而是按第 1–20 节逐节反向检查运行路径、持久化模型、授权点、失败补偿、UI 调用、测试和运维脚本。已执行三十八轮差距检查：

1. 从设计实体和身份边界检查数据库迁移、对象引用、本地库标记和数据路径。
2. 从用户操作反查 UI、controller、Tauri 命令、云 API 和服务端最终授权。
3. 从失败与重启场景检查幂等、修订号、暂存、回滚、对象校验、回收站和维护任务。
4. 全仓扫描 mock、Demo、fixture、JSON 主数据和 fallback，并人工区分虚假成功与合法确定性降级。
5. 从实际生产构建物和所有可导出服务构造入口反查，发现并修复“开发适配器可被生产进程实例化”及“测试论文被 Vite 复制到 `dist`”两个前四轮未发现的反例。
6. 从独立产品和桌面宿主边界反查 Intuecho 持久数据位置、论坛数据库隔离、主窗口内容安全策略及旧路演脚本，关闭发布目录内数据库、禁用 CSP 和过期 Demo 运维入口。
7. 从正式部署反查同步 SQLite 耦合，拒绝把 `dev-cloud` 伪装成可配置生产服务；新建独立 PostgreSQL/S3 服务边界，并在真实 PostgreSQL 16 执行 schema 与反例约束，同时确认正式业务路由尚未迁移。
8. 从文献下载反查对象授权，补齐 scope 绑定的授权、在线阅读与导出路径，并验证内容哈希或对象键不能绕过逻辑条目直接读取。
9. 从云端树完整操作反查正式 API，迁移更新/移动、跨作用域复制、整树回收/恢复/永久删除、仅元数据补 PDF 和乐观并发事务。
10. 从最后引用删除后的对象生命周期反查，发现并修复已完成上传工作流阻止永久删除的外键；加入过期回收、`deleting` 状态、引用竞态约束和可重试 S3 垃圾回收，再用全新 PostgreSQL 16 实例复验。
11. 从第 8、10、12、15 节反查正式治理与隐私链路，补齐组织策略 revision、画像/词项/信号/反馈/抑制/候选/缓存/本地清单表、严格清单字段白名单、关闭采集和完整事务清除，并在真实 PostgreSQL 16 验证逐表归零且收藏不受影响。
12. 从桌面到正式服务的调用契约反查，发现并修复云文献、画像与元数据请求缺少 Bearer 头、画像更新缺少版本/幂等参数及组织负责人没有策略设置入口；新增路由层主体覆盖与 member 拒绝测试，仍明确识别 opaque 开发会话不等同 OIDC token。
13. 从第 7.2 节实体可达性反查 `team_annotations`，发现原表缺少组织外键与文献作用域一致性约束且没有正式 API；新增第十份不可变迁移、数据库触发器、作者/管理员权限、revision、幂等和审计事务，并用真实 PostgreSQL 验证跨组织反例。桌面仍需显式“共享到组织”入口，私人批注不会自动上传。
14. 从第 8.1、17.3 节生命周期反查维护任务，发现推荐候选和缓存虽有 `expires_at`，正式维护命令却未消费；将候选、缓存和过期幂等记录纳入有界 `SKIP LOCKED` 事务清理，并用第二个全新 PostgreSQL 16 实例验证过期删除及未过期保留。
15. 从桌面实际请求头反查正式 CORS 预检，发现迁移期流式上传仍发送兼容 `dev-cloud` 的 `X-Liteasy-Session-Id`，但正式白名单未允许；补齐预检契约。正式服务仍忽略该头并只以 Bearer token 为身份事实。
16. 再按第 1–20 节复查实际可达路径：补齐桌面组织批注的显式共享、加载、作者编辑与授权删除，将开发云契约对齐正式路由；复验正式组织成员角色、暂停/恢复和所有权转移。本轮同时反证“阶段 0–7 全部完成”的旧结论：OAuth/PKCE、推荐生成、正式管理面和账号删除仍缺少生产链路，因此整体必须保持“未完成”。
17. 从第 8、15、16、17 节反查正式推荐链路：迁移真实 Crossref 检索、候选、24 小时缓存、反馈/抑制、授权路由和桌面 Bearer 契约。本轮发现并修复候选表的全局主键导致多用户同文献冲突，以及桌面缓存作用域上传本地路径、未绑定个性化版本两个反例。关闭个性化时正式服务主动忽略历史画像、词项与反馈，但仍允许基于当前显式选中文献的非个性化检索。
18. 从第 12、15、17 节反查桌面正式身份客户端：新增 Authorization Code + PKCE S256、系统浏览器随机回环回调、state/nonce/ID Token/`at_hash`/userinfo subject 校验、OS 凭据库存放刷新凭据、访问 token 仅内存保存、刷新轮换及 RFC 7009 撤销。正式登录不显示密码框；只有 HTTP loopback 开发端点保留开发密码登录。真实 IdP staging 与 Windows Credential Manager 实机证据仍缺失。
19. 再从第 12、15–18 节反查生产管理权限：新增第十三份正式 PostgreSQL 迁移、一次性管理员引导、数据库角色授权、`liteasy-admin` audience、新鲜 MFA、幂等角色授予/撤销、最后管理员保护、最长 60 分钟且精确绑定单篇 PDF 的支持访问，以及追加写审计触发器。本轮自查发现最初按作用域授权会放大正文读取范围，已收紧为 `scope_type + scope_id + document_id` 并用全新 PostgreSQL 16 验证跨文献拒绝。管理前端、账号生命周期和 IdP 全会话吊销仍未完成。
20. 从第 3、4、12、16–18 节反查 Intuecho 正式边界：保留并继续限制 SQLite 开发适配器，新增独立 PostgreSQL schema、不可变迁移、迁移/在线角色分离、正式 Fastify 路由、OIDC JWT + introspection、`intuecho-web` Web PKCE 和 `liteasy-admin` 管理回查。全新无卷 PostgreSQL 16 验证空库、草稿发布幂等、同名不同 subject、关注/收藏/评价/评论隔离、治理审计追加写和应用角色无 DDL；首次容器验证发现中文主题可读 ID 与受限 ID 规则冲突，已改为 UUID 并从全新数据库复验。目标环境 PITR、静态加密、真实 IdP/MFA 和浏览器 E2E 仍未取得。
21. 从第 8、12、15–18 节反查账号禁用、删除与跨服务恢复：新增第十四份 Liteasy 和第二份 Intuecho 迁移、独立 IdP management client、三 audience 吊销确认、持久删除阶段、Intuecho 私人状态清理与公开作者去身份化。首次真实 Intuecho PostgreSQL 执行发现数据修改 CTE 的聚合重算仍读取旧快照，已改为显式排除被删主体并在全新无卷实例复验归零；Liteasy 全新实例同时证明组织负责人前置拒绝、个人数据逐表归零、组织数据及共享 PDF 对象保留、阶段防倒退、幂等续跑和审计不可篡改。真实 IdP management API 与 staging 三 audience 吊销仍缺部署证据。
22. 从第 13.1、17.1–17.2 节反查 Agent 生成内容的真实运行能力，发现 HTML 预览原允许任意脚本、`unsafe-eval`、HTTP/HTTPS 连接和外部资源，这会把模型输出变成未信任主动内容。现将预览收紧为最大 512 KiB 的声明式 HTML/CSS：解析前限制输入，使用惰性 `template` 去除脚本、事件属性、表单、子框架、对象、模板及外部链接/资源，CSP 禁止脚本、连接、导航和表单提交，iframe 不授予任何 sandbox capability。专项 `6/6` 和完整桌面测试通过，生产构建中未找到旧 `unsafe-eval` 或外连策略。
23. 从第 12.2、15.2 节反查管理员配额分配，发现正式库虽有 `storage_quotas`，但只能通过 SQL 维护，没有管理 API、修订号或更新者。新增第十五份不可变迁移和 `liteasy-admin` 配额读取/设置路由；设置要求数据库 `platform_admin`、新鲜 MFA、原因、幂等键和乐观修订号，组织必须真实 active，已删除用户不能重新配额。全新无卷 PostgreSQL 16 实例证明迁移、更新、幂等重放、旧修订号/未知组织拒绝、受限应用角色和审计不可篡改；容器已自动删除。同轮确认 Intuecho 正式服务已有帖子治理路由，剩余缺口是独立管理前端以及 API/检索源配置。
24. 从第 12.2、15.2 节反查模型与检索控制面，发现桌面把 OAuth access token 放入开发兼容的 `X-Liteasy-Session-Id`，正式服务又缺少对应 PostgreSQL 模型和管理路由。桌面已改为 `Authorization: Bearer`，正式服务新增第十六份不可变迁移、脱敏桌面模型策略以及模型策略/检索源管理 API。所有管理写入要求 `liteasy-admin`、数据库 `platform_admin`、新鲜 MFA、原因、幂等和 revision；任意层级的密钥字段、直连已知模型上游、带凭据/查询/片段或非公开地址的检索源均失败关闭。全新无卷 PostgreSQL 16 实例验证 16 份迁移、58 条审计、创建/更新/删除、自动 ID 幂等重放、冲突与反例、schema 无敏感字段、受限应用角色和审计不可篡改；容器已删除。此轮只完成公开配置控制面，凭据化 provider、私有连接器和独立管理前端仍未完成。
25. 再从第 4、12、13、15–18 节反查独立管理面，新增 `LiteasyClaw/admin` 的 Fluent 2 Web 客户端，固定使用独立 `liteasy-admin` Authorization Code + PKCE public client，OAuth 状态和 token 只进入 `sessionStorage`。账号、角色、组织、配额、单文献支持访问、模型代理策略、公开检索源、审计和 Intuecho 帖子治理均调用正式 API，不复用 Demo 重置或 SQLite 开发账号。反查真实返回时发现组织暂停/恢复响应会把配额、成员和用量伪装成 `null/0`，现改为同事务重查完整治理投影；全新无卷 PostgreSQL 16 复验 16 份迁移和 60 条审计。Playwright 以 `1440×900`、`390×844` 遍历八个视图并执行暂停确认，发现并修复操作完成后短暂显示空白确认框；页面无全局横向溢出，移动宽表只在自身容器滚动。该浏览器检查只使用测试网络拦截证明仓库 UI，不冒充真实 IdP/MFA 或 staging 跨域联调。
26. 从第 3、4、12.1、12.5、13.1、15.2、17.2 节反查模型执行闭环，确认桌面虽已同步公开策略，正式云却没有 `/v1/model/generate`，且模型请求此前未携带当前 OAuth token。桌面现用当前内存 access token 添加 Bearer；正式云新增 OpenAI Responses 与 DeepSeek Chat Completions 部署密钥适配、非流式/NDJSON 流式路由、`liteasy-desktop` audience、严格字段和大小上限、服务端固定模型及策略 provider 校验。密钥、上游地址和实际模型不进入数据库公开策略、readiness 或前端；上游错误正文既不回传也不记录，带 traceId 的服务日志仅含状态类别、正文大小、主体、provider、输入/输出长度与耗时，不含 prompt/正文。缺少 provider 配置时稳定返回 503，不伪造答案。此轮只证明仓库协议和受控替身，上游 staging 连通、托管密钥轮换与 KMS 仍属发布证据。
27. 从第 4、8、12、13、15、17 节反查正式外部检索闭环，发现控制面只能保存来源名称/URL而没有可执行协议，桌面检索与 PDF 请求缺 Bearer，客户端提交任意 PDF URL 会把服务变成 SSRF 抓取器，检索缓存也没有正式实现。现将管理面收敛为固定 Crossref、OpenAlex、Semantic Scholar connector 及官方 HTTPS 地址，新增认证 `/v1/research/external-knowledge` 和 `/v1/research/external-pdf`；结果缓存按 subject 和请求/来源 revision 指纹隔离一小时，PDF 只通过绑定 subject/source、15 分钟有效且每次重新签发的 grant 获取。下载逐跳校验 HTTPS、公网 DNS、重定向、MIME、PDF 文件头、大小、超时和 SHA-256。首次全新 PostgreSQL 执行发现过期 grant 清理把保留字 `grant` 用作别名，修复后从第二个全新无卷实例复验 17 份迁移、60 条审计、缓存跨用户隔离、TTL 清理及受限应用角色；容器已自动删除。仓库测试不冒充真实上游连通或目标环境网络控制证据。
28. 继续从第 3、8.1、17.3–17.4 节的数据生命周期正文反查，而非沿用第 27 轮差距结论，发现外部检索缓存只有一小时 TTL，尚未满足“TTL 和容量淘汰”；本地库也只有打开目录和移动根目录，没有设计要求的备份提示与完整导出。检索缓存现增加 `last_accessed_at` 和 subject/访问时间索引；命中只更新访问时间而不续期，每个 subject 最多保留 100 个结果集，写入在 subject 级事务锁内按最久未访问淘汰。第 28 轮再次从全新无卷 PostgreSQL 16 执行全部 17 份迁移，直接构造 102 个同 subject 结果验证收敛到 100，并确认另一 subject 的缓存保留；`liteasy-postgres-round28` 已自动删除。本地设置页新增明确的非云备份提示和完整备份入口；Tauri 在已存在的目标目录下创建唯一副本，复用根迁移的符号链接/特殊文件拒绝、逐文件 SHA-256 全树清单和失败清理，但不切换根指针或删除源库。Rust 测试证明 PDF、元数据、批注、索引与回收站所在全树一致，且库内目标失败关闭。
29. 从第 7、15、17.2–17.3 节重新沿 PDF 字节生命周期反查，发现正式 `services/cloud` 只验证大小、`%PDF-` 和 SHA-256，实施审计却错误声称已经完成恶意内容扫描；同时可恢复工作流可以在没有扫描证明时发布，`completePdfUpload` 也没有强制要求 `object_published`。现新增强制 HTTPS 流式扫描边界：服务端从私有 S3 暂存对象直接流向扫描器，以部署 Bearer secret、字节长度和 SHA-256 绑定请求；响应最多 16 KiB 且只允许 `clean/contentHash/scanner/version`，拒绝、超时、非法响应和哈希不一致分别映射稳定 422/503，新请求失败会删除 staging。第十八份迁移在对象和发布工作流持久化扫描时间、引擎、版本及同哈希证明；数据库完成阶段同时要求扫描证明和 `object_published`，恢复任务先补扫并落库再发布。历史对象不伪造证明，树、复制、下载和 readiness 均失败关闭；`maintain:storage` 每批流式补扫最多 100 个。全新无卷 PostgreSQL 16 从零执行 18 份迁移，验证错误哈希约束、未发布完成拒绝、60 条审计、revision 12 和应用角色无 DDL；`liteasy-postgres-round29` 使用 `--rm` 且已确认删除。受控扫描 transport 只证明协议和失败关闭，真实扫描引擎、病毒库更新、部署网络和 secret 轮换仍必须在 staging 验收。
30. 从第 5.2–5.3、5.6、16 阶段 1 的“磁盘真源、账号解耦、保留已有批注”反查私人 PDF 批注，发现 Tauri 虽会写 `.liteasy/paper-artifacts/`，仍无条件把完整批注写入按 SaaS 账号分区的 WebView `localStorage`，宿主写失败还静默把该缓存当持久回退；这会使备份真源和 A/B 账号一致性取决于浏览器状态。现收敛为：非 Tauri 浏览器开发保留本地缓存；Tauri 只向 `paper-artifacts/<document>/annotations.v1.json` 持久写入，失败显示可重试提示。首次迁移会枚举同一文献的所有旧账号键，按批注 ID 与更新时间合并，写盘成功后删除这些浏览器副本，避免先登录账号遮蔽其他账号旧批注。Rust 新增原子创建/替换且无临时残留的宿主测试；完整结果为 Rust `44/44`、Desktop `212` 个测试文件、`1188` 项通过、`4` 项跳过、`0` 失败，生产构建及 129 文件资产门禁通过。
31. 从第 2.5、7.5、8、9.2、10、15.2 节重新沿推荐资源的字节和归属反查，发现桌面“收藏”仍调用已废弃 collection 列表接口、没有写入用户作用域真实收藏树；即使候选有开放 PDF 也始终保存仅元数据。正式云与桌面现从当前 subject 的持久候选签发新鲜 PDF grant，绑定已启用受管 connector；本地库、收藏和组织库统一经资源 transfer controller 优先保存经服务端核验的 PDF，明确无 PDF 时才保存 `metadata_only`，且收藏成功后才记录反馈。继续反查日常开发运行路径又发现 `dev-cloud` 的 `/v1/research/external-pdf` 仍接受客户端 URL，统一外部检索也没有授权，导致新桌面契约不可用并保留 SSRF 边界。现新增 SQLite 短期授权表：外部检索和推荐候选只能从服务端可信 `fullTextUrl` 签发 15 分钟、owner/source 绑定的 grant；缓存命中重新签发，推荐公开响应剥离内部 URL，下载接口只接受 `grantId + sourceId`，跨账号、跨来源、过期授权和客户端 URL 均失败关闭，关闭/清除个性化及账号删除同时撤销授权。当前完整结果为 Desktop `213` 个测试文件、`1194` 项通过、`4` 项跳过、`0` 失败，正式云 `140/140`，开发云 `276/276`，生产构建及 129 文件资产门禁通过；这些仍是受控 transport 的仓库证据，不替代真实外部来源与网络出口的 staging 验收。
32. 从第 10.2 节“在线查看不等于复制出库”继续反查非拖拽入口，发现阅读器会在用户首次批注缓存 PDF 时自动把缓存提升到本地库；对于组织文献，该缓存来自只要求 `read` 的在线打开接口，提升动作没有再调用组织 `export` 授权，因而可绕过 `disabled/admins_only/all_members` 导出策略。现为缓存文献保留服务端来源身份；凡来源为 `cloud:user|organization`，自动转入本地库前必须重新调用 `/v1/library/documents/export`，只使用服务端返回的字节走真实本地导入。普通开放外部来源仍可直接提升自己的应用缓存。组织导出被拒绝时不会写入本地库、不会刷新资源树，也不会把缓存伪装为已提升；专项测试同时证明允许路径调用 export 且不走直接缓存移动。Desktop 完整结果更新为 `214` 个测试文件、`1196` 项通过、`4` 项跳过、`0` 失败，生产构建及 129 文件资产门禁再次通过。该收紧消除了产品 UI 的策略旁路，但仍按设计诚实承认已获阅读权限的客户端内容保护不等同 DRM。
33. 从第 3、7.2、8.1、12、15、17 节沿 Agent 产物和解析缓存反查，而不是沿用文件树差距摘要，发现 `/v1/agent-artifacts` 未鉴权、所有账号共享 JSON 命名空间、长期产物写入发布仓库 `project-docs/agent-results/`，MinerU 缓存默认位于服务源码目录且没有版本、TTL 或容量边界。开发云现将 Agent 产物写入既有 SQLite `artifacts / artifact_versions / generation_runs` 事务表并按稳定账号隔离；正式云新增第十九份不可变迁移、PostgreSQL repository 和认证的列表/保存/改名/删除 API，写入版本、幂等审计并纳入账号删除。桌面只接受当前 Bearer 会话，返回 `liteasy://agent-artifacts/<id>` 而不暴露服务器路径。MinerU 缓存移到开发用户数据根，键绑定解析器版本，默认 7 天、512 MiB 并按访问时间淘汰。全新无卷 PostgreSQL 16 执行全部 19 份迁移，结果为 `{"auditEvents":64,"accountDeletion":true,"migrations":19,"revision":12,"verified":true}`，临时容器已删除。仓库中既有 `project-docs/agent-results/` 历史开发材料和 `.liteasy-data/` 历史文件未被自动分配、迁移或删除；当前生产运行路径不再读取或写入它们，未来如需迁移必须提供显式 owner，不能猜归属。
34. 再从第 3、4、12.5、13、15、17 节反查桌面非拖拽运行路径，发现 Agent 产物作用域键虽然会在账号切换后重新请求，却只是把 B 的结果追加到 A 的内存目录；无作用域设备缓存和未完成任务也可能使 A 的产物继续显示给 B。现将未登录设备缓存与登录账号云目录分离：账号或端点变化先清除上一云作用域，服务不可用时不回退暴露设备缓存，未完成任务按作用域键隔离，旧无作用域任务只归设备本地；A、B、退出三段测试证明目录不会串用。开发云账号删除测试通过真实 API 先创建 Agent 产物，再确认 `artifacts`、版本和生成运行清理。继续扫描安装后运行路径又发现论文翻译强制只接受本机 `dev-cloud` 的 `{ok:true}` 健康协议，正式 HTTPS 云返回 `{status:"ok"}` 时必然失败；普通恢复文案还暴露仓库文档、`.env.local`、内部路由、endpoint/provider/model。预检现接受无凭据、无路径的 HTTPS 正式云或 HTTP loopback 开发服务，拒绝不安全直连，正式云契约专项通过；普通 UI 和 AI 历史不再显示内部模型诊断。最后移除安装后必然失败且会修改发布源文件的 `save_skill_document -> project-docs/agent-dev/skills` Tauri 命令，内嵌 Skill 文档保留为只读可导出内容，不另造设计未定义的长期存储域。
35. 从第 6、12.5、17.1、17.3、18.1 节重新沿“首次删除到崩溃恢复”反查，而非使用第 34 轮差距结论，发现首次移入回收站虽会原子提交索引，但旧实现没有持久事务 marker，进程在正文或伴生数据移出后退出会拆分同一逻辑文献；补入 marker 后继续构造多目标冲突，又发现回滚会先移回正文和前面的伴生目录，之后才因后续目标冲突停止，造成半恢复。现统一先核对全部正文、伴生数据、仅元数据和回收站目标，再执行任何移动；删除、恢复和多项永久删除回滚均可在冲突解除后重试。启动恢复还交叉校验事务目录名、`trashId`、当前 `libraryId`、资源类型、正文路径、伴生引用及受影响/恢复文献 ID，损坏或串换 marker 不再可能借空 ID 集合误判为已提交。同轮从第 12.5 节反查桌面任意异常显示，账号、组织、推荐、元数据、模型策略、云树和团队批注只公开结构化稳定服务错误；浏览器网络异常不暴露 endpoint，任意异常中的路径、SQL 或密钥不进入普通 UI。旧测试中要求显示 endpoint 和内部审计原因的断言已改为验证稳定投影。本轮独立复跑结果为 Rust `51/51`、Desktop `218` 个测试文件且 `1215` 项通过/`4` 项跳过/`0` 失败、正式云 `148/148`、开发云 `281/281`，Desktop 生产构建及 `129` 文件资产门禁通过；这些仍不替代 Windows 强杀、真实 IdP 或目标存储恢复演练。
36. 从第 5.1、16 阶段 1 和第 18 节反查旧账号多根目录的一次性选择路径，发现界面将“选择旧库”复用了“移动当前库”命令：选择后未选旧根仍被显示成可切换目标，而宿主实际会按非空迁移目标拒绝；单一候选自动选择和显式选择还可能先写设备级根指针，再发现旧索引损坏或扫描失败。现增加独立 `select_legacy_local_library_root` 命令，选择前先迁移旧布局、建立无账号库标记、读取索引并以真实磁盘构建快照，全部成功后才写根指针并启动 watcher。根指针写入或 watcher 启动失败会撤销指针并恢复旧账号标记；校验失败也保留旧标记和原 PDF/索引/伴生数据。已有设备级根指针后旧候选列表为空，未选目录保持原状且不再伪装成可切换库；候选同时过滤不存在目录和符号链接。单一旧根自动选择采用同样的先校验后提交顺序。Rust 正反例证明成功选择前已能构建真实快照，损坏索引时拒绝切换且原数据与 marker 均保留；Desktop 客户端测试证明旧根选择与当前库迁移使用不同命令。本轮独立结果为 Rust `53/53`、Desktop `219` 个测试文件且 `1217` 项通过/`4` 项跳过/`0` 失败，Desktop 生产构建及 `129` 文件资产门禁通过；`cargo fmt --check` 与相关差异检查通过。本轮仍不把仓库测试冒充 Windows junction、强杀或真实部署恢复证据。
37. 从新增第 12.3 节反查 Intuecho 社区闭环，将新主模型收敛为唯一 `annotation` 实体：回复关联父批注，整篇/原文字句/薄读生成目标支持多选且薄读必须携带 evidence，四种可见范围、资料快照、多机构筛选、持久用户/平台标签、平台标签申诉、`/A` 动态非持久分类、互关私聊和结构化组织邀请均进入开发与正式仓库。复查时发现回复创建只校验父 ID/范围而未校验当前用户可见性、正式路由嵌套返回未等待异步 PostgreSQL 值、账号删除先删非公开批注再删受限标签申诉三处问题，现已修复并补测试。Intuecho 到 Liteasy 组织权限使用专用 `liteasy-internal` client-credentials 边界，Liteasy 实时校验成员和邀请权限；PostgreSQL 迁移增加父子可见范围/组织一致性触发器，五迁移集成脚本覆盖新批注、组织、申诉、治理和删除。验证结果为 Intuecho API `51/51`、Cloud `153/153`、Admin `8/8`、Desktop `1220` 通过/`4` 跳过，Intuecho Web、Admin 和 Desktop 三个生产构建/资产门禁均通过；真实 IdP、Windows Tauri 和 staging 仍是发布门禁。
38. 从未来 Linux 部署反查本机可重复基础设施，新增三套隔离 PostgreSQL volume、两个产品库的 online/migrator 角色、TLS、本地 Keycloak realm、九个职责分离 client、无预置产品账号的静态门禁，以及 Keycloak 账号生命周期管理适配器。本机实际启动 PostgreSQL 16 后，Liteasy 产品库应用 `001–019`，Intuecho 产品库先应用 `001–005`；首次 Intuecho 全链路集成发现批注治理与标签申诉审计错误复用了旧帖子错误码，现以不可变 `006_distinct_append_only_audit_errors.sql` 修复，并消除 transaction client 并发 query 的 pg@9 升级警告。最终只读验证为两库 `tls: true`、online role `schemaCreate: false`、迁移数 `19/6`；Liteasy 集成为 `migrations: 19, verified: true`，Intuecho 空库集成为 `migrations: 6, verified: true`。随后修复运行探针 introspection `Authorization` 缺少 `Basic` scheme 的 401，并新增不兼任 caller 或 Admin 的 `liteasy-identity-introspection` client。镜像、绑定地址、宿主端口、Keycloak public URL/issuer、redirect URI 和 origin 已参数化；统一命令封装 prepare/start/migrate/verify/restart/status/stop。真实 Keycloak discovery、JWKS、两个 service token 的 client/audience/scope/issuer、独立 introspection、认证 revocation 请求，以及 lifecycle Bearer token 进入受保护 identity-management 路由均通过。完整 Compose 停止和基于原 volume 重建后五个服务恢复 healthy 并复验通过，旧项目容器未受影响。上述仍是本机开发证据，不是生产 IdP、MFA 或部署完成证据。
39. 继续按用户最终规则复核回复、评分、组织与软件闭环：`reply` 独立存储，带目标回复只派生一条 annotation；父删除只关闭回复投影，派生详情显示固定占位；评分收敛为 1–5 星当前值。Liteasy 薄读公开创建、编辑和切换公开会立即同步，失败进入持久重试队列，推荐直接调用 API 并可在软件内展开。组织侧新增当前成员分组读取：Intuecho 以 `liteasy-internal` 服务身份获取组织清单，普通成员只读未撤回项，owner/admin 可读撤回项并在 Web 填写原因恢复，用户 token 不跨服务。复查账号删除时又发现版本外键和组织治理审计会阻塞编辑过的非公开批注清理，新增不可变 `008–009`：父级删除级联清理私密历史、公开历史窄化去身份化、审计保留原 annotation ID 且继续追加写。真实本机产品库为 Liteasy `19` / Intuecho `9`、TLS 启用、online role 无 schema CREATE，迁移幂等复跑为空；隔离 PostgreSQL 输出 `verified:true`、`annotation_audit:4`。API `51/51`、Cloud `153/153`、桌面聚焦 `46/46`、Web/Desktop 构建通过；三条 HTTP/Playwright 验收覆盖桌面交接、论坛回复评分删除和组织治理 UI。这些都是本机开发证据，不替代 staging IdP/MFA、PITR、正式域名或生产 SLA。

设计第 1–20 节尚不能证明整体完成。以下同时包含仓库内未完成实现和必须在目标环境取得的发布证据，不得统称为“仓库已完成后的外部门禁”：

- 必须在 Windows 完整 Tauri 应用上验证文件管理器外部增删改、junction、大小写冲突和 UI 不折叠。
- `services/dev-cloud` 仍是 SQLite 和私有本地对象目录的开发实现，并在 staging/production fail closed。`services/cloud` 已真实接入 PostgreSQL、S3 SDK、OIDC/JWKS、introspection、部署密钥型模型代理、固定外部检索、受控 PDF、流式扫描协议、公开控制面与账号生命周期适配器；Intuecho 已有独立 PostgreSQL 正式运行时、Web OAuth/PKCE 和账号清理路由，独立 `liteasy-admin` 前端已有仓库实现。真实模型/检索/扫描上游、IdP、Windows、staging 跨域浏览器、PITR/KMS/加密证据仍未闭合，整套产品不能承载完整生产流量。
- RPO、RTO、审计保留期和账号删除保留期尚待业务确认，不能宣称具体 SLA。
- Zotero 第二、三阶段按设计明确不属于第一阶段，未增加半成品入口。

## 2. 第 1–4 节：目标、决策、边界与架构

状态：开发仓库实现完成；Liteasy 与 Intuecho 正式存储和业务适配已有仓库实现，目标基础设施待部署和验收。

- 桌面本地库通过 `desktop/src-tauri/src/local_library.rs` 直接读取磁盘，根目录指针位于操作系统用户级应用数据目录，不接受 SaaS `accountKey` 作为运行时授权条件。
- 四区域由 `desktop/src/app/features/library/LibraryPane.tsx` 展示，跨区域行为集中在 `desktop/src/app/controllers/useLibraryResourceTransferController.ts`，没有继续堆入 `AppShell`。
- 云端用迁移 `009_storage_identity_boundaries.sql`、`010_library_tree_transactions.sql` 和 `014_library_object_references.sql` 建立作用域、逻辑树、对象引用、配额和修订号。
- `services/dev-cloud/db/dataPaths.mjs` 强制开发持久数据库、对象和审计归档位于发布目录外。目录权限设为 `0700`，数据库文件设为 `0600`；staging/production 进程在解析这些本地路径前就由部署边界拒绝。
- Intuecho 开发数据库默认位于操作系统用户数据目录，显式配置也必须在服务发布目录外。旧发布目录数据库只在新位置为空时执行 WAL checkpoint、原子复制和 SHA-256 校验，原文件保留且既有外置数据库绝不覆盖；SQLite API 拒绝 staging/production。正式 Intuecho 使用独立 PostgreSQL URL、连接池、在线角色、migrator 和恢复证据，不导入或复用 Liteasy cloud 数据库会话。
- `services/cloud` 是独立正式进程：只接受 PostgreSQL 和 S3 配置，生产/预发布拒绝回环数据库与非 HTTPS 自定义 S3 endpoint；配置、健康响应和日志不返回连接凭据。
- Intuecho 正式进程同样只接受 PostgreSQL，要求 15+ 可写主库、TLS、不可变迁移、独立管理 API readiness 和 OIDC discovery/JWKS；空库不注入主题、文献、批注或账号。
- PDF 下载先按文献条目和作用域授权，再由服务端流式返回；不存在按内容哈希直接公开读取的 API。

开发实现没有把 SQLite 或本地对象目录描述成正式 PostgreSQL/S3 部署。正式服务的仓库能力与仍缺失的目标环境证据见第 17 节门禁。

## 3. 第 5 节：本地文献库

状态：代码完成；Windows 实机 E2E 待执行。

- 根目录设置为 `app_data/local-library/library-root.json`，库标记为 `.liteasy-library.json`；旧账号设置与 `.liteasy-library-profile` 有一次性迁移，多根冲突要求用户选择且不删除未选目录。
- 管理目录为 `.liteasy/index/`、`metadata-entries/`、`paper-artifacts/`、`trash/` 和事务暂存目录；旧平铺 v2 索引与更旧根级索引自动无损迁移。
- Tauri 私人批注以 `.liteasy/paper-artifacts/<document>/annotations.v1.json` 为持久真源并原子替换，不按 SaaS 账号分区。旧 WebView 批注按同一文献跨账号合并后一次性写盘，成功后清除缓存；宿主写失败不再静默回退。
- `libraryId`、`documentId`、`contentHash` 分离。相同字节的两个本地副本保留不同文献 ID；外部重命名按内容识别并保留文献 ID。
- 扫描只接纳大小不超过 256 MB、可读、扩展名为 PDF 且文件头为 `%PDF-` 的普通文件；不跟随符号链接，不展示 `.liteasy/`。
- 导入使用 1 MB 分块暂存和原子发布，不要求前端长期持有整份大文件。读取和云端复制也提供分块/流式路径。
- 创建、导入、重命名、库内移动、删除、恢复、永久删除、刷新和安全更换根目录均由 Rust 命令完成并验证根边界。
- 根目录迁移采用复制、逐文件哈希校验、切换指针、再清理旧目录；监听启动失败时回滚指针并保留可修复副本。
- 设置页明确提示本地库不会自动云备份，并可向已存在的外部目录导出唯一命名的完整备份。备份复用全树复制和逐文件 SHA-256 清单校验，包含 PDF、元数据、批注、索引与回收站；不切换当前根、不删除源，失败时清理不完整副本，目标位于当前库内部时拒绝。

文件监听实现：

- Rust 递归监听创建、修改、重命名和删除，250 ms 去抖合并，操作 ID 去重应用自身回声。
- 正常事件仅重新扫描并重新哈希受影响文件或目录子树；监听错误、根路径事件或增量索引不一致时完整校验。
- 监听事件直接携带该次磁盘校验生成的快照，React 不再收到事件后重复全库扫描。
- 外部删除显示明确提示；监听错误仅返回稳定错误码、用户提示和 `traceId`，详细信息只写宿主日志。

自动化证据位于 `local_library.rs` 与 `user_paper_store.rs`：扫描过滤、同字节副本、同大小改写、外部重命名、增量重扫、符号链接、Windows 大小写规则、分块导入、根目录迁移、旧索引迁移及批注原子创建/替换测试。

## 4. 第 6 节：本地回收站

状态：代码完成；Windows 文件锁与进程强杀演练待实机执行。

- 删除清单包含 `trashId`、`libraryId`、节点类型、文献 ID、原路径、删除和过期时间、载荷路径、索引条目与伴生数据引用。
- 目录以完整子树移动；恢复冲突生成可见序号，不覆盖现有文件；UI 展示占用大小和过期时间。
- 单项永久删除、清空和过期清理都先移动到 `.liteasy/trash-operations/`，一次提交索引修订号，再清理物理载荷。
- 暂存事务持久记录事务 ID、基础/目标修订号、条目、正文目标和伴生数据。事务 ID同时写入索引提交记录，避免并行操作仅凭相同修订号造成误判。
- 首次删除同样先写清单和事务 marker，再暂存正文、伴生数据或仅元数据，原子提交索引后才发布回收站条目；启动时按索引中的事务提交记录选择完整回滚或完成发布。
- 启动或扫描前恢复事务：所有正文、伴生数据、仅元数据和回收站目标先完成冲突预检，再执行移动；未提交恢复会把数据放回回收站，已提交事务只清理暂存。marker 必须与事务目录、当前 `libraryId`、清单 `trashId`、资源路径和受影响 ID 交叉一致；损坏或不自洽状态停止自动处理并保留现场。
- 自动化覆盖显式索引失败全量回滚、多项清空单修订、prepared 永久删除重启恢复、首次删除正文/批注/仅元数据崩溃窗口、多伴生目录后置冲突、恢复目标冲突、多项永久删除后置冲突及串换提交 marker 反例。

## 5. 第 7 节：云端文献与目录模型

状态：开发业务服务完成；正式 PostgreSQL schema、S3 对象适配、文献树核心及团队批注 repository/API 已迁移，桌面批注交互已接入。

- `library_folders`、`library_entries`、`storage_objects`、`storage_object_references`、`storage_quotas`、`organization_storage_policies` 和 `team_annotations` 均在事务数据库，不以 JSON 为真源。
- `entry_kind` 支持 `pdf` 和 `metadata_only`，后者没有对象引用；可后续流式补充 PDF。
- 同作用域父目录名称归一化唯一，拒绝跨作用域父节点和目录环；文件夹回收隐藏整棵子树；恢复冲突返回服务端最终名称。
- 所有树修改要求幂等键和 `expectedRevision`，事务成功后增加作用域修订号。
- 上传先写私有临时对象并由服务端计算 SHA-256、校验大小和 PDF 文件头，再从 S3 流式提交强制安全扫描；只有同哈希 `clean` 结果才能进入数据库 prepare。扫描拒绝或不可用时新 staging 删除，尚未产生逻辑条目。
- 相同内容物理去重，逻辑配额仍按每个文献副本计费。维护任务校验对象字节哈希、修复引用计数、处理可提交暂存和清理孤立对象。
- 收藏无 TTL，进入配额、备份、导出和账号删除流程。
- 正式 PostgreSQL schema 已包含上述实体、部分唯一索引、JSONB 元数据、修订号、幂等记录和审计表；数据库触发器拒绝跨作用域父节点、目录环、跨作用域文献目录及不合法的正文引用。
- 正式 S3 适配器流式接收 PDF、服务端计算 SHA-256、验证文件头和 256 MB 上限、写入临时键、按哈希复制发布并回读大小/元数据，失败清理暂存。正式扫描客户端再以流方式读取暂存对象，不在 Node 内存聚合大文件；启动时实际读取 bucket 公共访问阻断、加密、版本化/对象锁配置。
- 团队批注由正式事务表存储；数据库触发器保证批注组织与文献组织作用域一致。成员可创建及维护自己的批注，负责人/管理员可治理删除，所有写入要求 revision、幂等键并审计。桌面 PDF 阅读器已提供显式共享、加载、作者编辑和授权删除；相关鉴权上下文、组织成员识别及读写编排已收敛到 `useTeamAnnotationController`，`AppShell` 只组合阅读器绑定。私人批注不会自动上传；第一阶段在此冻结，不扩展回复、提及、通知或实时协作。

## 6. 第 8 节：推荐、缓存与个性化

状态：开发 API 完成；正式推荐生成、缓存、反馈及个性化隐私 API 已迁移，目标环境真实外部来源连通仍属发布门禁。

- 收藏、推荐缓存、候选、反馈、检索运行、画像和本地元数据快照分别存储并采用不同生命周期。
- 本地元数据同步只接收允许字段，服务端显式拒绝绝对路径、Windows 主目录和路径形态字段。
- 关闭个性化后服务端不再接收信号，也不使用历史画像生成个性化推荐；仍可执行显式输入驱动的非个性化检索。
- 清除操作在服务端事务中删除画像、词项、行为、反馈、候选、推荐缓存和本地元数据快照，并递增版本、禁用采集；接口幂等。
- 清除不会删除本地库、收藏或组织数据。UI 只有服务端确认成功后更新状态，不以清空 `localStorage` 代替服务端删除。
- 正式服务只接受账号作用域 `syncDocumentId` 和明确允许的书目字段，拒绝原始本地文献 ID、路径、目录、笔记、批注及未知字段；完整替换清单和清除结果均可按幂等键精确重放。
- 正式维护命令按 TTL 有界清理推荐候选与缓存；并发维护使用 `FOR UPDATE SKIP LOCKED`，未过期数据不受影响。
- 正式推荐只从配置的 Crossref HTTPS 端点读取可追溯 DOI 候选；联系邮箱、超时和端点是部署配置，外部失败返回稳定不可用错误，不返回静态候选或空成功伪装检索。
- 候选以 `(subject_id, candidate_id)` 隔离，反馈幂等并使相关缓存失效。桌面只同步哈希后的工作区/选择键，不上传本地绝对路径；缓存与服务端个性化版本绑定。

## 7. 第 9–10 节：四区域 UI 与拖拽矩阵

状态：代码和组件测试完成；真实桌面视觉/E2E 待验证。

- 四区域固定为本地文献库、收藏、关联推荐、组织文献库，各有独立折叠、加载、错误、空状态和登录门禁。
- 本地、收藏和组织使用紧凑树、Fluent 2 图标、Chevron、Tooltip、可访问名称和右键菜单。资源操作根据节点及权限提供，空库不注入示例目录。
- 展开状态分别按 `libraryId`、用户 ID、`userId + organizationId` 存在本机；推荐展开仅为短期状态。
- 无正文条目标记为仅元数据且不能打开 PDF，可补充正文或复制元数据。
- 同区域为移动；跨区域为复制；推荐不接受拖入。组织到本地/收藏/其他组织与向组织上传均按完整矩阵实现。
- 拖拽开始前使用当前 UI 权限，controller 提交前重新读取组织策略；服务端在写入、复制和下载/导出时再次按认证会话授权。
- 文件夹跨区域复制逐项提交并跟踪修订号；失败时补偿清理新建目标，来源不删除。组织出库策略为 `disabled`、`admins_only`、`all_members`，负责人始终可操作。
- 在线阅读使用受控缓存授权路径；产品没有宣称客户端限制等同 DRM。
- 组织负责人可在组织侧栏读取并修改上传/导出策略；界面使用服务端策略 revision 保存，失败后重新读取最新策略。管理员和成员只读，服务端仍在提交时最终授权。

## 8. 第 11 节：云端回收站

状态：开发与正式文献树回收 API 均已完成；目标 S3 环境调度证据待补。

- 用户收藏可删除、恢复、永久删除和清空；组织回收站仅负责人和管理员可管理，普通成员不可见管理能力。
- 文件夹回收统一处理子树，默认 30 天，回收期间继续计入逻辑配额；恢复重新检查父目录及名称冲突。
- 组织回收站、团队批注等变更与审计、幂等记录和作用域修订在同一事务边界。
- 永久删除移除对象引用，仅在全局无合法引用后删除字节；维护脚本从数据库引用事实校验和修复，不依赖进程内计数。

## 9. 第 12 节：身份、权限与管理后台

状态：正式 JWT/introspection、桌面、Intuecho Web 与独立管理前端 OAuth/PKCE、Intuecho 批注社区与组织授权机器身份、组织成员治理、部署密钥型模型代理、固定外部检索与受控 PDF、公开控制面、平台角色、单文献支持访问与账号生命周期已有仓库实现；生产 IdP/MFA 设备和托管密钥待集成验收。

- Liteasy、Intuecho 和管理后台共享稳定用户 ID，但 audience 分别为 `liteasy-desktop`、`intuecho-web`、`liteasy-admin`；正式 Liteasy 与 Intuecho 服务都验证 JWT 后执行 RFC 7662 活跃状态回查，错误 audience 被拒绝。
- 开发身份服务中禁用或删除账号会吊销所有 audience 会话；正式服务每次请求执行 RFC 7662 活跃状态回查。正式 cloud 已有独立 confidential management client 和 fail-closed 协议，要求 IdP 对禁用/删除明确确认三个 audience 全部吊销；真实 IdP endpoint 尚未联调，不能仅凭适配器测试宣称部署完成。Intuecho 通过身份回查验证会话，不直接复用桌面业务会话。
- 平台管理员、非生产诊断权限、组织负责人/管理员/成员分开授权；生产环境服务端强制禁止诊断角色。
- 正式支持访问独立授权、最长 60 分钟、要求原因并精确绑定 `scope_type + scope_id + document_id`；下载时再次匹配授权文献并写 `liteasy-admin` 审计，平台管理员默认不能读取正文。
- 独立 `LiteasyClaw/admin` 管理后台包含账号状态、平台角色、用户/组织配额、组织治理、公开模型策略、固定检索 connector、批注与平台标签申诉治理、支持访问和审计；只接受服务发布的 `liteasy-admin` PKCE 配置，不提供密码框、Demo 重置或开发账号回退。Intuecho 正式 API 已有批注列表、撤回/恢复、标签申诉审核及追加写审计路由，经过中心 `platform_admin` 回查和新鲜 MFA。旧帖子治理路由仅保留迁移兼容。公开控制面拒绝任何密钥材料且不承担上游凭据存储；模型和可选 Semantic Scholar key 只由部署 secret 注入运行时。高风险路由要求新鲜 MFA 和原因，前端不能绕过服务端授权。
- 开发管理员由 `scripts/bootstrap-admin.mjs` 从本地密钥环境创建，且脚本拒绝 staging/production。正式云另有 `npm run bootstrap:admin`：只接收 IdP subject 和变更原因、事务锁定首个管理员、已有管理员时拒绝、首次新鲜 MFA 后才把 `pending_activation` 激活；不接收或保存密码。首次改密仍必须由真实 IdP 强制，当前没有部署证据。
- 普通 API 和桌面云客户端只公开稳定错误与 `traceId`，不返回 SQL、路径、密钥、堆栈或 endpoint；无法确认是结构化服务错误的浏览器异常统一投影为可重试的服务不可用提示，详细原因只进入受控日志或诊断数据。

### 9.1 Intuecho 批注与 Liteasy 联动增量审计（2026-08-08）

状态：本机开发闭环完成；生产镜像、正式域名、托管数据库、真实 IdP/MFA 和组织服务联调仍待部署阶段。

- 新增不可变迁移 `007_reply_rating_and_profile_names.sql`。正式 PostgreSQL 与开发 SQLite 都使用独立 `annotation_replies`、`annotation_ratings`、annotation/reply 版本记录；不再用 `annotations.parent_annotation_id` 创建新回复。
- 带文献目标的回复在单个数据库事务中创建 reply 和一条派生 annotation；纯回复不创建 annotation。回复正文编辑同步更新派生 annotation，并在写前保存两个实体的旧版本。
- 父 annotation 撤回会关闭其回复投影；派生 annotation 保留 `originalReply.status=parent_deleted`，Web 只显示固定占位，不泄露父正文。
- 星级为 1–5 整数，数据库约束范围；API 以 `(annotation_id, user_id)` upsert 保证一个当前评分，服务端拒绝作者自评。推荐排序使用星级和评分人数的有界权重，不再使用 annotation 的 helpful/misleading 二元信号。
- 学术资料和筛选已删除机构类型，只存机构名称；多机构仍按名称存在性过滤。编辑 annotation/reply 时刷新机构/学段快照。
- Liteasy 薄读创建、编辑或转为公开时立即触发同步。失败结果仍落回薄读文档的 `syncState=failed` 和 `pendingPublicAnnotationIds`，可由恢复按钮重试；同步成功保存远端 annotation ID。
- 桌面推荐仍直接调用 API，不抓取 Web。每条推荐现在带 `/annotations/:id` 详情链接，软件内点击可展开正文；复杂编辑继续使用一次性交接。
- 账号生命周期已增加 annotation 星级清除、reply 去身份化/非公开清除路径；旧 post/comment 信号仅保留迁移兼容。

验证证据：Intuecho API `51/51`、Cloud `153/153`、桌面聚焦 `46/46`、Intuecho Web 与 Liteasy Desktop 生产构建通过；本地 TLS PostgreSQL 为 Liteasy `19`、Intuecho `9`，在线角色均无 schema CREATE；隔离 `intuecho_test` 集成返回 `verified:true`，覆盖组织 owner/admin 治理、编辑历史清理与公开历史去身份化；三条真实 HTTP/Playwright 验收分别覆盖桌面交接发布、回复/评分/删除详情及组织列表/治理恢复闭环。测试账号和 SQLite 位于 `/tmp`，未进入仓库或生产数据。
- 正式云账号删除使用 PostgreSQL 操作账本和阶段任务：组织负责人未转移时在禁用前拒绝；随后 IdP 禁用并确认三 audience 吊销、Liteasy 事务清理、Intuecho 事务清理、IdP 最终删除。失败保持禁用并以同一幂等键从最后阶段续跑；`identity_delete_requested` 与 `identity_deleted` 防止最终删除后的重试倒退。真实 IdP 管理协议和跨服务 staging 故障注入仍缺发布证据。
- Intuecho 的开发数据库身份与路径边界独立于 Liteasy 业务服务；正式论坛已有独立 PostgreSQL schema/迁移/运行时。新社区主模型只有 `annotation`：支持整篇文献、原文字句和必须携带 evidence 的薄读生成目标，多目标回复、四种可见范围、资料快照筛选、持久用户/平台标签及申诉、`/A` 非持久动态语义分类、互关私聊和结构化组织邀请；旧 `topic/work/post/comment` 仅迁移兼容。Web 从论坛 API 获取公开 OIDC 配置并使用 Authorization Code + PKCE，token 与刷新状态仅进入 `sessionStorage`；只有 Vite 开发构建和双 loopback 端点才允许开发密码适配器。论坛治理使用 `liteasy-admin` token 调用独立 Liteasy `/v1/admin/me` 再次确认数据库中的 `platform_admin`，高风险写入要求新鲜 MFA，不信任 token 自报角色。
- Intuecho 组织可见性和邀请不转交 `intuecho-web` 或 `liteasy-desktop` token，而通过 `liteasy-internal` audience、`intuecho-organization-service` client、`organization:authorize` scope 的短期 client-credentials token 调用 Liteasy 内部 API。Liteasy 再从组织事务表实时判断 owner/active member、邀请者权限和目标冲突；服务 token 缓存后遇 401 会重新获取，授权或上游异常失败关闭。
- 正式 cloud 从 OIDC discovery 校验 issuer、JWKS、introspection endpoint、revocation endpoint、签名算法和 client authentication；每次业务请求验证 JWT 后再执行 RFC 7662 活跃状态回查。高风险管理契约要求 `liteasy-admin` audience、`amr=mfa` 和五分钟内 `auth_time`；平台角色来自 PostgreSQL，不信任 token 自报角色，且生产拒绝 `developer_diagnostics`。真实 IdP/MFA 设备尚无部署证据。
- 正式服务已提供组织列表/摘要、创建、邀请、加入、离开、撤销邀请、成员角色与状态修改及所有权转移；作用域、角色和会员状态由 PostgreSQL 最终授权。

## 10. 第 13 节：Mock、Demo 与测试替身

状态：完成。

生产和日常开发路径的 `mockProvider`、Demo 登录/会话、静态推荐、fixture PDF 回退、硬编码资源树、Demo 管理重置和 JSON 主数据读取已移除。受控替身只存在于测试文件、测试 fixture 或显式测试依赖注入。

第四轮审计额外发现并关闭了一个不带 mock 命名的违规路径：思维导图 workflow 曾默认返回硬编码 ACORN/ColBERT/Transformer 外部知识。固定来源已移入 `src/tests/fixtures/`；生产未注入真实 provider 时返回空外部引用并在 trace 标明 `unconfigured`，不会伪造检索成功。历史误命名的真实 PDF.js 包装 `importFixtures.ts` 也已重命名为 `importedPaperExtraction.ts`，生产依赖不再出现 fixture 边界混淆。

第四轮对 `fallback` 的人工分类结论：现存命中为真实 PDF 的 MinerU 到 PDF.js 确定性解析降级、OpenAI Responses 能力兼容重试、可追踪学术来源切换、错误安全显示、Agent 规划及默认布局/未知输入处理。它们不在缺少真实数据或服务时伪造文献、推荐或模型成功，符合第 13.2 节。

第五轮直接检查 `npm run build` 产物后发现，原 `public/fixtures` 和 `public/papers` 会把测试 PDF/图片复制到生产 `dist`。这些资产已迁到 `src/tests/assets/papers`；PDF/OCR 与真实金标测试仍使用它们。`npm run build` 现在强制执行 `scripts/verify-production-assets.mjs`，构建物一旦出现测试目录、fixture 文献引用或已移除 mock 入口即失败。

同轮扫描扩大到 `LiteasyClaw/scripts/` 后还发现三个旧路演入口：重置和播种脚本仍导入已删除的 Demo payload，smoke 脚本仍要求 `/v1/admin/demo-state` 成功。重置/播种入口已删除；新 `smoke-dev-cloud.mjs` 只读检查真实服务面，并要求旧 Demo 端点保持 `404`。旧路演 QA 指南已移入 `archive/qa/`，当前 README 不再引导使用演示账号或重置数据。

历史 `.liteasy-data` 中仍可能存在旧 JSON 文件。它们属于用户现有数据，未被删除；当前运行路径不再把 `collections.json`、`organizations.json`、`sessions.json` 或管理活动 JSON 作为主数据。

## 11. 第 14 节：Zotero 路线图

状态：第一阶段完成；第二、三阶段按设计不做。

- 第一阶段递归导入 Zotero 导出目录中的 PDF，保留安全相对层级，拒绝路径穿越和符号链接逃逸。
- 复用普通 PDF 的文件头、大小、分块导入、重复提示、文献身份、回收站和监听流程。
- 没有读取 Zotero SQLite，也没有宣称导入标签、笔记、引用键或集合元数据。
- Better BibTeX/CSL JSON、BibTeX、RIS 和受控连接器保留在设计路线图，没有生产入口。

## 12. 第 15 节：接口与命令边界

状态：Tauri、正式文献树、组织策略与成员治理、团队批注、推荐、个性化隐私、Intuecho 论坛、独立管理前端、正式模型代理、固定外部检索/受控 PDF、公开模型/检索控制面、平台 RBAC/配额/单文献支持访问及账号生命周期 API 已迁移；目标环境联调待完成。

Tauri 已注册真实快照、根目录迁移、创建目录、分块导入/取消、移动/重命名、回收、恢复、永久删除、清空、分块读取和变化订阅相关命令。路径在 Rust 层验证根边界、内部目录、穿越和符号链接。

云 API 已提供作用域树、元数据创建、补充 PDF、流式上传、复制、文献与文件夹修改/回收/恢复/永久删除、清空回收站、授权下载/导出、配额、组织策略、团队批注、个性化状态/信号/清除，以及管理 RBAC/MFA/审计能力。写接口使用幂等键和乐观修订号；授权来源是认证会话而不是客户端 `owner_key`。

上述完整业务面在 `dev-cloud` 中仍只用于开发。正式 `services/cloud` 已暴露作用域树、目录和文献更新、流式 PDF 上传/补充正文、scope 绑定下载/导出、跨作用域复制、整树回收/恢复/永久删除、清空回收站、组织策略与成员治理、团队批注、Intuecho 内部组织授权、推荐生成/缓存/反馈、画像读取/保存/清除、个性化设置/信号、本地元数据清单同步、认证模型生成/流式生成、固定外部文献检索与 grant 绑定 PDF 获取，以及公开模型/检索控制面、平台角色、用户/组织配额、组织状态、单文献支持授权/读取、审计查询和账号状态/删除；Intuecho 正式服务另行暴露批注社区和治理，独立管理前端调用正式接口。写入在 JWT/introspection 与作用域授权后执行 PostgreSQL 幂等事务；S3 发布由带持久扫描证明的可恢复工作流保证，过期回收、检索 TTL、历史 PDF 补扫及无引用对象由独立维护命令处理。模型 provider 和 PDF 扫描凭据均由部署 secret 注入；真实模型/检索/扫描上游、IdP、S3、浏览器跨域和目标环境恢复仍未验收，本节不能作为完整生产接口完成证据。

## 13. 第 16 节：迁移实施

状态：阶段 0–7 的仓库内主要路径已实现；阶段 5 已包含桌面、Intuecho Web 和独立管理前端 OAuth/PKCE、正式平台 RBAC、论坛治理、支持访问、模型代理、固定外部检索、受控 PDF 和账号生命周期，目标环境验证仍未完成。

- 保留并扩展真实扫描、导入、云端和隐私回归测试；没有覆盖或回退工作区现有修改。
- 本地库完成账号解耦、标记/索引/伴生数据迁移和多根人工选择。
- 组织、成员、收藏、策略、身份、会话、审计和个性化长期数据进入事务数据库。
- 四区域已改为真实本地/云端来源，controller 实现复制矩阵和失败补偿。
- 生产运行时 mock 和 Demo 入口已清除。
- Zotero 只完成第一阶段 PDF 路径。
- 阶段 5 已建立 OIDC 服务端验证、桌面、Intuecho Web 与独立管理前端授权码 + PKCE、桌面系统浏览器回调、OS 凭据存储、Web 会话存储、正式一次性管理员引导、平台角色、配额、组织治理、部署密钥型模型代理、固定外部检索、受控 PDF、公开模型/检索控制面、MFA、追加写审计、论坛治理、单文献支持访问和账号生命周期。真实模型/检索上游、IdP、Windows、staging 跨域浏览器证据仍不可达。

## 14. 第 17 节：安全、可靠性与运维

状态：仓库可执行边界完成；生产基础设施门禁未签署。

- 本地路径、原子写、分块大文件、解析与原文件事务分离均已实现。
- 本地完整备份在复制前后比较排序后的目录/文件大小/SHA-256 清单，拒绝符号链接、junction、设备文件和库内目标；用户选择的备份介质及其后续保留仍由用户负责。
- 云端对象默认私有，下载经条目授权并流式返回；服务端重新校验哈希、大小和 PDF 标记，并要求对象具有与内容哈希一致的持久安全扫描证明。真实扫描引擎尚未在 staging 联调，不能把受控 transport 测试写成生产扫描证据。
- Tauri 主窗口已配置限制性 CSP：脚本仅允许自身资源，连接仅开放 IPC、HTTPS 和明确的本地开发端点，并禁止对象嵌入；脚本策略不含 `unsafe-inline` 或 `unsafe-eval`。配置测试和真实 `tauri build --debug --no-bundle` 均已通过。
- Agent 生成 HTML 只能作为声明式 HTML/CSS 在无 capability 的 sandbox iframe 中预览；输入限制为 512 KiB，脚本、事件处理器、表单、子框架、对象、外部链接与外部资源均在生成 `srcdoc` 前移除，预览 CSP 也禁止脚本、网络、导航和表单提交。
- `deploymentBoundary.mjs` 在请求处理器、SQLite、本地对象仓储、服务 CLI 和维护脚本入口统一拒绝 staging/production；配齐本地路径也不能绕过。
- 正式 runtime 使用 `pg` 与 AWS S3 SDK；PostgreSQL 要求 15+ 可写主库。部署期 migrator 与在线应用账号分离，迁移采用 advisory lock 和 SHA-256 不可变校验，在线进程只校验迁移集合且不需要 DDL 权限。S3 未完整阻断公共访问、缺少服务端加密或没有版本化/对象锁时，进程在监听端口前失败。
- 正式服务的 PDF 上传和仅元数据补正文采用私有暂存对象、上传前流式安全扫描与可恢复发布工作流；扫描证明绑定内容哈希并持久化，数据库完成前强制要求对象已经发布。恢复任务不得绕过扫描证明。树修改检查作用域和环，复制、删除与恢复具有幂等和并发控制。团队批注额外由数据库触发器拒绝跨组织文献引用。
- 正式 `maintain:storage` 先以最多 100 个对象的有界批次流式补扫历史 PDF；拒绝、不可用、仍有未扫描对象都会失败退出。随后在事务中清理过期回收站并增加 scope 修订和服务审计；无引用对象先标记 `deleting`，S3 删除成功后才删除数据库记录。数据库约束拒绝可用文献引用 staging/deleting 对象，避免 GC 并发形成缺失正文。
- 同一维护入口还按有界批次清理过期推荐候选、推荐缓存和幂等记录，避免只建 TTL 字段却不执行生命周期。
- 同一维护入口也清理 15 分钟外部 PDF grants 和一小时用户隔离检索缓存；缓存另按 subject 限制 100 个结果集并按最后访问时间淘汰，命中不续期。PDF 下载使用服务端保存的授权 URL 并逐跳执行 HTTPS、公网 DNS、重定向、MIME、文件头、大小与超时校验，客户端不能提交任意 URL。
- 正式推荐外连配置只允许 HTTPS Crossref 端点，必须提供部署所有的合法联系邮箱并设置有界超时；配置不进入前端请求或 readiness 凭据响应。
- 正式模型代理只接受 `liteasy-desktop` Bearer token，严格限制输入字段、prompt 和 schema 大小，并以公开策略选择 provider、以部署配置固定实际模型。OpenAI Responses 与 DeepSeek Chat Completions 的 key/base URL/model 必须成组存在；公开配置和 readiness 只返回是否配置。流式上游被转换为有界 NDJSON，上游错误正文不回传也不记录，trace 日志仅保留状态类别与大小等最小元数据。托管密钥轮换和真实上游连通仍待目标环境证明。
- 正式平台角色、支持授权和审计查询只接受 `liteasy-admin` audience；高风险操作要求新鲜 MFA。支持授权最长 60 分钟且由数据库触发器验证单篇活动 PDF 与作用域一致，下载时再次匹配文献 ID。`audit_events` 由数据库触发器拒绝更新和删除，角色/支持授权写入、幂等结果和审计位于同一事务。
- 账号生命周期用独立 IdP management client 和跨服务持久阶段执行；少报任一 audience 吊销结果会失败关闭。Liteasy 清理个人收藏、对象引用、画像、推荐、本地清单、成员/邀请和本人团队批注，撤销平台角色及支持授权；共享对象仍由引用 GC 决定。阶段只能前进，失败后保存内部原因并向管理员返回稳定待重试错误。
- Intuecho 正式 PostgreSQL 使用独立迁移和在线角色；当前迁移集合为 `001–006`。在线角色无 DDL，旧帖子治理、批注治理、标签申诉审核与账号生命周期审计的 UPDATE/DELETE 由权限或触发器拒绝；第六份迁移为批注治理和标签申诉审计提供各自稳定的防篡改错误码。数据库约束要求独立批注/广场回复具有文献目标、薄读目标具有 evidence、回复与父批注可见范围及组织一致。账号删除事务清除交接/同步、资料、关注/互关、私聊、收藏/评价、标签申诉和非公开批注树，保留公开批注及迁移兼容帖子/评论正文并将作者去身份化；聚合计数按剩余主体重算。
- `scripts/maintain-library-storage.mjs` 处理暂存、孤立对象、引用计数、缺失或损坏对象和过期回收站。
- `scripts/archive-audit-log.mjs` 生成不可覆盖的哈希链归档并可验证。
- `project-docs/operations/Liteasy-存储备份与恢复运行手册.md` 定义分卷权限、备份、恢复和演练门禁；隔离 `/tmp` 演练已通过对象维护和审计归档/校验。
- `deploy/local` 已提供可重建且参数化的本地基础设施定义：Liteasy 与 Intuecho 使用不同 PostgreSQL 16 容器、角色、测试库和卷，Keycloak 使用第三个数据库；realm 定义三个 public PKCE client、独立 caller/introspection/service/management client 且不预置产品账号。`LiteasyClaw/services/identity-management` 将 Keycloak 全 session logout 和用户状态 API 转换为账号生命周期严格回执，并以独立 client 执行 RFC 7662 introspection。两个产品 PostgreSQL 已实际通过 TLS、角色、迁移和业务集成验证；Keycloak discovery/JWKS/token/introspection/revocation 与真实 adapter caller 授权已通过，停止/重建后也再次通过。`deploy/local/.env`、本地自签名私钥、SQLite、测试库和 Docker volume 均不属于未来 Linux 迁移物；目标环境必须从镜像 digest、配置、secret manager 和不可变 migration 重建。
- `project-docs/operations/Liteasy-后续部署与验收执行计划.md` 已将本机、Windows、Linux staging、IdP/MFA、外部上游、正式 PostgreSQL/S3、灾备和发布 manifest 拆为带前置条件、负责人输入、命令、通过标准、证据与回滚/续跑方式的执行阶段。
- `verify-filesystem-release-evidence.mjs` 要求 Windows E2E、Liteasy PostgreSQL PITR、独立 Intuecho PostgreSQL 与凭据、S3 私有/版本/加密、IdP/MFA 与 SLA 审批证据文件全部存在且 SHA-256 匹配，拒绝绝对路径、路径逃逸和符号链接。该门禁不会把 manifest 布尔值冒充真实演练，证据内容仍必须审批。

正式上线前仍必须由部署环境证明 PostgreSQL 时间点恢复、S3 版本/不可变策略、跨故障域副本、TLS、静态加密、密钥管理和真实恢复演练，并由业务确认 RPO/RTO/保留期。开发 SQLite 演练不能替代这些证据。

## 15. 第 18–19 节：测试与验收证据

状态：自动化完成；第 18.4 节外部 E2E 待执行。

本次最终验证基线（2026-08-07 当前工作树独立复跑）：

- Rust：`cargo fmt --check`通过；`cargo test --no-fail-fast` 为 `53/53` 通过，覆盖本地磁盘、迁移、监听、回收站事务与多目标冲突预检、marker 串换拒绝、完整备份及库内备份拒绝、批注原子持久化、旧账号多根目录先校验后选择及失败保留、崩溃恢复和 OAuth 回环回调/令牌边界。
- Desktop：本轮 `npm test` 退出码为 `0`；共 `218` 个测试文件、`1220` 项通过、`4` 项显式跳过、`0` 失败；`npm run build`通过且生产资产扫描 `129` 个文件。现存 PDF.js 字体和 React `act(...)` 警告未导致失败。此前同一工作树的 `npm run tauri -- build --debug --no-bundle` 也已通过。覆盖四区域、空/错/权限状态、完整拖拽矩阵、阅读器缓存提升重新校验组织导出策略、推荐 PDF 优先写入真实目标树及仅元数据降级、账号切换、旧账号多根目录选择与当前库迁移命令分离、Agent 产物 A/B/设备缓存隔离、正式 HTTPS 翻译预检、普通异常安全投影、仅元数据阅读边界、组织策略编辑、组织批注及其 controller 登录/作用域/治理角色反例、私人批注磁盘真源与旧账号缓存迁移、本地完整备份、OAuth 客户端、认证模型代理与流式稳定错误、宿主 CSP 和无脚本/无网络的生成 HTML 沙箱。
- dev-cloud：第 35 轮 `node --test --test-reporter=dot` 为 `281/281` 通过。覆盖作用域隔离、树事务、对象引用、组织策略、个性化、audience、RBAC、MFA、吊销、审计、开发适配器生产 fail-closed、账号删除清理 Agent 产物，以及外部 PDF 授权的 owner/source 隔离、到期清理、客户端 URL 拒绝和推荐候选到安全下载闭环。
- Intuecho：本轮 API `npm test` 为 `51/51` 通过；Web `npm run build` 通过且生产资产门禁为 `3` 个文件。覆盖批注多目标与薄读 evidence、独立回复/派生 annotation、星级、父批注可见性、资料快照筛选、持久/动态标签、标签申诉治理、四种可见范围、互关私聊、组织邀请与 owner/admin 治理回调、桌面交接、三个用户 audience、中心管理员回查、新鲜 MFA、编辑历史账号删除及正式运行 fail-closed。当前机器的 `intuecho_test` PostgreSQL 16 数据库已执行 `001–009`；最终幂等复跑输出 `{"posts":1,"comments":1,"legacy_audit":2,"annotations":4,"annotation_audit":4,"tag_appeal_audit":1,"accountDeletion":true,"database":"intuecho_test","migrations":0,"verified":true}`。本机产品连接另证明 Intuecho `9` 份迁移、TLS 启用且在线角色无 schema CREATE；该证据仍不替代 PITR、静态加密和 staging IdP。
- 本地部署基础设施：identity-management `7/7`、部署配置测试、Shell 语法和 9-client 静态门禁通过；运行探针输出 `identityManagementAuthorization/jwks/oidcDiscovery/revocationEndpoint/runtime/serviceTokens: true`。两库产品连接再次证明 `tls: true`、`schemaCreate: false`、迁移数 `19/9`，迁移幂等复跑均为 `applied: []`。Compose 停止/重建后同一验证此前已通过；本轮未据此宣称生产部署。该证据只证明本机 Keycloak development mode 与自签名 PostgreSQL TLS 基础，不替代 staging HTTPS、数据库 `verify-full`、MFA、PITR 或生产 SLA。
- production cloud：本轮 `npm test` 为 `153/153` 通过，新增 Intuecho 专用机器身份、owner/active member 授权、暂停/移除成员拒绝、事务锁内组织修订、结构化邀请幂等和 service audience 审计覆盖。既有覆盖仍包含流式扫描请求、不聚合 PDF、部署认证、严格 16 KiB 响应、同哈希 clean 证明、拒绝/超时/非法响应、staging 清理、prepare 前扫描、恢复先落证明后发布、旧对象补扫、readiness 失败关闭和稳定 422/503，以及固定 Crossref/OpenAlex/Semantic Scholar 契约、来源端点白名单、Bearer research 路由、用户隔离缓存、缓存命中重新签发 PDF grant、禁止客户端 URL、公网 DNS 固定、重定向、MIME、PDF 文件头、大小、超时和哈希反例。这些扫描与 connector 测试使用受控 transport，不冒充真实上游连通。本轮另在本机独立 PostgreSQL 16 `_test` 数据库从空库执行十九份迁移并通过完整业务适配集成，输出 `{"auditEvents":64,"accountDeletion":true,"migrations":19,"revision":12,"verified":true}`；在线产品连接另证明 TLS 已启用且无 schema CREATE 权限。
- Admin：本轮 `npm test` 为 `8/8` 通过；`npm run build` 通过且生产资产扫描 `3` 个文件无密钥、mock、Demo 或开发端点。新 UI 使用批注治理与平台标签申诉审核 API；构建存在约 551 KB chunk 警告但未失败。此前 Playwright 使用符合 `oidc-client-ts` 格式的 `sessionStorage` 会话，并仅在测试网络层提供 API 响应；该证据不替代真实 IdP/MFA 或 staging CORS 联调。
- 运维：隔离数据目录执行 `maintain:storage`、`archive:audit`、`verify:audit`，对象无缺失，审计链验证为真。
- 静态与构建扫描：生产代码未发现 mock provider、Demo 会话、fixture PDF 回退、旧硬编码树或 JSON 主数据运行时读取；生产 `dist` 强制门禁检查 `129` 个文件通过，不再打包测试论文，也不包含 `project-docs/agent-results`、`project-docs/agent-dev`、`project-docs/test-api`、`dev-cloud/.env` 或已废弃的 `/v1/collection/items`、`/v1/collection/list` 推荐保存路径。

Windows 完整 Tauri E2E 必须在发布检查中补充：A/B 账号同库、退出后本地可用、文件管理器外部增删改、监听溢出恢复、junction、文件锁、大小写冲突、跨区域真实服务复制、窄视口和展开状态保持。未执行前状态为“代码验收通过、平台验收待完成”。

浏览器壳层已用 Playwright 检查 `1440×900` 与 `390×844`：登录面板均位于视口内，窄视口 `scrollWidth` 等于 `clientWidth`，未登录页面没有受保护接口失败或页面异常。该检查发现并修复了弹窗相对桌面最小宽度定位造成的移动端裁切，以及匿名初始化误请求管理员模型策略 API；桌面策略现在只在登录后通过 `liteasy-desktop` 会话读取脱敏 `/v1/model-policy`。

Intuecho 本机浏览器闭环已使用真实开发身份和论坛服务验证：`liteasy-desktop` audience 创建无 topic/work 映射的批注交接，`intuecho-web` audience 以同一 subject 消费交接，恢复正文、DOI 和原文字句，发布后再按稳定文献身份从广场读回。`1280×800` 与 `390×844` 均通过，移动端无横向溢出；这属于 Linux 本机开发浏览器证据，不替代真实 IdP、staging CORS 或 Windows Tauri 验收。

## 16. 第 20 节：明确不做项核对

状态：符合。

没有实现本地与收藏自动双向镜像、多本地根同时启用、通用文件管理器、Zotero JSON/BibTeX/RIS、Zotero SQLite 直读写、客户端不可绕过 DRM，或生产管理员原始堆栈/密钥/私密正文展示。

## 17. 发布门禁清单

以下项目未完成前不得把系统描述为生产就绪：

1. 在目标 Windows 版本完成第 18.4 节完整 Tauri E2E，并保存日志、截图和失败重试证据。
2. 在 staging 用部署 secret 或托管密钥连接真实模型、PDF 扫描引擎及 Crossref/OpenAlex/Semantic Scholar 上游，验证扫描器病毒库/规则更新、拒绝样本、超时、响应哈希、secret 轮换、限流、重定向、内容日志与网络出口边界；联调独立管理前端与 Liteasy、Intuecho 的精确 CORS origin，并以部署所有的联系邮箱完成真实推荐/检索链路测试；完成桌面 OAuth/PKCE 的 Windows 实机登录/恢复/撤销后，部署目标基础设施并完成迁移回滚、故障注入和跨故障域恢复演练。
3. 验证真实 IdP management API、三个 audience、MFA、新鲜认证、禁用/删除全会话吊销、账号删除跨服务失败续跑和支持访问过期的正式环境配置。
4. 由业务负责人签署 RPO、RTO、审计保留期和账号删除保留期。
5. 用正式备份副本完成一次隔离恢复，记录实际数据截止点、恢复时长、对象完整性和审批结果。
