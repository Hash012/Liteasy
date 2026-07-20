# LiteasyClaw 多论文分析 Agent 可行性与轻量化技术栈建议

> 日期：2026-07-19
> 依据：`project-docs/项目上下文与设计总览.md`、`project-docs/agent-dev/liteasy-agent-core-design.md`、`project-docs/agent-dev/Agent 开发指南：面向计算机专业学生.md` 与当前代码。
> 许可证结论是工程选型建议，不替代正式法律审查；发布前仍应锁定版本、生成 SBOM，并复核依赖、模型权重、示例数据和字体/图片等资产的许可证。

## 1. 结论先行

项目可行，而且现有 LiteasyClaw 已经具备约一半的正确骨架：选中文献集快照、锁定/导入心智、受控 action、计划校验、风险确认、任务/产物、引用类型、Agent Core 上下文和预算保护都可以复用。

真正缺失的不是另一个通用 Agent 框架，而是四块学术基础设施：

1. 真实 PDF 解析与稳定的页码/位置映射。
2. 本地持久化的文档、切块、全文索引和分析运行记录。
3. 从“问题”到“逐篇取证、跨篇归纳、矛盾检查、带引文输出”的有界工作流。
4. 一套能测检索召回、引用支持率、跨文献覆盖率和记忆污染的基准集。

最建议的首版不是自由循环的多 Agent，也不是一上来使用知识图谱或重型向量数据库，而是：

```text
现有 Tauri + React + TypeScript 工作台
  -> 现有 AgentCore / agent-runtime（继续作为唯一受控执行边界）
  -> Tauri/Rust 本地导入服务
       PDF.js 继续负责阅读渲染
       LiteParse 负责本地空间文本、页码与 bbox 提取
  -> SQLite + FTS5（文档、切块、任务、证据、产物、memory）
  -> 现有 Node dev-cloud 模型网关（OpenAI / DeepSeek，可替换）
  -> 单协调器、有界 map-reduce 多论文分析
```

首版不建议引入 LangChain、LlamaIndex、Letta、Mem0、LightRAG 或 GraphRAG 作为运行时依赖。它们适合研究和对照，但会重复现有 agent-runtime、引入 Python/服务部署或过早引入图结构。PaperQA2 最适合作为算法参考与离线基准，而非直接嵌入桌面产品。

## 2. 为什么这个方向适合当前项目

### 2.1 与现有边界对齐

当前代码已有：

- `selectionSnapshot`：可以把分析绑定到锁定的文献集合，而不是瞬时复选框。
- `agent-runtime`：已有结构化计划、action registry、policy、确认和事件。
- `agent-core`：已有 turn 前上下文、memory seam、预算与重复失败保护。
- `retrieval`：已有 `paperId + page + snippet` 引用模型，但仍是 demo 数据。
- `artifacts`：已有 comparison table、mindmap、PPT、tree 等产物类型，但缺少完整来源元数据。
- `pdfjs-dist`：已能显示 PDF，可继续承担阅读器，不必重写 UI。

因此应该纵向补齐“导入—检索—证据—分析”链路，而不是横向再搭一个不受 action/policy 管理的 Agent 系统。

### 2.2 书中实践记录能直接转化为工程约束

《从零到一造 Agent》整理出的实践对多论文分析尤其适用：

| 书中实践 | 在多论文 Agent 中的落地 |
| --- | --- |
| 概率模型放进确定性边界 | 模型只能选择分析动作与参数；解析、索引、证据绑定和状态变更由代码完成。 |
| 最大迭代/工具预算 | 对一次分析限定查询分解数、每篇候选数、总模型调用数和重试数。 |
| 纯工具并行、不纯工具串行 | 各论文检索与摘要可并行；SQLite 迁移、产物落盘和 memory 写入串行。 |
| 大工具输出卸载 | 完整解析结果和证据写 SQLite；模型上下文只放有定位的候选片段。 |
| VDB → DB → grep 降级 | 语义检索失败时回退 FTS5；FTS5 失败时回退页级精确扫描与人工选区。 |
| 记忆不是聊天记录 | 只记研究偏好、项目事实和用户确认结论；论文原文属于知识库，不属于 Agent memory。 |
| 工具错误必须给恢复指令 | 解析失败应说明失败页、可重试解析器、是否需要 OCR/人工选区，而不是继续生成。 |

### 2.3 单协调器比多 Agent 更适合 P0

多论文分析天然可以并行，但“并行”不等于需要多个自治 Agent。P0 使用一个协调器和若干确定性只读任务即可：

```text
校验选区与导入状态
  -> 生成比较维度/子问题
  -> 每篇论文独立取证（可并行，纯读）
  -> 跨论文证据矩阵归并
  -> 矛盾、缺失证据和覆盖率检查
  -> 生成带来源的回答或产物
```

只有当基准证明单上下文确实受限时，再增加隔离的“逐篇阅读 worker”。worker 只应拥有检索和返回结构化证据的权限，不应拥有递归委派、文件写入、memory 写入、网络上传或用户确认权限。

## 3. 建议的 P0 产品能力

首个可用版本只承诺三种输出：

1. 多论文问答：回答用户问题，并标明共同结论、分歧、未知项。
2. Related Work 比较表：问题、方法、数据集、指标、主要结果、局限，每个非空单元格都有证据。
3. 证据树/思维导图：节点引用一个或多个 claim，claim 再指向原文证据。

PPT 可以复用同一证据模型后再开放。不要让 PPT 生成走另一条无引用的快捷路径。

### 3.1 推荐运行流程

```text
1. Scope
   固化 selectionSnapshotId、workspaceRevision、documentRevision 和用户问题。

2. Import
   逐页解析，保存文本、页码、bbox、sectionPath、parserVersion、内容哈希。

3. Plan
   模型只输出有限 schema：分析类型、比较维度、子问题、预算。

4. Retrieve
   先按 namespace/权限/选中文献过滤，再用 FTS5；每篇保留最低配额，避免一篇论文垄断结果。

5. Evidence map
   对候选片段做相关性判断和上下文摘要，保留原始 quote 与定位；摘要不能替代 quote。

6. Reduce
   以证据为输入生成 claim、比较单元格、共同点、差异、矛盾和未知项。

7. Audit
   拒绝无 evidenceId 的事实性 claim；检查引用存在、页码有效、选区未漂移、覆盖文献数。

8. Persist and render
   保存 AnalysisRun、Evidence、Claim 和 ArtifactSource；UI 打开可取消、可恢复的 pending artifact tab。
```

### 3.2 最小数据模型

现有 `Citation` 只有 `paperId/page/snippet`，不足以支持审计。建议至少增加：

```ts
type DocumentRevision = {
  id: string;
  documentId: string;
  contentSha256: string;
  parser: string;
  parserVersion: string;
  createdAt: string;
};

type PaperChunk = {
  id: string;
  documentRevisionId: string;
  pageFrom: number;
  pageTo: number;
  bbox?: [number, number, number, number];
  sectionPath: string[];
  text: string;
  normalizedText: string;
};

type AnalysisRun = {
  id: string;
  selectionSnapshotId: string;
  query: string;
  planJson: unknown;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
};

type Evidence = {
  id: string;
  analysisRunId: string;
  chunkId: string;
  quote: string;
  relevance: number;
  retrievalReason: string;
};

type Claim = {
  id: string;
  analysisRunId: string;
  text: string;
  evidenceIds: string[];
  stance: "supported" | "contradicted" | "mixed" | "insufficient";
  confidence: number;
};
```

Artifact 应保存 `analysisRunId`、`selectionSnapshotId`、`claimIds`、模型/provider、prompt/skill 版本和生成时间。点击引用时由 `chunkId` 找到准确页码与 bbox，再让 PDF 阅读器定位。

## 4. 兜底策略

### 4.1 解析兜底

```text
LiteParse 空间文本提取
  -> PDF.js 页级文本提取
  -> 标记失败页并请求人工框选/确认
  -> 可选 Docling/GROBID 外部适配器（复杂版式或学术元数据）
```

- P0 仅保证 born-digital PDF；扫描件明确显示“需要 OCR”，不能静默输出低质量文本。
- 解析器必须可替换，统一输出 canonical `Page/Block/Chunk`，不能让 LiteParse/Docling 类型渗透到 feature 层。
- 导入保存内容哈希；文件变化后旧分析保持可查看，但标记来源 revision 已过期。

### 4.2 检索兜底

```text
FTS5 BM25 + 元数据过滤
  -> 精确短语/标题/section 搜索
  -> 页级线性扫描
  -> 用户 PDF 选区作为显式证据
```

P0 不依赖 embedding，这会让离线能力、调试、打包和许可证都更简单。有标注集且 FTS5 召回不足后，再加 `sqlite-vec` 与本地/远程 embedding，保留 FTS5 作为混合检索和降级路径。

### 4.3 模型与输出兜底

- provider 超时或额度不足：保留已取回证据，输出“证据清单/未完成分析”，允许恢复，不丢任务。
- 结构化输出校验失败：最多有限次数修复；仍失败则使用确定性比较表模板。
- 没有足够证据：输出 `insufficient`，不根据常识补写论文结论。
- citation auditor 失败：产物不能进入 `completed`，而进入 `needs_review` 或失败状态。

### 4.4 Memory 兜底

Memory 与论文索引使用不同表和检索入口。查询顺序必须先 namespace/权限过滤，再相关性排序。

- 自动候选只来自用户明确偏好、可信产品事件或用户确认的项目事实。
- 默认不保存论文原文、模型推断、API key、外部网页指令和组织私有内容。
- 写入前预览，支持拒绝、撤销、禁用、删除和来源追踪。
- embedding 不可用时使用 FTS5 + importance + freshness + workspace relevance。

## 5. 对四个提升设想的可行性判断

### 5.1 借鉴泄漏的 Claude Code 代码：不建议，风险高

Claude Code 主仓库的许可证是“© Anthropic PBC. All rights reserved”，使用受 Anthropic 商业条款约束，并非允许任意修改和商用的开源许可证。公开仓库不等于开源，更不能把泄漏代码作为产品源代码或测试夹具。

建议采用 clean-room 边界：

1. 不把泄漏代码复制、提交、训练或改写进 Liteasy 仓库。
2. 只研究 Anthropic 官方公开文档描述的概念与外部行为。
3. 为 Liteasy 独立写需求、schema、测试和实现，并保留设计来源记录。
4. 若团队成员已接触泄漏源码，在复用相近实现前做独立审查；必要时由未接触源码的人重写。

可以借鉴、且与 Liteasy 已有方向一致的公开模式包括：skill 与 subagent 分离、最小工具权限、`PreToolUse/PostToolUse` 生命周期、持久 memory scope、最大 turns、MCP allowlist 和隔离上下文。不要照搬 Claude Code 的 coding-agent 默认工具，因为论文 Agent 不应拥有 Bash、任意文件写入等能力。

注意：Anthropic 的 Python Agent SDK 当前为 MIT，但 TypeScript Agent SDK 当前仍是 Anthropic 保留全部权利。即便 SDK 许可可用，它也要求 Anthropic API/认证并默认围绕 Claude Code 工具集，不适合成为 Liteasy 的模型无关核心。

### 5.2 Claude Code 官方文档：高价值，适合借鉴契约

最值得吸收的是工程契约，而不是产品表面形态：

- [Subagents](https://code.claude.com/docs/en/sub-agents)：隔离上下文、工具 allowlist、maxTurns、memory scope。
- [Hooks](https://code.claude.com/docs/en/hooks)：工具调用前后、失败、停止和子代理生命周期的拦截点。
- [Permissions](https://code.claude.com/docs/en/permissions)：自然语言请求不能直接获得执行权限。
- [Skills](https://code.claude.com/docs/en/slash-commands)：可复用工作流与隔离 worker 的职责不同。
- [Memory](https://code.claude.com/docs/en/memory)：分层规则与可见配置。

映射到 Liteasy 时，应继续使用自己的 action registry、policy、confirmation 和 trace event，不要引入第二套权限系统。

### 5.3 与论文可视化师兄交流：高价值，但要转成数据

交流的目标不应只是“听方案”，而应获得可验证的用户任务和失败样本。建议用 45 分钟半结构化访谈：

1. 一次真实任务通常分析多少篇论文，输入来自本地 PDF、DOI 还是网页？
2. 最常用的比较维度是什么，哪些维度因学科不同而变化？
3. 可视化的最小可信单元是论文、段落、claim、实验还是图表？
4. 用户如何判断一个节点/表格单元格“有依据”？期望点击后跳到哪里？
5. 两篇论文结论冲突时，界面应显示什么，而不是简单平均？
6. 哪些 PDF 最容易解析失败：双栏、公式、表格、扫描、中文、补充材料？
7. 哪些产物真正会继续编辑或导出，哪些只是演示效果？
8. 从打开论文到得到可信结果，可接受的等待反馈和恢复方式是什么？

理想产出是：10–30 篇已获授权/可内部使用的匿名样本论文、20 个真实问题、期望证据页、3–5 个可视化草图和一份失败案例清单。若对方分享代码或数据，必须先确认仓库许可证、论文版权、数据授权与能否用于商业产品；没有明确授权时只记录需求和观察，不复制实现。

### 5.4 借鉴 Agent Memory 论文：可行，但先借原则后借框架

Memory 研究对 Liteasy 有价值，但论文分析的主要“记忆”其实是可追溯知识库和分析运行记录，不应全部塞进长期 Agent memory。

建议吸收：

- MemGPT：工作上下文与外部持久层分级，按需调入，而不是无限扩充 prompt。
- Mem0：抽取、合并、检索显著事实，并重视延迟和 token 成本。
- A-MEM：结构化 note、tag/link 和记忆演化，但所有演化应经用户治理。

暂不吸收：自主改写旧 memory、默认构建记忆图、跨 namespace 自动链接、保存完整对话。这些能力容易造成污染、隐私泄漏和难以解释的召回。

## 6. 最建议的轻量化技术栈

| 层 | 首选 | 原因 | 暂缓/备选 |
| --- | --- | --- | --- |
| 桌面 UI | 现有 Tauri 2 + React 18 + TypeScript | 已实现三栏、Dock、PDF、产物和助手，无迁移收益。 | 不迁移 Electron/Next.js。 |
| Agent 编排 | 现有 `agent-core` + `agent-runtime` + 注册 action | 已有预算、policy、确认和 fallback；最符合项目边界。 | 不引入 LangChain/LangGraph/LlamaIndex 核心。 |
| 工作流 | 有界状态机 + map-reduce；纯读步骤有限并发 | 可取消、可恢复、可审计，适合多论文。 | 基准证明需要时才加隔离 per-paper worker。 |
| PDF 阅读 | 现有 PDF.js | 已集成，Apache-2.0。 | 无。 |
| PDF 提取 | LiteParse Rust adapter，不默认打包 OCR | 本地、空间文本+bbox、与 Tauri/Rust 对齐，Apache-2.0。 | PDF.js 文本兜底；复杂版式用 Docling/GROBID 适配器。 |
| 本地数据 | Rust `rusqlite`（bundled SQLite）+ migrations | 单文件、事务、离线、易备份，适合桌面。 | 不上 PostgreSQL/Qdrant。 |
| 检索 P0 | SQLite FTS5/BM25 + section/page/namespace filter | 零额外服务、可解释、可降级。 | 精确扫描/人工选区。 |
| 检索 P2 | `sqlite-vec` + embedding adapter，与 FTS5 混排 | 仍保持单库；MIT/Apache-2.0；但当前 pre-v1，需锁版本。 | 远程 embedding 或 Transformers.js 小模型；先基准再加。 |
| 模型访问 | 扩展现有 Node provider registry | 已支持 OpenAI/DeepSeek、审计 seam 和 mock，改动最小。 | 可选 Ollama/llama.cpp adapter；模型权重另审。 |
| 元数据 | Crossref REST API + 本地缓存 | DOI/作者/年份等事实大多可自由复用；接口简单。 | OpenAlex 可作为后续补充，摘要版权单独处理。 |
| 结构校验 | 继续复用 TypeScript 类型 + JSON Schema validator | action registry 已有 schema，避免多引一个框架。 | 若 schema 数量快速增长，再评估 Zod。 |
| 评测 | Vitest/Node test + 自建 golden corpus | 与现有测试栈一致，能对 parser/retriever/auditor 分层测试。 | PaperQA2/LitQA2 作为外部对照。 |

### 为什么选择 LiteParse，而不是直接把 Docling/PaperQA2 带进产品

LiteParse 是较新的项目，必须做 spike，但其 Rust、本地运行、bbox 与页面截图能力非常贴合 Tauri 和引用跳转。P0 只使用 born-digital PDF 路径能保持包体与依赖可控。

Docling 的复杂 PDF、表格、公式、OCR 能力更强，但 Python/模型依赖会增加安装、打包、冷启动和跨平台维护成本。适合作为可选 sidecar 或云端解析 adapter，而不是首发必选依赖。

PaperQA2 已证明“检索—上下文摘要—引用回答—矛盾检测”方向有效，但它需要 Python 3.11+，有自己的 agent/index/cache 抽象，并默认接入多类外部服务。直接嵌入会和 Liteasy 的 selection snapshot、action、policy、artifact、trace 重叠。更合适的做法是借算法、提示词结构和评测方法。

## 7. 可修改并商用的论文、技术与仓库

下表只把宽松许可证或公有领域项目列为“推荐复用”。许可证按 2026-07-19 所见版本核验；实际引入时需检查固定 commit 与传递依赖。

### 7.1 论文分析与长文组织

| 项目/论文 | 可借鉴内容 | 代码许可证 | 建议 |
| --- | --- | --- | --- |
| [PaperQA2](https://github.com/Future-House/paper-qa)；[PaperQA](https://arxiv.org/abs/2312.07559)；[scientific synthesis](https://arxiv.org/abs/2409.13740) | 科学文献检索、片段相关性评估、带引用回答、矛盾检测、LitQA 评测。 | Apache-2.0 | 强烈参考；作为离线 baseline，P0 不直接依赖。 |
| [STORM](https://github.com/stanford-oval/storm)；[NAACL 论文](https://aclanthology.org/2024.naacl-long.347/) | 多视角问题生成、先研究/提纲后写作、长文引用组织。 | MIT | 借鉴“比较维度/视角—证据—提纲”流程。 |
| [Aviary](https://arxiv.org/abs/2412.21154) | 把科学 Agent 表达为有动作/观察与可评测环境的策略。 | 论文；相关实现需逐仓库核验 | 用于设计评测环境，不作为 P0 运行时。 |
| [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) | 长上下文中信息位置影响使用效果。 | 论文 | 支持“检索后小上下文合成”，不要把所有论文全文直接塞进 prompt。 |
| [STORM repository](https://github.com/stanford-oval/storm) | 可修改 pipeline interface 和 own-corpus retrieval。 | MIT | 仅借模块和评测思路。 |

### 7.2 文档解析与来源定位

| 仓库 | 能力 | 许可证 | 建议 |
| --- | --- | --- | --- |
| [run-llama/liteparse](https://github.com/run-llama/liteparse) | Rust/PDFium 空间文本、bbox、OCR 接口、页面截图。 | Apache-2.0 | 首选 spike；锁版本并测中英文/双栏/公式/表格。 |
| [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | PDF 渲染与文本读取。 | Apache-2.0 | 已使用；继续负责阅读器和解析兜底。 |
| [Docling](https://github.com/docling-project/docling) | 复杂 PDF、表格、公式、OCR、多格式、结构化 JSON/Markdown。 | MIT；模型各自核验 | 可选增强 adapter，不作为轻量 P0 强依赖。 |
| [GROBID](https://github.com/grobidOrg/grobid) | 学术 PDF 到 TEI XML、标题作者参考文献与结构。 | Apache-2.0 | 元数据/参考文献增强；Java 服务偏重。 |

MinerU 当前使用基于 Apache-2.0、带 MAU/收入阈值和在线归因义务的自定义许可证。它允许阈值内商用，但不是本方案优先采用的无附加条件宽松许可证；若未来采用，必须单独审查当时版本和模型依赖。

### 7.3 Memory 与检索

| 项目/论文 | 可借鉴内容 | 许可证 | 建议 |
| --- | --- | --- | --- |
| [MemGPT paper](https://arxiv.org/abs/2310.08560) / [Letta](https://github.com/letta-ai/letta) | 分层/虚拟上下文、持久 memory、显式 memory 工具。 | Letta Apache-2.0 | 借分层模型；不引入完整服务。 |
| [Mem0 paper](https://arxiv.org/abs/2504.19413) / [mem0](https://github.com/mem0ai/mem0) | 显著事实抽取、合并、检索，延迟/token 成本评测。 | Apache-2.0 | 借写入治理和评测；不自动保存聊天。 |
| [A-MEM paper](https://arxiv.org/abs/2502.12110) / [A-mem](https://github.com/agiresearch/A-mem) | Zettelkasten 式结构属性、link 与 memory evolution。 | MIT | P2 研究；旧记忆更新必须确认。 |
| [LightRAG](https://github.com/HKUDS/LightRAG) | 图增强的轻量 RAG 与混合查询。 | MIT | 数据规模/问题证明需要全局关系后再评估。 |
| [GraphRAG](https://github.com/microsoft/graphrag) | 社区摘要、local/global query。 | MIT | 作为大型 corpus 对照，不用于 P0。 |
| [SQLite](https://sqlite.org/copyright.html) | 本地事务数据库与 FTS5。 | 公有领域 | P0 核心。 |
| [sqlite-vec](https://github.com/asg017/sqlite-vec) | 单 SQLite 文件向量检索。 | MIT/Apache-2.0；pre-v1 | P2 可选，锁版本。 |
| [Transformers.js](https://github.com/huggingface/transformers.js) | 浏览器/JS 本地 ONNX embedding。 | Apache-2.0 | 可选；模型许可证和包体另审。 |
| [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3) | 多语言 dense/sparse/ColBERT embedding。 | MIT | 能力强但模型体积较大，不是默认轻量方案。 |

### 7.4 本地模型与元数据

| 项目/服务 | 许可证/数据权利 | 建议 |
| --- | --- | --- |
| [Ollama](https://github.com/ollama/ollama) | MIT；具体模型权重另审 | 可选本地 provider，不作为首发强依赖。 |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT；具体模型权重另审 | 更底层的本地推理备选。 |
| [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) | 书目事实通常不受版权限制，Crossref 生成数据 CC0；abstract 版权可能归出版方/作者 | P0 元数据首选；不要默认缓存/再发布 abstract。 |

## 8. 不建议的选型

1. 不使用泄漏 Claude Code 代码，也不把 Claude Code/TypeScript Agent SDK 当开源底座。
2. 不用通用 Agent 框架替换现有 runtime；这会制造两个 action/policy/trace 边界。
3. 不在 P0 引入 Qdrant、Elasticsearch、Neo4j、PostgreSQL 或 Kubernetes。
4. 不把所有论文全文放进长上下文；先检索、逐篇配额、证据压缩再综合。
5. 不把论文知识库、会话历史和用户长期 memory 混成同一个 vector collection。
6. 不让模型直接生成 React/CSS、SQL、文件路径或最终 citation；模型只返回 schema，定位由系统解析。
7. 不把 LLM judge 当唯一验收；必须有确定性的 citation/namespace/revision 校验和人工 golden set。

## 9. 分阶段落地与验收

### Phase A：技术 spike

- 选 20–30 篇中英文样本，覆盖双栏、公式、表格、扫描和补充材料。
- 比较 LiteParse 与现有 PDF.js 的页文本、阅读顺序、bbox、解析耗时和包体影响。
- 建立 SQLite migration，写入 document revision、page、chunk 与 FTS5。
- 做一个“输入问题 → FTS5 top-k → 点击跳页”的垂直切片。

退出条件：至少能客观说明哪些 PDF 可自动支持、哪些必须降级；不能只看 demo 成功样本。

### Phase B：可用 MVP

截至 2026-07-20，已先完成不依赖新三方库的应用层垂直切片：`AnalysisRun/Evidence/Claim` 类型、每篇独立排序、轮询证据配额、总证据预算、coverage gap、证据矩阵 prompt、取消边界和 Agent metadata 接线。它使用当前已导入的内存 `RetrievalChunk`，目的是先固定可测试的工作流契约；尚未宣称完成真实 PDF revision、SQLite/FTS5、ArtifactSource 或 citation bbox 跳转。

- 接通 `literature.compare` 与 `literature.summarize` registry。
- 实现 AnalysisRun 状态机、每篇取证、证据矩阵、citation auditor、取消/恢复。
- comparison table 每个事实单元格绑定 claim/evidence。
- artifact 保存 selection/document revision；文献变化时显示过期状态。
- memory 先只落地持久化、namespace、禁用/删除，不自动演化。

建议作为发布门的指标（是待验证目标，不是当前已达到 SLA）：

- golden query 的 retrieval Recall@20 ≥ 0.85。
- 有事实内容的 claim 绑定有效 evidence 的比例 = 100%。
- 人工抽检“引用确实支持 claim”的比例 ≥ 0.90。
- 选中文献覆盖率和缺失文献明确展示，不允许静默忽略。
- 跨 namespace 泄漏测试 = 0。
- 解析/模型失败后任务可恢复，已取证结果不丢失。

### Phase C：指标驱动增强

仅在基准显示问题后选择：

- FTS5 漏召回明显：增加 embedding adapter + sqlite-vec 混排。
- 复杂表格/扫描件占比高：增加 Docling sidecar 或 OCR adapter。
- 单协调器上下文不足：增加最小权限 per-paper worker。
- 大型文献库需要全局主题/关系问题：试验 LightRAG/GraphRAG，但与 claim/evidence 模型对接。
- 用户确实需要跨项目经验复用：试验确认式 memory consolidation/linking。

## 10. 最终建议

LiteasyClaw 应把“Agent”理解为受控的科研工作流协调器，把“多论文能力”建立在可复现的数据流水线上，而不是建立在更自由的模型循环上。

最优先的工程顺序是：

```text
LiteParse/PDF.js 真实解析
  -> SQLite + FTS5 + revision
  -> Evidence/Claim/ArtifactSource
  -> literature.compare 有界工作流
  -> citation 与人工 golden 评测
  -> 再决定 embedding、OCR、worker 和图检索
```

这套路线的优势是依赖少、离线优先、与 Tauri/Rust/TypeScript 现有技术栈一致，且首选组件都是公有领域、MIT 或 Apache-2.0。更重要的是，它保留了 Liteasy 最有价值的差异化：分析只针对显式锁定的文献快照，所有结论可回到原文，所有状态变更经过受控 action，失败时有清晰恢复路径。
