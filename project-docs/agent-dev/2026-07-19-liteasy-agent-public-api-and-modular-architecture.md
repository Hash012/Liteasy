# Liteasy Agent 对外接口与模块化内部设计

> 日期：2026-07-19
> 更新：2026-07-20
> 状态：v1 已实现并接入产品前端；会话状态已有本地原子快照兜底；论文模态分析结果可原子写入仓库并在重启后恢复；CLI/MCP 可通过运行中桌面应用的本机 socket 使用，尚未开放网络监听端口。
> 关联文档：`项目上下文与设计总览.md`、`agent-dev/liteasy-agent-core-design.md`、`agent-dev/2026-07-19-multi-paper-analysis-agent-feasibility-and-stack.md`。

## 1. 结论

Liteasy 不应为前端、CLI 和 MCP 分别实现三个 Agent。三种入口必须共用同一个应用服务、AgentCore 会话、运行时、动作注册表、风险确认、预算和审计边界；入口只负责协议转换。

首版采用如下结构：

```text
React 前端 ─ frontendAgentClient ─┐
产品 CLI ── agentCliAdapter ──────┼─ AgentPublicApi v1
MCP host ─── agentMcpAdapter ─────┘        │
                                           ▼
                              agentApplicationService
                              会话 / 幂等 / 运行 / 取消
                              确认 / 事件 / 能力裁剪
                                  │             │
                         AgentCoreSession       宿主上下文
                         memory / budget        resolveContext
                                  │             │
                                  ├── command ─ agent-runtime
                                  └── qa/explain ─ retrieval + model
```

核心决定有五个：

1. `agent-runtime` 仍是所有状态变更的唯一执行边界。
2. CLI/MCP 请求不能自带“当前工作区已导入、用户已登录”等权威状态；这些状态只能由宿主注入。
3. 命令和论文问答共享 Core、会话、预算、memory 和事件协议，但保留不同 executor。
4. 高风险动作永远以 `confirmation.required` 暂停，调用方只能用确认 ID 批准或拒绝，不能直接调用内部 action。
5. 对外协议只公开稳定摘要和 JSON 数据，不公开内部 planner、完整 prompt、memory、密钥或可绕过 policy 的函数引用。

## 2. 解决的需求缺口

原有 `AssistantPane` 已能直接调用 AgentCore、命令 runtime 和知识问答，但它同时承担了跨 feature 编排。由此产生的缺口是：

- CLI/MCP 无稳定入口，只能重复 UI 逻辑或绕过 UI 直接触达 action。
- 缺少会话、运行 ID、幂等键、取消和查询运行状态的统一语义。
- 内部 `AgentRuntimeEvent` 会随实现演进，不能直接作为长期外部协议。
- 确认对象存在于 React 状态中，外部客户端无法安全恢复。
- 能力表虽然已存在，但没有对外裁剪后的只读视图。
- 工作区上下文由谁提供、用户输入能否覆盖上下文，边界不明确。

本设计把这些职责移到 `controllers/agent/agentApplicationService.ts`。UI feature 只消费稳定客户端；运行时 feature 不依赖 controller 或 presentation，继续满足 `layout -> controllers -> features` 的依赖方向。

## 3. 对外契约

协议版本固定为：

```text
liteasy.agent/v1
```

所有入口最终映射到同一个 `AgentPublicApi`：

```ts
type AgentPublicApi = {
  createSession(input): Promise<AgentApiResult<AgentSession>>;
  closeSession(sessionId): Promise<AgentApiResult<AgentSession>>;
  submitTurn(input): Promise<AgentApiResult<AgentRun>>;
  resolveConfirmation(input): Promise<AgentApiResult<AgentRun>>;
  cancelRun(input): Promise<AgentApiResult<AgentRun>>;
  getRun(input): Promise<AgentApiResult<AgentRun>>;
  listCapabilities(): Promise<AgentApiResult<AgentCapability[]>>;
  subscribe(sessionId, listener): () => void;
};
```

### 3.1 会话

创建：

```json
{
  "consumer": "frontend",
  "clientSessionId": "window-main",
  "principalId": "optional-user-id"
}
```

返回服务器生成的显式 `sessionId`。`consumer` 为 `frontend | cli | mcp`，仅用于审计和默认策略，不授予额外权限。关闭后的 session 不能再次提交任务。

带 `clientSessionId` 的创建请求也承担重连语义：若 `clientSessionId + consumer + principalId` 对应的 session 仍为 active，则返回原 `sessionId`，否则创建新 session。不带 `clientSessionId` 的请求始终新建。产品前端使用稳定的 `assistant-pane`，所以应用重启后可以重新取得原 session；前端自动生成的幂等键包含随机 UUID，不会因进程内计数器重置而碰撞。

session、run、公共 event、幂等映射和 pending confirmation 会写入本地版本化快照。重启时恢复终态和等待态；原先为 `running` 的 run 不尝试盲目续跑，而是补一个 `run.failed` 并提示重新提交。等待确认的 run 仍必须由原 session 显式批准，批准时重新读取当前环境并重新经过 runtime 校验。等待确认/澄清的历史事件会在重连订阅时回放，供前端恢复确认卡或澄清提示。

### 3.2 提交 turn

```json
{
  "sessionId": "session-...",
  "idempotencyKey": "client-generated-unique-key",
  "input": {
    "mode": "qa",
    "message": "比较这些论文的实验设置"
  },
  "attachments": [
    {
      "source": "selection",
      "uri": "liteasy://selection/current"
    }
  ]
}
```

`mode`：

- `qa`：基于论文证据回答。
- `explain`：概念解释，但仍受所选证据和引用约束。
- `command`：规划并执行产品动作。

`idempotencyKey` 在单个 session 内唯一。相同键和相同输入返回原 run；相同键配不同输入返回 `idempotency_conflict`。这避免 CLI 重试、MCP client 超时重试造成重复导入、上传或删除。

附件只是用户意图/资源引用。服务端必须检查 URI、权限、当前 selection snapshot 和 revision；不得相信客户端用附件声明的导入状态或权限。

### 3.3 Run 状态机

```text
                  ┌─ waiting_clarification ── 新 turn 补充信息
running ──────────┼─ waiting_confirmation ─── approve ── running
   │              │                              │
   │              │                         reject
   │              │                              ▼
   ├─ completed ◄─┴────────────────────────── completed
   ├─ failed
   └─ cancelled
```

状态为：

- `running`
- `waiting_clarification`
- `waiting_confirmation`
- `completed`
- `failed`
- `cancelled`

取消是幂等操作。应用服务先触发 `AbortSignal`，再写入 `run.cancelled`；executor 必须在模型调用、检索批次和长任务边界检查 signal。当前已有同步 UI action 无需强制中断。

### 3.4 人工确认

外部只看到：

```json
{
  "type": "confirmation.required",
  "confirmationId": "confirm-...",
  "summary": "删除选中的文献",
  "action": {
    "actionId": "workspace.delete_documents",
    "arguments": { "scope": "selected_document_set" }
  },
  "traceId": "trace-..."
}
```

批准/拒绝：

```json
{
  "sessionId": "session-...",
  "confirmationId": "confirm-...",
  "decision": "approve"
}
```

服务端保存未裁剪的内部 confirmation，但不序列化 React 闭包或旧 runtime context。调用方不能回传修改后的 plan 或 action 参数；批准时宿主重新读取当前权限/工作区状态并由 runtime 再校验，避免长时间等待后使用旧闭包。确认 ID 必须属于同一 session，使用一次后失效。拒绝不会执行 action，并以正常完成结束该 run。

### 3.5 事件

每个事件包含：

```ts
{
  apiVersion: "liteasy.agent/v1";
  eventId: string;
  sessionId: string;
  runId: string;
  sequence: number;
  emittedAt: string;
  type: string;
}
```

v1 事件如下：

| 事件 | 作用 |
| --- | --- |
| `run.started` | turn 已接收，记录原始 mode/message。 |
| `context.prepared` | 权威上下文、Core prompt 与预算已准备。 |
| `plan.preview` | 对外裁剪的计划摘要；只含 action ID，不暴露 planner 内部数据。 |
| `progress.started` | 已开始执行计划。 |
| `assistant.message` | 回答或动作反馈，可带 citations/confidence。 |
| `ui.render` | 可渲染的 UI DSL JSON。 |
| `clarification.required` | 缺少上下文或意图歧义。 |
| `confirmation.required/resolved` | 风险动作人工闭环。 |
| `action.requested/failed` | action 执行观察事件。 |
| `task.requested/created` | 后台任务生命周期。 |
| `artifact.requested` | 产物创建请求。 |
| `run.failed/cancelled/completed` | 终态。 |

同一 run 的 `sequence` 从 1 单调递增。客户端应按 `(runId, sequence)` 去重和排序；未知事件类型应忽略，不能让新版事件导致旧客户端崩溃。

### 3.6 错误

公共方法不以未处理异常表达业务错误，而返回：

```json
{
  "ok": false,
  "error": {
    "code": "session_not_found",
    "message": "...",
    "retryable": false
  }
}
```

错误码：`invalid_request`、`session_not_found`、`session_closed`、`run_not_found`、`confirmation_not_found`、`idempotency_conflict`、`unsupported_operation`、`execution_failed`。

executor 抛出的错误会转为 run 内的 `run.failed`，以便事件订阅者和随后 `getRun` 得到一致结果。协议/参数错误仍由传输适配器按所在协议返回。

## 4. 三种入口

### 4.1 前端

`createFrontendAgentClient(api)` 自动创建 `consumer=frontend` 的 session，提供：

```ts
client.connect();
client.send({ mode: "qa", message: "..." });
client.confirm(confirmationId, "approve");
client.cancel(runId);
client.subscribe(onEvent);
client.close();
```

React controller 应持有 client；`AssistantPane` 只把事件归约成消息、进度、确认卡和 UI DSL。环境则由桌面 controller 的 `getEnvironment()` 动态提供，避免闭包持有旧 selection/settings。

### 4.2 CLI

CLI adapter 输出 JSON Lines，事件在前、最终 run 在后，方便人读、shell 管道和自动化程序共同使用：

```text
liteasy-agent capabilities
liteasy-agent session create [clientSessionId]
liteasy-agent session close <sessionId>
liteasy-agent turn <sessionId> <command|explain|qa> <idempotencyKey> <message...>
liteasy-agent run get <sessionId> <runId>
liteasy-agent run cancel <sessionId> <runId> [reason]
liteasy-agent confirm <sessionId> <confirmationId> <approve|reject>
```

当前实现由 Tauri 桌面进程创建本机 Unix socket，再通过 Tauri event/command 将请求交给前端持有的同一个 `AgentPublicApi`。CLI 不创建第二个 Agent，也不复制工作区状态。Linux/macOS 下 socket 权限固定为 `0600`；默认位置在 Liteasy 应用数据目录，可用 `LITEASY_AGENT_SOCKET` 覆盖。

桌面应用运行后，同一可执行文件可作为 CLI：

```text
liteasy-desktop --agent-cli capabilities
liteasy-desktop --agent-cli session create terminal
liteasy-desktop --agent-cli turn <sessionId> qa <idempotencyKey> 比较这些论文
```

stdout 只输出 JSONL 结果，诊断写 stderr。Windows named pipe 尚未实现；Windows 版本当前只保留进程内 API。

### 4.3 MCP

MCP adapter 提供 tools：

- `liteasy_agent_session_create`
- `liteasy_agent_turn`
- `liteasy_agent_confirm`
- `liteasy_agent_run_get`
- `liteasy_agent_run_cancel`

资源：

- `liteasy://agent/capabilities`
- `liteasy://agent/sessions/{sessionId}/runs/{runId}`（动态读取）

MCP tools 用于有副作用或参数化操作；resources 用于读取能力和运行记录。返回同时包含 `structuredContent` 与 JSON 文本镜像，以兼容只读 text content 的客户端。业务失败使用 `isError: true`；未知 tool/resource 属于协议错误。

这个 MCP 是“外部客户端调用 Liteasy Agent”的入站接口，与 Agent 内部将第三方 MCP server 注册成 action 的出站接口不同。出站 MCP 工具必须先经过能力注册、schema 校验、风险评级与 allowlist，不能把任意远程 MCP tool 直接透传给模型。

当前 stdio bridge 实现了所需的 MCP JSON-RPC 子集：`initialize`、`ping`、`tools/list`、`tools/call`、`resources/list`、`resources/templates/list` 和 `resources/read`。启动方式：

```text
liteasy-desktop --agent-mcp
```

它逐行读取 stdin、通过受限 socket 转发到运行中的桌面 Agent，并将 MCP 帧写 stdout；日志只写 stderr。规范依据：官方 [Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) 与 [Resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)。若后续增加 Streamable HTTP、OAuth 或完整 MCP capability negotiation，应迁移到官方 [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)（MIT），并补认证、Origin 防护、限流和资源 URI 权限校验。

## 5. 内部模块设计

### 5.1 Public contract feature

位置：`features/agent-api/`

| 模块 | 职责 | 禁止 |
| --- | --- | --- |
| `agentApi.types.ts` | v1 DTO、事件、错误、`AgentPublicApi`。 | 导入 runtime、React、Tauri 或具体模型。 |
| `frontendAgentClient.ts` | 前端 session 和事件订阅便利层。 | 直接调用 action/runtime。 |
| `agentCliAdapter.ts` | argv ↔ public API、JSONL。 | 自建会话/确认状态。 |
| `agentMcpAdapter.ts` | MCP tool/resource ↔ public API。 | 将内部 action registry 原样暴露成 MCP tools。 |

### 5.2 Application controller

位置：`controllers/agent/agentApplicationService.ts`

职责：

- 创建/关闭 AgentCore session。
- 管理 idempotency key、run、event sequence 和 listener。
- 从宿主解析权威上下文。
- 在每 turn 前调用 Core，在执行后回写 budget/memory 观察。
- 分派 command 与 knowledge executor。
- 保存 pending confirmation，并恢复或拒绝。
- 把内部 runtime event 映射成稳定公共事件。
- 传播取消信号，统一终态。
- 通过 `AgentStateStore` port 恢复和保存版本化状态，不依赖具体数据库。

它不负责 PDF 解析、检索算法、模型 HTTP、具体 UI action 或 MCP transport。

### 5.3 Desktop composition

位置：`controllers/agent/createDesktopAgentService.ts`

这是现有产品能力的组合根：

- command → `runAgentRuntime`
- approved confirmation → `executeConfirmedSemanticPlan`
- qa/explain → `generateAssistantAnswer`
- AgentCore prompt → 两条 executor
- 当前 runtime/knowledge 环境 → `getEnvironment()`

`getEnvironment` 每次 turn 都读取最新状态，避免 React 首次 render 的旧闭包污染长寿命 Agent session。

产品接线由 `controllers/agent/useAssistantAgentController.ts` 完成。controller 在 `AppShell` 生命周期内常驻，即使用户折叠或移动 Assistant dock，Agent session 与外部 host listener 也不会随面板卸载。`AssistantPane` 只提交 turn、消费公共 event，并保留 UI DSL 的二次校验。

外部宿主分两段：

- `controllers/agent/useTauriAgentHostBridge.ts`：CLI/MCP 请求与同一 public API 之间的前端桥。
- `src-tauri/src/agent_host.rs`：Unix socket、Tauri event/reply、`--agent-cli` 与 `--agent-mcp` stdio 进程模式。

状态存储也分两段：

- `controllers/agent/agentStatePersistence.ts`：快照 schema、运行时校验和可替换的 `AgentStateStore` port。
- `controllers/agent/tauriAgentStateStore.ts`：Tauri command adapter；仅普通浏览器开发环境使用 `localStorage` 兜底。
- `src-tauri/src/agent_state.rs`：应用数据目录中的 `agent-state.v1.json`。先写同目录临时文件、`sync_all`，再 rename 发布；Unix 文件权限为 `0600`，单快照上限 10 MiB。

快照包含 public session/run/event、原始 turn 输入和内部 confirmation，因此足以恢复幂等与人工确认；不包含 API key、论文全文、React/Tauri 函数引用、旧 runtime context、完整 AgentCore prompt 或 AgentCore 私有 memory。恢复后的 Core 从干净实例开始。JSON store 是零新增依赖的可靠性兜底，`AgentStateStore` 接口保留了迁移 SQLite 的边界。

### 5.4 AgentCore 与 Runtime

保留现有责任：

```text
AgentCore（before/after turn）
  ├─ agent.md
  ├─ context assembly
  ├─ memory retrieval/write observation
  ├─ budget / repetition guard
  └─ capability summary

agent-runtime（command execution）
  ├─ semantic planner
  ├─ plan validator
  ├─ policy engine
  ├─ human confirmation
  ├─ action registry/executor
  ├─ rollback/fallback
  └─ journal + UI DSL events
```

当前 `qa/explain` 在生成论文产物或选中两篇及以上论文时进入 `features/paper-analysis/multiPaperAnalysisWorkflow.ts`：逐篇检索、分层覆盖论文前中后区段、轮询分配证据配额、构造 evidence matrix、记录 coverage gap，再让模型归并。`AnalysisRun/Evidence/Claim` 作为 `assistant.message.metadata.analysis` 返回并随 Agent event 快照持久化。后续生成 comparison artifact 时应再注册少量高层 action，例如 `analysis.compare_papers`；不要让客户端逐个调用底层“读第 N 页”“写 memory”等原子工具。

深度产物采用受控的 SubAgent 扇出：单篇论文按连续页区段拆成最多 4 个子任务；多篇论文按论文拆分；并发上限固定为 4。各 SubAgent 只能读取被分配的 evidence，并输出带 evidence ID 的区段研究记录。主 Agent 同时接收子报告与原始 evidence matrix，负责交叉复核、消除重复、比较论文并生成最终流式答案。任一子任务失败会形成显式失败记录，不会被伪装成已分析内容。这一实现使用现有模型 gateway，没有引入队列框架或新的运行时依赖。

### 5.5 论文模态分析与可提交产物

“选中文献 → 锁定 → 选择思维导图/树状分析/PPT/对比表”不再使用定时器拼装演示产物，调用链为：

```text
Artifact modal
  → useArtifactWorkflowController
  → runAgentArtifactAnalysis
  → FrontendAgentClient.send
  → AgentPublicApi / AgentApplicationService / AgentCore
  → qa knowledge executor + AnalysisRun/Evidence/Claim
  → POST /v1/agent-artifacts
  → project-docs/agent-results/<artifactId>.json
  → ArtifactTabs
```

单篇与多篇论文都走同一个公共 Agent API。`artifactType` 是 turn input 的可选字段，用来把用户选择的目标模态传给知识 executor；所选文献仍以 `liteasy://selection/current` attachment 和宿主实时 selection 共同约束，客户端不能伪造已导入状态。

产物只有在 Agent run 为 `completed`、存在 `assistant.message` 且包含可校验的 `AnalysisRun/Evidence/Claim` 后才允许保存。dev-cloud 使用同目录临时文件加 rename 原子发布；保存成功后 UI task 才切到完成状态。应用启动时通过 `GET /v1/agent-artifacts` 读取已有文件并恢复产物页签。

等待过程由 Public Agent API 的真实事件驱动，不使用前端假定时器。Artifact task 依次显示 `waiting_for_import → preparing_context → retrieving_evidence → generating_answer → auditing_answer → structuring_artifact → saving_result → completed`，其中 PDF 左栏的 `PDF 已就绪` 只表示检索材料已准备，不代表 Agent 已生成结果。OpenAI Responses SSE 经 dev-cloud 转为 `application/x-ndjson`，再映射成 Public Agent `assistant.delta`；树/思维导图模式会把已完整到达的 Markdown unordered-list 行解析成临时节点即时展开。临时树不持久化，最终事实树仍由完整 Evidence 生成。

失败任务保留 `run.failed.message`，并附带失败阶段、本地 Agent endpoint、provider、model、时间和恢复建议；UI 与对应的 Artifact Chat session 都显示同一诊断，API key 永不进入任务状态。OpenAI-compatible upstream 的错误解析兼容 `error.message`、字符串 `error`、`message` 与 `detail`。对网络错误、429、408 和 5xx 只做最多三次有限退避；HTTP 200 但没有任何文本的 SSE 不再视为成功，而是尝试从 `response.completed`/`output_text.done` 恢复全文，完全空输出时重连一次后明确失败。

树形图和思维导图的运行时元数据是带 `id/parentId/kind/evidenceIds` 的结构化节点，不再用制表符、ASCII 树或模型正文推断层级。界面用递归 `<ul>`、可折叠节点和连接线渲染，并按层渐进出现。相同节点树同时派生 Markdown unordered list，保存为 `outlineMarkdown`，用于人工查看、Git diff 和外部工具交换；Markdown 是可读投影，结构化 JSON 才是运行时事实源。

导入现已复用项目已有的 `pdfjs-dist`，从实际 `sourcePath` 逐页提取文本，以约 1600 字符和 180 字符重叠切块，并保留页码、摘要和轻量术语标签。只有仓库自带的 demo PDF 在解析异常时允许回退到 fixture；未知或用户导入来源解析失败会明确失败，不会用演示片段伪装全文。实测 ColBERT 为 10 页、60,518 个文本字符，ACORN 为 15 页、92,529 个文本字符。

证据规模改为随论文 chunk 数自适应：小论文可覆盖全部证据，常规目标每篇最多优选 28 条，安全硬上限每篇 48 条、单次 144 条；选择策略组合查询相关性与全文分层采样，避免方法段命中后完全漏掉实验、消融和局限。树/思维导图提示不再设置 60 节点等展示上限，要求把证据中的专有名词、算法、公式变量、数据集、基线、指标、定量结果、消融、效率和边界逐层展开。模型请求没有设置很小的 `max_tokens/max_output_tokens`；dev-cloud 普通 JSON 请求仍有 512 KiB 的明确安全上限，以容纳双论文 evidence 与 SubAgent 报告并防止无界内存占用。

### 5.6 文献资源树、Reader 与产物历史

文献库使用单列递归资源树，而不是“左侧 Collection / 右侧论文”的双列布局。文件夹、子文件夹和论文统一用 `▸/▾` 控制收起与展开；论文标题保持单行省略并用 tooltip 显示全名。论文的 checkbox 只控制分析选择集，标题点击只控制独立的 `activeReaderPaperId`，因此锁定 ColBERT + ACORN 后仍可在 Reader 中切换任一论文而不修改锁定快照。

本地资源操作沿用 `layout -> controller -> feature client -> Tauri command` 边界。右键菜单和拖拽只表达重命名/移动意图；controller 先计算新路径并检查条目冲突，Tauri 再 canonicalize 源资源与目标父目录，拒绝 `~/LiteasyLibrary` 之外的路径、覆盖同名资源以及把目录移入自身。只有磁盘 rename 与索引更新都成功后，workspace store 才按稳定论文 ID 更新路径；索引写入失败时尝试回滚磁盘移动。`.liteasy-library-index.json` 只保存 `id + relativePath`，不复制 PDF 正文。刷新按钮会重新扫描 PDF 并恢复路径，目录树显示时折叠工作区根目录之外的绝对路径段，减少无效宽度占用。

论文节点展开后显示与其关联的多模态产物和用户笔记条目。关联优先读取持久产物的 `papers`，旧结果兼容从 analysis coverage 推导。产物中心按 `activeArtifactId` 渲染并提供历史切换，不再固定显示数组第一项；每个页面明确列出来源论文。

“补充资料并重新生成”对话框把新增文本、引用、页码或要求作为独立的 `<user-supplement>` 信任域传入。重生成期间 Agent 环境临时使用原产物的 `sourcePaperIds` 与对应已导入 chunks，完成后恢复当前 UI selection；新结果另存 JSON，并记录 `regeneratedFromArtifactId`、`supplementalContext` 和 `papers`，不覆盖旧产物，也不把用户补充误标成论文原始证据。

产物 catalog 与中心区 open tabs 是两个不同集合。应用启动时，`GET /v1/agent-artifacts` 只恢复 catalog；关闭中心标签只删除 open-tab 投影，不删除 catalog 项。文献树按 catalog 的 `papers` 建立关联，点击条目时再把 catalog 项打开成中心标签。因此“关闭标签”不再导致论文下的产物入口消失。

catalog 采用本机缓存与协作 JSON 双层恢复。Tauri 桌面端把完整多模态 catalog 原子写入应用数据目录的 `artifact-catalog.v1.json`；浏览器开发模式使用 IndexedDB，缺少 IndexedDB 时才降级到 `localStorage`。启动时先加载本机缓存以恢复可见记录，再与 `GET /v1/agent-artifacts` 返回合并，远端暂时不可用不会清空本地 catalog。`models.cloud_proxy_endpoint` 因登录或本地端口变化时会触发重新同步，而不是只在 controller 首次挂载时请求一次。skill 文档属于源文件投影，不进入该缓存。

产物删除与关闭标签语义分离。“关闭”只收起界面标签；“删除产物”经用户确认后调用 `DELETE /v1/agent-artifacts/:artifactId`，服务端严格校验 ID，并且只允许删除结果目录中的单个 JSON。远端删除成功后才从 catalog、open tabs 和论文子项中移除；失败时保留本地入口，避免界面与磁盘状态分叉。同一模态、同一组论文已有持久产物时，再次点击生成会明确询问用户；确认后另存新版本，不覆盖旧结果。

`evidence-*` 是 Evidence 记录的稳定内部主键，不是面向读者的引用文本。它把树节点或结论关联到 `paperId/page/chunkId/quote/summary`，用于审计、去重和机器处理。界面保留 `evidenceIds` 元数据，但不再铺陈裸 ID；产物提供“论文原文证据”索引，显示论文、页码、原文摘录和摘要。点击证据会切换到对应论文 Reader、滚动并高亮目标 PDF 页。当前定位精度为 PDF 页级；后续若要做到页内句级高亮，应在 Evidence 中再持久化 PDF.js text item/字符范围或归一化 bounding boxes。

### 5.7 多会话 Chat 与可见生成工作记录

右侧 Chat 维护显式 session registry，普通问答与每个 ArtifactTask 分属不同 session。新建和历史切换只改变前端活动会话，不关闭共享 Agent client，也不取消后台产物 run。每个会话保存消息、模式、类型、状态和更新时间；产物会话还保存 task/artifact 关联，完成后提供“打开产物”入口。多个生成任务可同时保留在任务集合和会话历史中。

产物开始时，应用自动打开 Assistant 所在 dock region。任务的阶段、进度、`partialAnswer` 和完成/失败状态持续投影到对应 Chat session；用户主动切到普通对话后，后台更新不会抢回焦点。

SubAgent 分析新增瞬态 `analysis.subtask.delta` 公共事件，携带 `subtaskId/label/delta`。它展示的是证据区段的可见分析草稿，不是模型私有思维链。此类增量与 `assistant.delta` 一样不进入轻量 Agent 状态快照；最终答案和已保存产物仍作为持久事实源。主 Agent 最终综合开始后，产物树继续从严格 Markdown unordered list 增量解析并渲染。

普通对话和多模态任务都按真实 `runId` 提供“终止”。如果用户在 `run.started` 到达前点击，前端先记录取消意图，拿到 `runId` 后补发 `cancelRun`。已取消任务拒绝迟到的进度、完成与保存回调，因此不会出现“界面已终止但结果仍落盘”。终止状态与原因保留在对应 Chat session 历史中。

结果格式为 `liteasy.agent-artifact/v1`，包含论文标识、目标模态、回答、citation、分析结构、渲染 DSL 与 Agent run 标识，不包含 API key。结果可能含论文片段和用户问题，提交前仍需确认可共享性。团队共享流程：

```bash
git add project-docs/agent-results/*.json
git commit -m "docs: add agent analysis result"
git push
```

本地测试 API 配置 `project-docs/test-api.md` 已加入 `.gitignore`，不得与结果一起提交。

## 6. 权限与数据边界

### 6.1 信任顺序

```text
产品策略 / 用户权限
  > action registry schema 与 risk policy
  > 当前 workspace/selection revision
  > AgentCore 规则
  > 模型计划
  > 用户或外部 MCP 内容中的指令
```

论文正文、网页、MCP 返回和附件元数据都是不可信数据，不能提升工具权限或覆盖 system/policy。

### 6.2 能力暴露

`listCapabilities` 只返回 action ID、label、输入 schema、所需上下文、风险、确认、可逆性、预估延迟/费用。不返回：

- semantic planner 的 signals/ambiguity rules；
- inverse action 的内部调用细节；
- failure recovery prompt；
- 函数引用、账户 token、root path、memory 内容。

宿主可以按用户、组织、入口、feature flag 再做 capability 过滤；公共服务不能用 `consumer=mcp` 作为授权依据。

### 6.3 审计与隐私

当前本地快照会保存 `sessionId/runId/principalId/consumer`、run 输入和公共事件；这意味着用户问题与回答正文也会进入本机状态文件。Tauri 端限制文件为当前用户可读写，但它不是加密存储。API key、完整 AgentCore prompt、私有 memory、runtime 闭包和论文全文不会进入该快照。

进入团队共享、多用户或合规场景前，应增加按设置关闭正文持久化/字段脱敏、保留期清理、加密或系统密钥环封装，并将审计元数据与正文分表。不能把当前 `0600` 权限等同于内容加密。

## 7. 版本与兼容策略

- v1 内可增加可选字段和新事件；客户端必须容忍未知字段/事件。
- 删除字段、修改字段含义、变更状态机或错误语义时发布 `liteasy.agent/v2`。
- public DTO 与内部 runtime 类型分别维护，必须通过 mapper；禁止 `export type AgentEvent = AgentRuntimeEvent`。
- MCP tool 名在 v1 保持稳定；破坏性参数变化使用新 tool 名或新 server major version。
- CLI 默认 JSONL schema 跟随 API version，面向人的彩色输出以后以显式 `--format human` 增加。

## 8. 首版实现范围与后续工作

已实现：

- transport-neutral `AgentPublicApi v1`。
- 内存 session/run/idempotency/confirmation/event store，以及可替换 `AgentStateStore`。
- Tauri 应用数据目录原子 JSON 快照；浏览器开发环境 `localStorage` 兜底。
- active client session 重连、终态/等待态恢复、重启中断 run 的显式失败修复。
- 轻量多论文 AnalysisRun/Evidence/Claim 模型、逐篇公平配额、总证据预算、coverage gap 和取消检查。
- 多论文证据矩阵已接入 `qa/explain` 模型 prompt，分析结果通过公共 metadata 返回并进入状态快照。
- PDF.js 真实分页文本摄取、重叠切块、术语标注，以及相关性与全文区段兼顾的自适应证据覆盖。
- 单篇按连续页区段、多篇按论文的受控 SubAgent 并行分析，主 Agent 基于原始 evidence 复核综合。
- 单篇和多篇论文的模态选择均通过 frontend client 进入同一个公共 Agent API，不再生成定时器演示结果。
- dev-cloud 零新增依赖的产物 repository、`GET/POST /v1/agent-artifacts`、原子 JSON 落盘与启动恢复。
- 版本化结果写入 `project-docs/agent-results/`，可经人工检查后 Git 提交并由其他开发者查看。
- 真实 Agent 阶段进度事件、独立的 PDF/Agent 状态语义，以及可折叠的 parent-linked 树形可视化。
- 从结构化树稳定导出的 Markdown unordered-list 元数据；不再用制表符绘图。
- OpenAI Responses SSE → dev-cloud NDJSON → `assistant.delta` 的真流式链路，以及等待期临时 Markdown 树增量渲染。
- VSCode 风格单列递归文献树、独立 Reader 激活状态、论文下的关联产物/笔记子项。
- 按来源论文展示和切换历史产物，以及携带补充资料、保留来源快照的非覆盖式重生成。
- AgentCore before/after turn 接入。
- command、knowledge 与确认 executor ports。
- runtime event → stable public event 映射。
- `AbortSignal` 取消传播。
- 现有桌面 runtime/knowledge 的 composition factory。
- 前端 client、CLI JSONL adapter、MCP tool/resource adapter。
- `AssistantSidebar` 产品路径已通过 controller 注入 frontend client，不再直接编排普通 chat turn。
- MCP 2025-06-18 JSON-RPC host handler 与资源模板。
- Tauri Unix socket ↔ frontend bridge，以及 `--agent-cli` / `--agent-mcp` 可执行模式。
- 能力表安全裁剪。

尚未实现，按优先级排序：

1. 将 JSON 快照迁移到 SQLite 分表/WAL，加入 schema migration、保留期、查询索引、正文脱敏或加密；保持 `AgentStateStore` 契约不变。
2. Windows named pipe host，以及桌面退出时主动清理 Unix socket。
3. 如需网络 MCP，用官方 SDK 接入 Streamable HTTP，补 OAuth、Origin 防护和限流。
4. 将 AnalysisRun/Evidence/Claim 从 event metadata/版本化 JSON 迁入 SQLite 独立表，并接通 selection/document revision、ArtifactSource 与 PDF 页内文本范围；仓库 JSON 继续作为显式导出/协作格式。
5. 加入 per-principal capability filter、并发上限、事件保留和背压。
6. executor 在模型、解析、检索、批处理边界全面响应 `AbortSignal`。

首版刻意不做网络监听和任意远程工具接入。这两项会扩大攻击面，且不影响先稳定核心契约、前端迁移和测试。

## 9. 验收标准

1. 三种 adapter 对同一输入得到相同 run/status/event 语义。
2. 相同幂等键不会重复执行，不同输入复用同一键会失败。
3. 高风险 command 在批准前 action handler 不被调用；拒绝永不调用。
4. MCP/CLI 不能通过请求字段伪造 workspace readiness 或跳过确认。
5. session A 不能读取/确认/取消 session B 的 run。
6. cancel 后迟到的 executor 结果不能把 run 改回 completed。
7. 公共 capabilities/events 不含 prompt、memory、token 或内部函数数据。
8. Agent focused tests 与 `npm run build` 通过；仓库全量测试不得增加既有失败数。
9. 重启后相同稳定 `clientSessionId` 重连原 active session；幂等重试不重复执行。
10. 重启前为 `running` 的 run 被修复为 failed；pending confirmation 不自动执行且只能由所属 session 决定。
11. 模态任务只能在 Agent run 完成且结果 JSON 原子保存成功后显示 completed；应用重启后可恢复已保存产物。
12. PDF `parsed` 不得伪装成 Agent 完成；等待期必须显示真实阶段，树节点必须由结构化父子关系渲染。
13. 锁定多论文选择集后，打开任一论文 Reader 不得改变选择集；产物必须显示并持久化完整来源论文列表。
14. 重生成必须使用原产物论文快照、另存新结果并标记父产物；用户补充不得作为论文原始 evidence。
15. 深度分析至少覆盖论文前中后区段；SubAgent 失败必须可见，主 Agent 不得把缺失区段表述成已验证结论。

### 9.1 本地测试 API 启动

无需安装新依赖。在 `LiteasyClaw/desktop` 执行：

```bash
npm run dev:test-api
```

脚本只在进程内读取仓库根部 `project-docs/test-api.md`，将 `OPENAI_KEY`/`API_END_POINT` 映射为现有 dev-cloud 环境变量，不打印或复制密钥。当前实验默认模型为 `gpt-5.5`，可用 `VITE_LITEASY_OPENAI_MODEL` 覆盖。端口冲突时，现有 `dev-with-cloud.mjs` 会自动选择后续可用端口，并把实际 dev-cloud endpoint 注入 Vite；应以终端启动日志为准。

当前验证（2026-07-20）：`gpt-5.5` 真实 SSE 能力探测和 dev-cloud NDJSON 端到端请求均通过；一次 551 字实验在约 12.7 秒收到首批 delta，共收到 7 批、约 19.9 秒完成。严格 Markdown 树提示实验收到 47 批 delta、生成 174 个可增量解析的列表节点，且没有 tab/ASCII 树线。真实 PDF 摄取实测 ColBERT 10 页、60,518 字符，ACORN 15 页、92,529 字符。删除、取消、重复确认、证据索引/PDF 定位等本轮聚焦回归 61/61 通过；dev-cloud 6/6 测试文件与 `npm run build` 通过。全量桌面测试为 566/623 通过、57 个既有失败；其中主要是旧 Assistant UI contract 断言和受限环境 `listen EPERM`，本轮没有增加失败数。Rust `cargo check` 尚未完成：当前环境仅有 Cargo/Rust 1.75，无法解析仓库的 v4 lockfile，且未安装 `rustfmt`。
