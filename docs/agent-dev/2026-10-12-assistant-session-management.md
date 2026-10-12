# AI 会话管理实施与验收记录

日期：2026-10-12。输入：`tmp/Liteasy_AI_Session_Management_Spec_Pack.zip`。
评审基线：`259fa0b6ae00433f92a28fec276298f4d56a9197`；实施基线：`627626de`；桌面版本：`0.1.45`。

本记录区分实现、自动化验证与仍未实测的环境。不能把以下单元测试、浏览器测试或 SQLite 测试表述为全部 Windows GUI P0 场景已通过。

## 基线差异核对

| 规范发现 | 当前基线 | 本次处理 |
| --- | --- | --- |
| R1 工作流合成用户消息 | 仍存在 | 移除任务页伪用户消息；对话工作流产生明确的 task_reference 和来源反链 |
| R2 非薄读任务抢占导航 | 仍存在 | 后台任务只更新任务列表；详情必须通过显式请求打开 |
| R3 pending 禁止导航 | 仍存在 | 公共 Agent 路径允许 A 运行时打开 B；旧 embedded 路径保留运行期间导航保护 |
| R4 关闭视图取消 | Pane 清理仍 cancel；但较新 AppShell 已用持久 portal | 保留 portal，把跨功能编排迁到 controller，feature view 不拥有运行；应用 owner 退出只解绑，不伪造取消 |
| R5 parser 改 running 为 cancelled | 仍存在 | 恢复为 unknown，保留排队意图，移除失效确认控件；本地执行 owner 在真正重启后报告 interrupted |
| R6 全量快照写入、错误 CAS | 仍存在 | 分离索引、消息、视图草稿、任务输入和 outbox；使用本视图已加载的 revision，冲突明确拒绝 |
| R7 缺少导航管理 | 仍存在 | 对话／任务、标题搜索、置顶、人工标题锁定、归档、未读及安全内容导出 |
| R8 UI 截断但运行历史仍在 | 仍存在 | 编辑、重新生成、重试创建新分支和 runtime session，旧讨论保留；新分支明确传递相同可见历史 |
| R9 用户正文不使用共享 Markdown | 仍存在 | 共享正文 renderer；上下文名称通过受控 AST 标记，保留表格／代码／公式结构和净化策略 |

保留了后续统一内容资产、paper anchor、共享 ContentView、FluentProvider、停靠布局与薄读 trail 改进。未提交工作区原有 `.gitignore`、`AGENTS.md` 或 2026-09-27 的 agent terminal 评估文档。

## 按阶段的改动与决定

### PR-01：语义和来源

- `assistantSessionContracts.ts` 定义 origin、target、conversation、task binding；通过原有 `write-object-schemas.ts` 生成 `assistant*.v2.schema.json`。
- UI session 是导航投影，继续使用原有 AgentSession / AgentRun、ObjectRef、ContextRef。mode、consumer 与 origin 分开。
- 工作台新任务记录 `workflow_entry`；对话工作流记录 `conversation_action`、父对话和触发消息。AppShell 和 scoped repository 校正 actor scope。
- 任务入口保留兼容字符串 API，并增加结构化 `{ message, taskIds }` 回执。主应用使用结构化回执；旧嵌入消费者暂时保留字符串反馈。
- 薄读继续聚合同一 artifact 的多层任务。任务原始参数独立保存，产物后续版本不覆盖讨论绑定的 ObjectRef。

### PR-02：运行、持久化和恢复

- `controllers/assistant/AssistantSessionController.tsx` 承担跨模块编排；`assistantSessionService.ts` 管理每个目标的 store、run、queue 和连续事件水位；feature `AssistantPane` 仅提供视图。
- 公共 Agent 的事件、取消回包和完成回包绑定原目标。导航、停靠移动和关闭视图不决定取消。
- `FrontendAgentClient` 合并并发 connect，支持查询 run、按原 request 查询回执，以及仅解绑订阅。既有 Agent runtime 的幂等映射继续作为受理事实来源。
- 消息、显式上下文 refs、发送意图和草稿清空进入同一 object storage commit；失败不调用 Agent。实际 wire input 在派发前再次冻结。runtime state 和 object storage **仍是两个存储**，通过稳定 requestId 和可核对 outbox 收敛，未宣称分布式原子性或 exactly-once。
- 连续流式内容按 250ms 节流提交，避免逐 token 写全库，也避免持续输出导致防抖永不落盘。存储失败保留内存内容并显示失败。
- inbox 对 eventId 去重，缓存序号缺口；公共客户端查询 run 补取。最终消息和连续水位与相应 session 投影共同提交。
- 恢复未受确认的发送记录显示“需要核对”，不自动重放付费请求或旧授权。回执查询沿用原 requestId；网络不可达仍为未知。未实现任意工作流断点续跑。

### PR-03：界面

- 后台任务不切换活动目标、不清空输入、不 focus；运行时仍可浏览其他对话。
- 空白无草稿对话不写索引；手工标题不被自动标题刷新；阅览不刷新业务活动时间；归档不 cancel。
- 任务详情的讨论入口明确叫“围绕此结果提问”，只在结果完成后开放。任务引用卡默认不展开工作日志。
- 每个目标按 messageId + offset 保存滚动锚点；上翻后提示新内容而不跳底。读屏公告完整回复数量，避免逐 token 播报。
- 保存状态与运行状态分开；Tauri 显示“已保存本机”，Web 显示“已保存到此浏览器”。没有“已同步”声明。

### PR-04：上下文与分支

- 首次追问解析已保存产物并捕获不可变结果 ref，记录任务与关联讨论；以后复用讨论及原 ref。新版本可以通过既有上下文资源入口显式加入，旧轮次不自动换版本。
- 有父对话的任务返回父对话。没有结果／当前无权访问时保留原身份并报错，不猜同名资源。
- 编辑和重试的分支具有独立 runtime client，并从可见分支收集送模历史。旧分支仍可从历史打开。
- 用户与 AI 正文共用 Markdown、净化和资源导航。导出仅包含可读消息和必要版本引用，脱敏凭据，不导出执行确认或 private trace。
- 复用已有消息 capture、ObjectRef 和 artifact resource resolver。**尚未新增完整的会话 transcript／任务报告虚拟资源 provider**，不会显示虚构路径或宣称这些投影已可检索。

### PR-05：迁移与门禁

存储布局（沿用现有 SQLite / IndexedDB）：

| 前缀 | 职责 |
| --- | --- |
| `assistant/v2/session/` | 标题、来源、状态、消息身份索引；不携带正文 |
| `assistant/v2/message/` | 单条语义消息、版本引用与公开输出 |
| `assistant/v2/task-input/` | 原任务参数快照 |
| `assistant/v2/outbox/` | 稳定发送身份、受理与核对状态 |
| `assistant/v2/draft/<window>/` | 每个窗口的输入、附件与选区上下文 |
| `assistant/v2/view/<window>` | 当前导航目标 |
| `assistant/v2/legacy-backup` | parser 处理之前的原始旧值 |
| `assistant/v2/quarantine` | 旧损坏记录与位置 |
| `assistant/v2/migration` | 可重入迁移完成标记 |

旧 `assistant-history/current` 与原 native JSON / localStorage 值保留，完成迁移后新应用只读旧路径。缺失旧 origin 时采用 legacy_unknown，不按标题推断。逐条验证和隔离；新 canonical 数据损坏时允许正常数据阅读，但禁止覆盖写入。未知未来版本拒绝写入。

CAS 使用加载时版本，拒绝用旧快照覆盖其他窗口的新消息。草稿按真实 Tauri window label／浏览器 tab 身份分离；未做跨设备合并。旧二进制不理解 v2 前缀，不能改写新记录；退回旧二进制只能看到其旧格式数据，不能宣称透明降级同步。未提供完整旧 UI feature flag 回退；升级前备份仍保留在原存储中。

## 自动验证与未验证层次

命令均在 `products/liteasy/apps/desktop` 执行，除注明者。

- 受影响测试：`assistantSessionRepository`、`assistantSessionOwnership`、`AssistantMultiSession`、`assistantHistoryPersistence`、`AssistantPane`、`AssistantMessageList`、`AssistantLearningMaterials`、`assistantInlineContext`、`assistantArtifactRouting`、`agentStatePersistence`、`objectWorkbench`、`dockAssistantLifecycle`、共享内容等。
- 完整桌面测试：两分片合计 **550 个文件、3825 项通过**，保留原有 3 文件 / 7 项环境条件 skip；使用现有分片：`npm test -- --shard=1/2`、`npm test -- --shard=2/2`。没有新增 skip。
- `npm run ci:smoke`、`npm run build`；提交后 `npm run ci:contracts`。
- 根目录：`cargo test --locked --no-default-features --manifest-path products/liteasy/apps/desktop/src-tauri/Cargo.toml object_store::tests`，8 项通过。新增 native SQLite 子进程强制退出测试验证消息、refs、outbox 和草稿一起恢复；未提交尾部不恢复。
- 根目录：`cargo check --locked --all-targets --no-default-features --manifest-path products/liteasy/apps/desktop/src-tauri/Cargo.toml` 通过。本地 Rust 为 1.98.0；Windows CI 按现有 workflow 使用 1.98.1。
- Playwright：`assistantSessionNavigation.browser.spec.ts` 和 `thinReadingBackgroundSessions.browser.spec.ts` 通过，使用明确的 synthetic model fixture；实测浏览器存储与刷新，不是 native Tauri GUI。
- 首轮完整测试发现旧来源回调断言、恢复 cancelled 假设、旧 renderer 节点定位和无变更保存绕过 scope 校验；均修正或换成新的行为断言，未删除整类测试。

### 场景映射

“自动化”只覆盖所列层次；“未完整”表示不能声称整个场景已通过。

| ID | 证据 / 状态 |
| --- | --- |
| A01 | 会话来源、独立 runtime client、原问题保存；session / ownership 自动化 |
| A02 | 结构化 task_reference、父消息来源；artifact routing 自动化；兼容字符串消费者降级 |
| A03 | 非薄读任务不改变草稿、选区、焦点；ownership 集成；native GUI 未验证 |
| A04 | 重复结果追问复用讨论并冻结 revision；ownership 集成 |
| A05 | 薄读 trail 聚合；session 单元 + 浏览器多层生成 |
| A06 | 原 Agent 幂等测试和原 task/run 身份；全部任务的独立复制／主动重跑统一 UI 未完整 |
| A07 | A 运行时可看 B；ownership + 浏览器 |
| A08 | 持久 portal 移动／隐藏不 cancel；dock integration；native GUI 未验证 |
| A09 | 两个已受理 run，停止 A 保留 B；ownership 集成 |
| A10 | 原 runtime terminal guard 与完成回包投影；取消／完成故障组合未完整 |
| A11 | runtime owner 重启报告 interrupted；Agent state 测试；Tauri 整应用 kill/relaunch 未验证 |
| A12 | parser 保持 unknown，查询失败保留请求；真实远端断网重连未完整 |
| A13 | 旧控件移除，原权限绑定／过期检查继续运行；权限与 state 自动化；native 重启 UI 未验证 |
| A14 | queue / outbox 保存原目标，恢复不自动派发；进程退出时排队 UI 未完整 |
| A15 | 原 scope tests + disposed owner 拒绝迟到投影；真实双账号 GUI 未验证 |
| A16 | fake-IDB / UI 失败不派发；SQLite 原生事务回滚；Tauri invoke 故障注入未验证 |
| A17 | 稳定 requestId 查询已有 run，保留原幂等映射；真实“受理后丢回执”端到端退出未完整 |
| A18 | 1、3、重复 3、2 连续水位与去重；repository / owner 自动化 |
| A19 | 写失败重试、流式节流保存；持续 token 测试；native 磁盘满 UI 未验证 |
| A20 | 双 repository 陈旧快照拒绝覆盖；fake-IDB 集成；真实双窗口未验证 |
| A21 | 不同 viewId 草稿并存；repository 集成；真实窗口 UI 未验证 |
| A22 | 原始备份、稳定 ID、重复迁移及隔离 fixtures；迁移进程中止所有时序未完整 |
| A23 | 独立损坏消息 / session 隔离，future schema 拒写；repository 自动化 |
| A24 | native SQLite 真实子进程退出 + 浏览器 refresh；整 Tauri GUI 未验证 |
| A25 | 独立 v2 前缀、保留旧备份、未知版本拒写；真实旧安装器降级未验证 |
| A26 | 原 runtime 完整历史保留，分支历史选择；Agent history / branch 自动化 |
| A27 | 人工标题、置顶、归档、读状态实现；所有管理组合 GUI 未完整 |
| A28 | 按目标保存 message anchor、非底部不跟随；真实长消息滚动组合未完整 |
| A29 | 共用 renderer / AST / 净化；message / unified content 自动化 |
| A30 | 320/400/560px 浏览器截图；中英、深浅色、人工读屏组合未完整 |
| A31 | 1000 索引 / 30000 消息的 fake-IDB 基准；native/WebView 绘制时延未验证 |
| A32 | r1 讨论不被 r2 替换，送入真实客户端请求；ownership 集成 |
| A33 | 编辑创建分支，捕获送模历史并重新打开旧讨论；ownership 集成 |
| A34 | 复用原 ObjectRef / resource 权限与缺失处理；全套对象与上下文测试；任务结果失权端到端未完整 |
| A35 | 复用现有 capture + 安全导出；完整 transcript/report 虚拟 provider 未实现 |
| A36 | 归档不 cancel、不级联删除论文／产物；删除与永久删除管理未开放 |
| A37 | 本机／浏览器保存文案以 commit 为准，无同步声明；native GUI 状态审计未完整 |

## 性能记录

命令：`npx vite-node scripts/benchmark-assistant-sessions.ts`。Node 22.23.2；AMD Ryzen 9 7940HX；32 logical CPUs；约 32GB RAM；development；fake-indexeddb。

1000 条索引 / 30000 条消息：冷读取 20.03ms，只加载当前 30 条消息，35 次 record get；热加载单个会话 p50 2.68ms / p95 5.16ms；标题搜索 p50 0.07ms / p95 0.19ms。

这些是 repository 微基准，不含 React paint、真实 IndexedDB 或 SQLite IO，不能充当 SPEC 的 native/WebView <150ms / <300ms 验收结果。

## 演示步骤

1. 直接提问，回答未结束时新建 B 并写草稿；A 完成后确认 B 输入不变，从历史返回 A。
2. B 写草稿时在 AI 工作台生成文献树；确认任务角标更新而活动目标不变。
3. 打开任务详情，待结果保存后选择“围绕此结果提问”；发送问题，再次从任务进入，确认复用同一讨论与原结果版本。
4. 编辑早期问题并发送，确认新分支中不含被排除的后续回答；历史可打开原讨论。
5. 输入草稿，等待保存状态，再刷新浏览器；native 整应用退出流程需另行真实 GUI 验收。

Windows 安装包交付使用最终提交上的既有 Desktop CI 完整门禁；构建链接与下载产物在本次交付消息中给出。跨设备同步、独立 daemon、任意断点续跑、完整 transcript 虚拟 provider 和永久删除均不作已完成声明。
