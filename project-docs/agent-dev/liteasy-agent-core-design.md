---
doc_type: implementation-design
source: Agent 开发指南：面向计算机专业学生.md
target: LiteasyClaw desktop
created: 2026-07-16
---

# Liteasy Agent 核心设计与实现方案

Liteasy 当前已经有 `agent-runtime`，它负责把用户意图转成语义动作计划，再交给动作注册表执行。这个运行时适合“指令式 UI 操作”和“生成产物”，但还不是完整 Agent 核心：它缺少可配置的系统指令、技能清单、插件/MCP 工具接入、长期记忆、循环预算、工具错误防护和用户可见的治理面。

因此，Liteasy 的 Agent 核心不应该重写现有 runtime，而应该在它外面增加一层 `agent-core`：

1. `agent-core` 负责 Agent 的长期配置、上下文治理、工具/skill/plugin/MCP 注册、memory 注入和循环防护。
2. `agent-runtime` 继续负责把一次用户输入规划成可执行动作，并执行已有能力。
3. `assistant` 继续负责对话 UI、确认、人机交互和流式反馈。
4. `settings` 提供 Agent 可见治理面，让用户能看见和管理 agent.md、skills、plugins、MCP 与 memory。

## 1. Liteasy 的 Agent 定位

Liteasy 是一个面向文献阅读、知识库、学术画像、组织资料区和多模态产物生成的桌面工作台。因此 Agent 核心的第一阶段目标不是开放任意 shell，而是做“学术工作台代理”：

1. 理解用户意图：解释文献、生成摘要/脑图/卡片、整理选中文献集、移动工作区布局、同步云端资料。
2. 利用上下文：选中文献、导入状态、组织空间、用户画像、当前设置、已有产物。
3. 调用受控能力：只通过注册动作、技能、插件和 MCP server 执行外部操作。
4. 管理记忆：保存用户偏好、研究方向、项目事实和组织约束，但不保存原始密钥或高风险指令。
5. 可审计可降级：每次工具调用、计划、上下文压缩和安全拦截都应该能追踪。

## 2. 推荐模块边界

建议新增前端模块：

```text
LiteasyClaw/desktop/src/app/features/agent-core/
  agentCoreConfig.ts
  AgentSettingsPanel.tsx
```

后续落地完整核心时，再扩展为：

```text
agent-core/
  coreLoop.ts
  agentCoreConfig.ts
  agentMd.ts
  skillCatalog.ts
  pluginCatalog.ts
  mcpCatalog.ts
  memoryStore.ts
  memoryRetriever.ts
  contextAssembler.ts
  observationCompressor.ts
  toolRegistry.ts
  toolExecutor.ts
  budgetGuard.ts
  safetyPolicy.ts
  traceLog.ts
```

当前实现已经提供配置模型、设置 UI 和 turn 级 `AgentCoreSession`。它不会替代现有 `agent-runtime`，而是在每轮运行前装配 agent.md、memory、capability、budget 上下文，在每轮运行后记录观察、失败和预算状态。

## 3. Agent 核心运行路径

完整路径应为：

```text
用户输入
  -> AssistantPane
  -> AgentCore.prepareTurn()
       读取 agent.md
       加载 skill/plugin/MCP 能力摘要
       检索长期 memory
       汇总文献/组织/画像上下文
       应用预算和安全策略
  -> agent-runtime.runAgentRuntime()
       语义规划
       契约校验
       策略评估
       动作执行
  -> AgentCore.observeTurn()
       记录 trace
       压缩旧观察
       提取候选 memory
       更新失败计数和预算
  -> Assistant UI 输出
```

这样设计的好处是：现有动作系统不用推倒重来，Agent 核心只增强“每一轮进入 runtime 前后”的上下文、预算、工具治理和记忆。

## 4. agent.md

`agent.md` 是 Liteasy Agent 的系统级行为说明，建议包含：

1. 身份：Liteasy 学术工作台 Agent。
2. 任务边界：文献理解、知识组织、产物生成、布局/设置操作、云端同步辅助。
3. 禁止事项：不读取密钥、不绕过确认、不删除资料、不把组织资料发往外部。
4. 输出风格：中文优先，给出可执行下一步，解释不确定性。
5. 工具使用原则：优先使用专用动作和文献检索能力，不直接模拟不可用工具。

第一阶段可以把 `agent.md` 作为只读默认配置展示在设置页。后续再支持用户编辑、版本号和回滚。

## 5. Skill 管理

Skill 是 Liteasy 内置能力的语义封装。当前项目已有 `settings.adjust`、`artifact.generate`、`organization.open_shared_library` 等技能雏形。

建议第一批 skill：

1. `literature.summarize`：基于选中文献生成摘要。
2. `literature.compare`：比较多篇文献的问题、方法、数据和结论。
3. `artifact.generate`：生成脑图、卡片、笔记等产物。
4. `workspace.organize`：调整布局、打开面板、移动 dock item。
5. `settings.adjust`：修改低风险设置项。
6. `organization.open_shared_library`：打开组织资料区。

Skill 条目应包含：

1. id
2. 名称
3. 什么时候使用
4. 所需上下文
5. 风险等级
6. 是否启用

## 6. Plugin 管理

Plugin 是第三方或本地扩展能力，适合承载独立功能包，例如引用格式化、PDF OCR、Zotero 导入、BibTeX 处理等。

第一阶段不必真正安装插件，但设置页应该展示治理模型：

1. 插件来源：内置、本地目录、组织下发。
2. 权限：读文献、写产物、访问网络、访问组织空间。
3. 状态：已启用、未启用、需要审核。
4. 风险说明：插件不能直接获得密钥；高风险动作需要确认。

## 7. MCP 管理

MCP server 负责把外部工具以标准协议接入 Agent。Liteasy 适合优先接：

1. `local-library`：本地文献库、PDF、Markdown 笔记。
2. `citation-tools`：BibTeX、CSL、DOI 查询。
3. `web-research`：可审计的网页搜索和抓取。
4. `organization-space`：组织资料区检索和同步。

每个 MCP 条目应显示：

1. server id
2. 提供的工具数
3. 连接状态
4. 权限范围
5. 是否允许写操作

## 8. Memory 管理

Liteasy 的 memory 不应保存完整聊天记录，而是保存长期有用事实：

1. 用户偏好：语言、输出结构、是否偏好表格/脑图。
2. 学术画像：研究方向、常用方法、关注领域。
3. 项目事实：当前课题、文献集目标、组织资料区约束。
4. 经历记忆：上次分析过哪些文献、生成过哪些产物。

Memory 条目应支持：

1. 类型
2. 重要性
3. 最后访问时间
4. 来源
5. 命名空间
6. 删除或禁用

安全要求：写入 memory 前必须扫描提示词注入和越权指令；多用户或组织场景必须先做 namespace 过滤，再做相关性评分。

## 9. 循环预算与安全默认值

Liteasy 第一版 Agent 核心建议采用保守默认值：

1. 最大迭代：12 轮。
2. 最大工具调用：32 次。
3. 重复失败阈值：2 次。
4. 连续格式错误回滚：最多 3 次。
5. 大输出溢出：8,000 字符，保留 1,500 字符预览。
6. 最近工具结果保护：2 条。
7. 旧观察压缩：保留错误行、状态行、关键 JSON 字段。
8. 高风险动作：删除、覆盖、云端上传、组织资料写入都需要确认。

## 10. 前端设置页实现

当前设置页只有“云端模型能力”和“文献元数据同步”。本次实现新增 `AgentSettingsPanel`，展示：

1. Agent 核心状态。
2. agent.md 配置摘要。
3. skill 条目。
4. plugin 条目。
5. MCP server 条目。
6. memory 条目。
7. 预算和安全策略。

这个面板先使用静态默认配置，目的是把产品架构和治理面立起来。后续可以把 `agentCoreConfig.ts` 替换成 store、SQLite 或云端同步配置。

## 11. 分阶段落地

### P0：设置面与配置模型

1. 新增 `agent-core` 配置模型。
2. 设置页展示 agent.md、skills、plugins、MCP、memory。
3. 测试覆盖可见治理项。

### P1：AgentCore.prepareTurn

1. 从配置模型生成系统上下文。
2. 把 skill/plugin/MCP 摘要加入 planner context。
3. 把 memory 摘要注入 `AgentRuntimeContextView` 或扩展 planner context。

### P2：预算和观察压缩

1. 为每轮 runtime 调用记录 trace。
2. 增加工具调用预算和重复失败计数。
3. 对历史观察做压缩。

### P3：长期记忆

1. 本地 SQLite 或 Tauri sidecar 存储 memory。
2. 支持新增、禁用、删除、按 namespace 检索。
3. 增加提示词注入扫描。

### P4：MCP 与插件

1. 接入本地 MCP server registry。
2. 插件权限声明。
3. 高风险工具确认。

## 12. 验收标准

1. 设置页能清楚显示 Agent 的核心配置面。
2. 用户能知道 Agent 读了什么 system prompt、有哪些 skill/plugin/MCP、记住了什么。
3. 当前 `agent-runtime` 边界不被破坏。
4. 后续核心循环可以自然接入现有 AssistantPane。
5. 高风险能力默认不可静默执行。

## 13. 当前实现状态

已完成：

1. `agentCoreConfig.ts`：定义默认 agent.md、skills、plugins、MCP、memory、预算和安全策略。
2. `agentMd.ts`：从配置生成 Liteasy Agent 的系统契约。
3. `memoryStore.ts`：提供轻量内存 memory store 和 keyword + importance 混合检索。
4. `contextAssembler.ts`：把 agent.md、runtime context、memory、capability、budget 拼成分区化上下文。
5. `budgetGuard.ts`：实现最大迭代、最大工具调用、重复失败拦截和旧观察压缩。
6. `agentCoreSession.ts`：提供 `prepareTurn`、`observeRuntimeTurn`、`observeKnowledgeTurn`。
7. `AssistantPane`：命令模式和问答/解释模式都已接入 AgentCoreSession。
8. `modelSemanticPlanner`：命令规划 prompt 已包含 Agent 核心上下文。
9. `generateAssistantAnswer`：问答/解释 prompt 已包含 Agent 核心上下文。

仍待后续实现：

1. 将 memory store 从前端内存迁移到 SQLite/Tauri 持久化。
2. 支持用户编辑 agent.md，并提供版本、回滚和安全校验。
3. 接入真实 MCP server registry。
4. 给 plugin 增加权限声明、安装状态和审核流程。
5. 把观察日志展示到调试面板或审计 UI。
