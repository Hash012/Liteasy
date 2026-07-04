# Generative UI / Intent-Driven UI Reference Notes

更新时间：2026-07-05

## 1. 本次处理结果

已读取：

- `BRAINSTORM/reference/reference.md`
- `BRAINSTORM/reference/reasoning-for-mobile-user-experience-with-multimodal-llms-2606.13192.pdf`

已下载到本目录：

- `reasoning-for-mobile-user-experience-with-multimodal-llms-2606.13192.pdf`

下载说明：

- `reference.md` 中明确列出的学术论文是 arXiv `2606.13192`，其 PDF 已下载。
- CopilotKit 仓库中另有一个 `generative-ui-guide.pdf`，属于指南 PDF，不是学术论文；尝试下载时速度异常慢，预计需要约半小时，已中止且删除无效残片。

访问过的链接：

- Vercel AI SDK: https://sdk.vercel.ai/docs
- Google Cloud Generative UI: https://cloud.google.com/discover/generative-ui
- CopilotKit Generative UI: https://github.com/CopilotKit/generative-ui
- Generative UI Spectrum: https://medium.com/@mail2mhossain/the-generative-ui-spectrum-controlled-declarative-and-open-ended-ai-interfaces-explained-2663335cdbdb
- Sngular Generative UI article: https://www.sngular.com/insights/475/generative-ui-ia-diynamic-interfaces
- Thesys Agentic AI vs Generative UI: https://www.thesys.dev/blogs/agentic-ai-vs-generative-ai
- arXiv paper page: https://arxiv.org/abs/2606.13192

访问限制：

- Vercel 页面成功抓取到本地临时 HTML。
- Google Cloud、GitHub、Medium 的直接 HTML 抓取连接长时间无响应，已中止；后续阅读以可访问页面摘要、`reference.md` 描述和公开页面结构为准。
- arXiv PDF 已完整下载并用 `pdftotext` 提取阅读。

## 2. 资源摘要

### 2.1 Vercel AI SDK

定位：

- 面向 TypeScript/React/Next/Vue/Svelte/Node 等生态的 AI 应用工具包。
- 对 Generative UI 有直接参考价值，尤其是 structured object streaming、tool calling、React Server Components 场景下的 `streamUI` 模式。

对架构的启发：

- 生成式 UI 不一定要让模型直接生成前端代码。
- 更稳妥的做法是让模型输出结构化对象或工具调用，由框架层将其映射到真实组件。
- 流式对象生成是降低 GenUI 延迟的关键技术路径。

可吸收到架构中的模块：

- `LLM Gateway`
- `Structured Output Adapter`
- `Streaming UI Parser`
- `Component Renderer`
- `Tool / Action Invocation`

### 2.2 Google Cloud: What is Generative UI?

定位：

- 工业界对 Generative UI 的定义型文章。
- 强调 AI agent 根据用户目标实时编排组件、数据和布局。

对架构的启发：

- Generative UI 的核心不是“生成网页”，而是“由 agent 编排界面”。
- 生产级系统应当使用固定组件库，而不是让模型生成任意视觉代码。
- 组件选择、数据绑定、布局变化要被放在可控协议里。

可吸收到架构中的模块：

- `Component Card`
- `UI DSL`
- `Dynamic Canvas`
- `DataSource Registry`
- `Policy-aware Agent Orchestration`

### 2.3 CopilotKit Generative UI

定位：

- 面向 Agentic UI 的开源生态。
- 重点在 agent 与前端应用之间的协议、状态共享和 UI 动态渲染。

对架构的启发：

- Agentic UI 需要协议，不是只靠 prompt。
- 应区分 agent 的推理状态、应用状态和 UI 渲染状态。
- A2UI、AG-UI、MCP Apps 等协议思路说明：未来生成式 UI 更可能通过“agent-app protocol”落地，而不是单个应用的私有 hack。

可吸收到架构中的模块：

- `Agent-UI Protocol`
- `Runtime Event Bus`
- `Application State Bridge`
- `Generative UI Renderer`
- `Tool Invocation Boundary`

### 2.4 The Generative UI Spectrum

定位：

- 从控制权角度分析 Generative UI 的文章。
- 关键问题是：到底谁拥有渲染决策权，开发者、声明式 schema，还是开放式 agent。

对架构的启发：

- 生成式 UI 可以分为控制式、声明式、开放式三个区间。
- 对真实产品而言，推荐从 controlled / declarative 开始。
- 完全开放式 UI 生成适合 demo 和探索，不适合高可靠产品核心路径。

可吸收到架构中的判断：

- MVP 应选择 `controlled declarative GenUI`。
- 不允许模型生成任意 DOM/CSS/JS。
- 用组件注册表、schema、layout solver 控制自由度。

### 2.5 Sngular: Generative UI

定位：

- 从软件架构角度解释 AI 不只是聊天框，而是编排层。

对架构的启发：

- 浏览器或客户端中，AI 应作为 orchestration layer，而不是视图层补丁。
- LLM 的概率性必须被 schema、校验器和状态机约束。
- UI 生成必须与状态管理、数据访问和动作权限绑定。

可吸收到架构中的模块：

- `Reasoning and Orchestration Layer`
- `Schema Validator`
- `State Bus`
- `Action Router`

### 2.6 Thesys: Agentic AI vs Generative AI vs Generative UI

定位：

- 概念区分型文章。
- 有助于区分 Agentic AI 和 Generative UI 在系统中的不同职责。

对架构的启发：

- Agentic AI 负责目标分解、计划和执行。
- Generative UI 负责让界面根据意图和状态自适应。
- 两者需要组合，但不能混为一层。

可吸收到架构中的关键设计：

- 双内核模型：
  - `Intent / Agent Runtime`
  - `Generative UI Runtime`

## 3. arXiv 论文阅读笔记

论文：

> Reasoning for Mobile User Experience with Multimodal LLMs: Task, Benchmark, and Approach

链接：

- https://arxiv.org/abs/2606.13192
- https://arxiv.org/pdf/2606.13192

本地 PDF：

- `BRAINSTORM/reference/reasoning-for-mobile-user-experience-with-multimodal-llms-2606.13192.pdf`

### 3.1 核心问题

论文指出，当前多模态大模型在 UI 领域的发展已经覆盖：

- 视觉元素定位。
- GUI agent。
- design-to-code。
- UI generation。
- intent-driven UI synthesis。
- emotion-aware interaction modeling。

但它们仍然缺少一种能力：从 UI 截图中推理真实用户体验问题。

论文强调，UX 问题不总是显性的视觉缺陷。很多问题来自：

- 设计惯例与用户心智模型不一致。
- 弹窗遮挡关键路径。
- 文案承诺与落地页内容不一致。
- 控件看似存在但实际不可用。
- 视觉上正确但交互上造成困惑。

这对 Intent-Native L-GUI 很关键：生成式 UI 不能只追求“能画出来”，还要能判断“这个 UI 是否会造成用户体验风险”。

### 3.2 UXBench

论文提出 UXBench：

- 2,000 个真实 UI 截图 VQA 样本。
- 用于评估 MLLM 的 UI-UX reasoning 能力。
- 覆盖真实移动应用场景。
- 经由 MLLM 辅助标注和资深 UX 专家人工验证。

三大 UX 维度：

1. Usability：操作和反馈是否清晰。
2. Efficiency：是否降低操作成本和认知成本。
3. Trustworthiness：内容、承诺、功能是否一致可信。

八个任务：

- `BubbleOcclT`：文字浮层遮挡页面文本。
- `BubbleOcclBtn`：文字浮层遮挡可点击元素。
- `PopupNoClose`：弹窗缺少明确关闭控件。
- `PopupBlockClose`：弹窗影响原生关闭按钮可点击。
- `PopupStack`：多个模态弹窗同时出现。
- `MismatchBadge`：徽标/推广内容与落地页不一致。
- `MismatchContent`：服务名与页面文本不一致。
- `MismatchFunc`：服务描述与页面功能不一致。

### 3.3 UI-UX 模型

论文提出 UI-UX：

- 基于 Qwen3-VL-4B-Thinking。
- 使用强化学习增强 UI reasoning。
- 引入 reward routing，在感知理解和逻辑推理之间动态平衡。
- 引入 asymmetric transition reward，抑制冗余或不足的推理步骤。

实验结果：

- UI-UX 在 UXBench 上达到 0.7963 平均准确率。
- 论文称其超过 Claude-4.5-Sonnet 的 0.6550。
- 小模型也能通过领域化训练超过更大通用模型。

### 3.4 对本架构的启发

1. 需要 `UX Validator`

生成式 UI 渲染后，不应只做 schema 校验，还应做体验校验：

- 是否有遮挡。
- 是否有无法关闭的弹窗。
- 是否同时出现多个模态层。
- 是否有不可达按钮。
- 是否有内容承诺不一致。
- 是否造成用户认知负担。

2. 需要把 UX 风险纳入 Policy Engine

高风险不只是删除数据。UI 本身也可能高风险：

- 隐藏确认按钮。
- 用视觉方式误导用户。
- 让关键退出入口不可见。
- 生成过度弹窗。

3. 需要视觉回归和多模态评测

Intent-Native L-GUI 的测试不应只测 JSON：

- 需要截图。
- 需要布局/遮挡检测。
- 需要可访问性检查。
- 需要 UX benchmark/golden cases。

4. 需要防止模型 overthinking

论文指出 reasoning 模型在 UXBench 上可能出现过长推理导致解析失败。对产品架构的启发：

- Planner 输出必须限长。
- DSL 生成必须限深。
- 推理链不要暴露为执行输入。
- 解析失败必须 fallback。

## 4. 对当前理论设计的修正建议

基于这些资料，应把架构从单纯的 `Intent Runtime` 扩展为双运行时：

```text
Intent Runtime
  - 意图理解
  - 计划生成
  - 能力调用
  - 权限裁决
  - 动作执行

Generative UI Runtime
  - UI DSL
  - Virtual UI Tree
  - Component Factory
  - Layout Solver
  - Design Tokens
  - Dynamic Canvas
```

同时增加两个质量关口：

```text
Schema Validator
  - 检查结构合法性
  - 检查组件和 action 是否注册

UX Validator
  - 检查遮挡、弹窗、可达性、认知负担、内容一致性
```

最稳妥的产品路线：

```text
Controlled GenUI
  -> Declarative GenUI
  -> Agentic UI Protocol
  -> Open-ended UI Exploration
```

不要一开始就做完全开放式 UI 生成。

## 5. 应纳入后续白皮书的关键词

- Generative UI
- Intent-Driven UI
- Agentic Application
- Controlled Generative UI
- Declarative Generative UI
- UI DSL
- Virtual UI Tree
- Dynamic Canvas
- Component Card
- Component Factory
- Design Tokens
- Layout Solver
- State Bus
- Action Router
- Policy Engine
- UX Validator
- Execution Journal
- Human-in-the-loop
- Streaming UI
- Structured Object Streaming
- Agent-UI Protocol
