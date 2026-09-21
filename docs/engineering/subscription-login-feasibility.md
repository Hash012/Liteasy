# ChatGPT 订阅接入 Liteasy：技术调研

调研日期：2026-09-21。分支：`feat/subscription-login`。
代码基线：Liteasy `9c8c09d0`；本地参考项目 `tmp/webcodex` 为 `3fdb1a9d`。
本次只调研，不修改业务实现，不登录用户账号、不读取凭据、不发起付费模型请求。

后续决策：用户选择“在 ChatGPT 中提问”的 MCP 路线，首期实现个人论文评论 Review。以下保留调研时的路线比较；实际实现与连接方式见 [Review MCP 说明](../../products/liteasy/services/review-mcp/README.md)。

## 结论

建议先验证 **Liteasy 桌面端托管 Codex App Server，用户通过 ChatGPT 登录，使用其可用的 Codex 权益**。它最贴合“在 Liteasy 内提问并生成文件”的目标。不是给现有 OpenAI API 请求换一个 token，也不能因此宣称 ChatGPT 订阅包含通用 API 余额。

WebCodex 的主要思路是反向连接：**用户在 ChatGPT 内提问，ChatGPT 通过 MCP 调用本机工具**。可借鉴其工具执行与文件交付设计，但这条路径本身不提供把网页对话变成 Liteasy 模型 API 的能力。

不建议以读取网页 Cookie、抓取 DOM 或调用未公开的网页内部接口作为首期方案。当前核查的官方资料没有建立这类接口作为第三方模型服务的支持契约；即使实验可用，登录、页面结构、响应格式和下载链接变化都需要自行维护。本次没有尝试这些路径，不能断言其完全不可实现。

## 官方支持与验证边界

- Codex 区分 ChatGPT 订阅登录和 API key 按量访问；账号和组织策略仍影响可用性。[Authentication](https://learn.chatgpt.com/docs/auth)
- App Server 面向自有产品集成，提供登录、会话、审批和流式事件。可通过 `account/login/start` 启动 ChatGPT 登录，读取账号及限额，并用 thread/turn 管理任务。默认 stdio；文档和本机 CLI 都有实验性标记，WebSocket 明确标为实验性且不支持生产工作负载。动态工具也是实验性接口。[App Server](https://learn.chatgpt.com/docs/app-server)
- 额度、模型和附加 credits 取决于实际套餐；API key 用量另按 API 定价，不承诺固定免费次数。[Pricing](https://learn.chatgpt.com/docs/pricing)
- 凭据可由 Codex 使用系统凭据库保存并自动刷新；默认共享缓存会使登录/退出相互影响。[Authentication](https://learn.chatgpt.com/docs/auth#login-caching)

本机只验证到 `codex-cli 0.154.0` 存在，且 `codex app-server --help` 支持 stdio、协议生成工具；尚未做登录、请求、限额扣减或跨平台实测。正式实现必须固定并验证一个 CLI 版本，不能仅依赖滚动更新的文档。

## 三条路线的区别

| 路线 | 提问位置 | 推理与执行 | 对 Liteasy 的适配 | 建议 |
| --- | --- | --- | --- | --- |
| 本地 Codex App Server | Liteasy | Codex 提供推理；业务写入由 Liteasy 控制 | 新增桌面连接和协议适配 | 首选验证 |
| WebCodex 式 MCP | ChatGPT | ChatGPT 调用 Liteasy 工具 | 增加远程可达的 MCP 接入、授权和工具 | 可作为独立入口 |
| 网页自动化/内部接口 | Liteasy 或嵌入网页 | 自行驱动网页并搬运响应 | 登录、抓取、流式文本、附件均需维护 | 暂不纳入主线 |

WebCodex 源码和文档证据：

- `tmp/webcodex/README.zh-CN.md` 与 `docs/MCP.zh-CN.md`：Server + Runner，ChatGPT custom app 连接 MCP；公网 HTTPS 或隧道解决可达性。
- `crates/webcodex-cli/src/webcodex_cli/connect/oauth.rs`：发现的是 WebCodex Server 的 OAuth 元数据。此 OAuth 授予客户端访问 WebCodex 的权限，不是给 WebCodex 发放 OpenAI 推理 API 凭据。
- `crates/webcodex-tool-contracts/src/tool_definition/artifacts.rs`：定义附件导入、产物写入和导出；文件字节通过宿主文件引用/传输路径交付，避免让模型搬运整个二进制文件的 Base64。
- `crates/webcodex-runner/src/webcodex_runner/artifacts/`：项目产物的 Runner 执行层，可参考路径、大小、摘要与写入边界。

这些证据说明其主接入方向；不等于审计并排除了该大型项目所有其他能力。参考项目是本地临时目录，以上路径不应成为 Liteasy 的构建依赖。

## 与现有体系的冲突

以下路径均相对仓库根目录。

| 现有边界与代码证据 | 直接接入会遇到的问题 | 建议处理 |
| --- | --- | --- |
| `products/liteasy/services/api/README.md`：OIDC/JWKS、introspection 和 `liteasy-desktop` token | ChatGPT 登录不能授权读取 Liteasy 文献、团队和 S3 数据 | Liteasy 业务登录与模型账号连接保持两个状态；不要将 ChatGPT token 送入业务 API |
| `features/settings/settings.types.ts`（桌面 `src/app/` 下）：只有 `cloud` / `direct` | 新连接不符合现有配置类型和校验 | 新增独立订阅连接模式，迁移默认值、持久化、设置 UI、错误状态 |
| `features/models/modelProviders.ts`：OpenAI/Anthropic HTTP 协议；`directModelTransport.ts`：Rust key 管理和 HTTP 调用 | OAuth、进程和 JSON-RPC 不能塞进 API key 输入框或 endpoint 字段 | Rust 管理子进程和登录；前端只接收状态、回答及事件 |
| `features/models/modelRuntime.ts` / `modelGateway.ts` | 当前是 prompt→answer/结构化输出，Codex 是有状态 Agent | 第一阶段尝试受限的模型适配；完整 Agent 模式另走执行端口 |
| `controllers/agent/createOpenAIAgentsSdkManager.ts` | 已有 Agents SDK Runner；其中 ExplicitRouteModel 是确定性路由桥，并非直接的 OpenAI 模型客户端 | 不把引入 SDK 当成已接入订阅；避免两套 Agent 循环重复规划和调用模型 |
| `features/agent-api/agentMcpAdapter.ts` | 现有五类工具以 session/turn/confirm/run/cancel 为主，`liteasy_agent_turn` 会再进入 Liteasy Agent | 不能原样作为 Codex 的完整业务工具集；需提供不触发二次模型调用的窄化读写操作 |
| `src-tauri/src/agent_host.rs` | 当前 external host 依赖 Unix socket；非 Unix 分支只报告不可用；响应有 120 秒超时 | Windows 需要真实传输；长任务需要异步任务句柄和取消，不能只延长超时 |
| `features/models/modelExecution.ts` | source/backend 只涵盖云代理和直连 API | 新增真实来源、错误、限额和审计投影；不得把订阅调用记成云代理或用虚构 token 数计费 |
| `controllers/useArtifactWorkflowController.ts`、`features/resource-filesystem/`、服务端 `agentArtifactRepository.mjs` | Codex 磁盘文件不会自动成为 Liteasy 可编辑、可同步的业务对象 | 产物校验→入库/导入→返回业务资源 ID；磁盘落盘只是其中一步 |
| 服务端模型与可视化生成链路 | 桌面换连接不自动替换后台生成任务所用模型 | 第一阶段明确能力范围；后台任务不得偷偷回退到付费 API 或要求桌面常在线 |

此外，当前模型策略存在远程端点信任和模型白名单校验。新模式应有自己的能力策略，并明确组织是否允许个人订阅处理组织文献；不能因切换连接方式而绕过已有组织数据权限。

## 建议的实现顺序

### 第一阶段：登录、回答、结构化产物的最小验证

建议链路：

```text
Liteasy UI → controller → 订阅模型适配器 → Tauri Rust → 本地 Codex App Server
                         ↓ 返回文本/结构化结果
                 现有业务校验与产物持久化
```

1. Rust 持有 stdio 子进程、请求关联、事件转发和退出清理。连接能力放入 feature，跨模块编排放 controller，AppShell 仅组合。
2. 为 Liteasy 子进程设置独立数据目录和子进程级 `CODEX_HOME`，避免更改用户现有 CLI/IDE 登录、配置、MCP 和会话。验证系统 keyring 是否也按该目录隔离，不只隔离文件路径；不改当前执行环境的 `CODEX_HOME`。
3. 在系统浏览器完成 Codex 管理的登录。前端保存连接状态，不保存 OAuth token；不复制现有 `~/.codex/auth.json`。系统凭据库不可用时明确失败或采用经设计的替代，不无声降级。
4. 以受限模式适配 `generateAnswer`：只返回回答或结构化数据，禁用不需要的执行工具，现有 Liteasy runtime 负责业务动作。必须验证所选版本能真正约束工具权限及输出 schema，不能只写提示词要求“不执行”。
5. 问答流复用已有 `onDelta`；AbortSignal 映射到 Codex 任务中断，断线后核对任务状态，不盲目重发。隔离并发请求，不让不同文献、用户或 session 共用一个有污染风险的 thread。
6. 先选择一个文本产物：根据选中文献生成 Markdown/大纲，校验后通过现有资源链路保存、重新打开和导出。PPTX/PDF 等格式再逐项评估转换器、依赖和失败恢复。

该阶段的优点是保留现有产品行为，主要验证“订阅能否充当当前生成能力”。风险是 Codex 的 Agent 语义与多次短小模型调用可能不匹配，延迟、上下文重复和额度消耗需要实际测量。若无法满足结构化输出及权限约束，不强行伪装成普通 HTTP provider。

### 第二阶段：需要完整工具执行时接入 Codex runtime

在 `controllers/agent/agentApplicationService.ts` 的执行端口接入独立实现，将 Liteasy session/run 对应到 Codex thread/turn；保留 Liteasy 的业务上下文、幂等和事件持久化。

只暴露经过授权的原子能力，例如读取指定文献摘录、查询资源、提交产物草稿。可以验证本地 MCP 工具桥，或经固定版本验证的动态工具接口。不要暴露会重新启动同一 Agent 的 `liteasy_agent_turn`，也不要让模型通过 `liteasy_agent_confirm` 自行批准原本应由用户确认的操作。

文件生成优先返回业务 schema 或写入专用暂存区；导入时检查路径、大小、类型、引用和版本冲突。数据库、对象存储内部目录不能作为 Codex 可任意编辑的工作区。将工具确认、取消和失败事件映射到现有交互，明确以哪一层为最终执行授权者。

### 可选：ChatGPT 网页作为独立入口

若接受用户在 ChatGPT 内提问，可另建 Liteasy MCP 接入，参考 WebCodex 的 Server/Runner、异步任务、文件导入导出思路。现有本机 socket 不能直接被 hosted ChatGPT 访问，需要认证过的远程桥或隧道；具体 ChatGPT 客户端权限需另行验证。

这能实现“ChatGPT 操作 Liteasy 并生成资源”，但不自动实现“Liteasy 发起网页对话并镜像全部回答”。如果需要把结果显示在 Liteasy，可设计显式提交回答/产物的工具；它同步的是工具提交内容，不是对整个网页会话的透明访问。

## 开发前后的验收条件

- 固定 CLI 版本后生成并检查协议类型；验证登录、取消登录、退出、过期刷新和重启恢复。
- 使用真实测试账号确认请求走订阅路径、所选模型实际可用、限额读取与耗尽错误正确；不得靠测试替身宣称额度已打通。
- 回答支持流式、取消、并发隔离和子进程异常恢复；中断后不能后台继续写文件或重复创建产物。
- 产物能保存、重启后打开、导出；重复回调和断线恢复不重复入库。
- 确认不读取用户原有 Codex 凭据，不把 token 写到前端、日志、同步数据或仓库；退出 Liteasy 的模型连接不影响现有 CLI。
- 以 Windows/macOS/Linux 实测子进程打包、签名、浏览器回调、凭据库和可用的文件权限隔离。
- 覆盖新增适配器和状态边界的相关测试，桌面改动后运行 `npm run build`；现有云代理和自备 API 模式回归。

当前完成的是代码与官方文档调研，未完成上述端到端验收。建议下一步实施第一阶段验证，再根据结构化输出、延迟、额度和工具约束的实测结果决定是否升级为完整 Codex runtime。
