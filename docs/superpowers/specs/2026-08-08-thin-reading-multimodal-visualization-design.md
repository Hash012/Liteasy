# 薄读多模态可视化与原论文插图深化设计

## 1. 摘要

本文定义 Liteasy 薄读正文中的多模态可视化、原论文图片插入、对象选择深化、内置 Skill 运行时、管理员权限和加权额度体系。

系统在薄读节点中保持固定顺序：

```text
生成可视化
薄读正文
原论文图片与证据
```

生成可视化不是每个节点的必需产物。有权限用户默认允许多模态并持久化个人选择；关闭后绝不生成。开启只表示允许系统判断。必要性不足、证据不足、模态不匹配或正确性校验失败时，系统降级为更可靠的静态模态、原论文图片，或不生成。

本设计采用内部 typed runtime，并选择性移植或重实现 EduLab、SchemaTex、stem-illustration-skill 和 ink-graph 的有效思想。四个项目不成为 Liteasy 运行时通信依赖。所有用户点名的模态都必须具有 typed spec、受信 renderer、确定性或受界 kernel、证据要求、校验器、观察型交互、fallback 和生产验收样例，不能只注册类型名称。

本文是实施设计，不表示相关能力已经完成生产验收。

## 2. 目标

1. 在薄读正文上方插入必要且可靠的生成可视化，在正文下方插入最多两张原论文图片。
2. 支持流程图、思维导图、电路和物理绘图、神经元连接和生物结构图、可交互平面几何、立体几何、函数图像、物理过程动画、化学过程动画及可扩展的后续模态。
3. 支持从生成图语义对象、原论文整图和原图矩形区域继续深入。
4. 将模型限制为产生 typed spec，不允许模型直接生成生产 SVG、HTML、脚本或任意 DOM。
5. 用领域 kernel、证据绑定和多层 validator 保证可核验的正确性边界。
6. 将 Skill 升级为完整的内置工作流包，同时保持 Action 为权限、额度和副作用边界。
7. 由部署管理员配置 provider/API，管理用户授权、模态白名单和每用户加权额度。
8. 保持本项目自主、模块化、可裁剪和按需加载，不依赖四个参考项目的在线服务。
9. 保持普通用户界面极简，不展示 provider、kernel、计算单元、内部版本或开发说明。

## 3. 非目标

- 首版不支持用户或管理员从远程仓库任意安装 Skill。
- 首版不承诺任意 CAD/EDA、分子动力学、量子化学计算或无证据的精细解剖重建。
- 不把元素守恒、拓扑合法或几何可解错误地描述为完整科学正确性。
- 不开放图形自由编辑、节点拖拽改义、方程改写或模拟器参数越权输入。
- 不把生成插图作为论文事实证据或伪装成原论文图片。
- 不让桌面端接触 provider 密钥、额度结算权限或管理员审计明细。
- 不让 Liteasy 正式服务依赖 `development/dev-cloud/`，也不让 Intuecho API 共享 Liteasy 的数据库连接池或凭据。

## 4. 已确认的产品规则

### 4.1 生成数量

- 系统自动判断生成时，每个薄读节点最多一个生成 artifact。
- 用户明确请求生成时，每个薄读节点最多两个生成 artifact。
- 每个节点最多推荐并插入两张原论文图片。
- 证据不足时不为了填满数量而补造内容。

### 4.2 用户开关

- 用户有权限时，首次授权默认开启。
- 用户选择服务端持久化，跨设备恢复。
- 用户关闭后，生成规划器、provider 和生成 renderer 路径均不得产生新的生成 artifact。
- 用户无权限时显示关闭状态且不可切换。
- 开启只代表允许自动判断，不代表每个节点都要生成。
- 该开关只控制生成可视化。论文原图是来源证据，不调用生成 provider；关闭生成或没有生成权限时，原图仍可按图片推荐规则显示并深化。

### 4.3 交互边界

允许的观察型交互包括缩放、平移、旋转、播放、暂停、单步、参数滑块、显隐、高亮、标注查看、对象选择和点击深化。

不允许在阅读 artifact 内自由编辑科学结构。用户希望改变参数、对象或表达方式时，应产生新的明确请求并重新通过证据、权限、额度和正确性门。

### 4.4 可靠性回退

系统按以下顺序处理失败：

1. 对首选 typed spec 最多进行一次受限修复。
2. 降级为更可靠的静态模态。
3. 使用有证据绑定的原论文图片。
4. 不生成多模态，只保留正文。

自动判断未生成时不打扰正文。用户明确请求但未生成时，界面只显示极短状态；详细原因按需展开。完整原因写入内部诊断和审计。

## 5. 现状与迁移基线

Liteasy 当前已经具备以下基础：

- MinerU 图片提取、分析、证据绑定和最多两张图片推荐。
- 薄读节点、递归深入和原文证据映射。
- `ArtifactWorkflowHarness` 和 mindmap verifier 的基础形态。
- `skillRegistry`、`actionRegistry` 和 Agent Core 配置。
- React Flow、D3、Chevrotain、KaTeX、Mermaid 和 Zod。
- 管理控制面的管理员、MFA、角色、append-only audit、revision 和 idempotency 事务模式。

当前需要替换或迁移的行为：

- 原论文图片目前按句内联，新协议改为节点正文下方的独立证据区。
- Mermaid 和模型生成的 HTML demo 位于正文后方，新协议不再生成这两类任意内容。
- 图片目前带有忽略选择标记，新协议允许整图和矩形区域深化。
- 当前 HTML sandbox 禁止脚本，不能承担真实交互动画；新交互由 typed renderer 承担。
- Mermaid 仅用于旧节点只读兼容，不再作为新薄读节点的事实来源。
- Three.js 作为 3D renderer 的独立懒加载依赖加入，不进入首屏公共包。

新生成节点使用 `liteasy.thin-reading/v2`。现有 `v1` 节点只读兼容，不原地改写用户已有 artifact。

## 6. 总体架构

### 6.1 分层

```text
ThinReadingAgent
  -> VisualizationIntent
  -> VisualizationDecisionService
  -> VisualizationWorkflowHarness
       -> Builtin Skill
       -> Domain Kernel
       -> Validator Pipeline
       -> Trusted Renderer
  -> VisualizationArtifactV1
  -> ThinReadingNode v2

Server Action Boundary
  -> entitlement
  -> user preference
  -> quota reservation
  -> provider invocation
  -> settlement / rollback
  -> append-only audit
```

职责定义：

- `Skill`：从证据和意图生成受约束 spec 的工作流。
- `Renderer`：把已验证 spec 投影成 SVG、Canvas 或 WebGL，不决定科学事实。
- `Kernel`：执行确定性计算、受界模拟和领域不变量检查。
- `Validator`：组合 schema、证据、领域、布局、安全和可访问性检查。
- `Action`：控制权限、额度、provider 调用、持久化和其他副作用。

依赖方向保持 `layout -> controllers -> features -> shared types / clients`。`ThinReadingTab` 只渲染和发出用户意图；跨模块编排进入 controller；feature 不导入 layout 或 `AppShell`。

桌面 controller 可以执行不产生副作用的本地预判，以减少无效请求，但不能据此授予权限或扣减额度。`products/liteasy/services/api/` 必须在每次 provider 调用和 artifact 提交前执行权威授权、预留和策略检查。桌面 renderer 只消费服务端已验证并按客户端契约投影的 artifact。

### 6.2 运行流程

1. 服务端读取 entitlement、用户开关、剩余额度、允许模态和并发限制。
2. 薄读主规划器在正文计划旁生成紧凑的 `VisualizationIntent`。
3. 决策服务检查解释增益、冗余、证据充分性、模态匹配和成本上限。
4. 不需要生成时立即结束，不调用 provider、不消耗额度、不加载 renderer。
5. 需要生成时，服务端按模态上限预留加权计算单元。
6. `VisualizationWorkflowHarness` 渐进加载内置 Skill，生成 typed spec。
7. validator pipeline 检查 schema、证据、领域、布局、安全和可访问性。
8. 失败时最多修复一次，然后执行模态 fallback。
9. 校验通过后原子持久化节点、artifact、usage 和 audit。
10. 按实际消耗结算，失败、取消或超时则回滚预留。

正文生成不等待可视化。只有决策门通过后才创建固定尺寸的顶部占位并异步生成，从而避免可视化延迟阻塞正文或完成后造成明显布局跳动。

## 7. 核心数据契约

### 7.1 模态联合类型

```ts
type VisualizationModality =
  | "semantic_graph"
  | "circuit"
  | "physics_diagram"
  | "biology_structure"
  | "geometry_2d"
  | "function_plot"
  | "geometry_3d"
  | "physics_process"
  | "reaction_process"
  | "raster_illustration"
  | "source_figure";

type GeneratedVisualizationModality = Exclude<VisualizationModality, "source_figure">;
```

`semantic_graph` 使用 subtype 区分 `flowchart`、`mindmap`、`causal_graph` 和 `timeline`。`source_figure` 使用相同 artifact 和深化基础设施，但不属于生成权限控制的模态。后续模态通过版本化 discriminated union 扩展，不允许未注册字符串进入 renderer。

### 7.2 VisualizationIntent

```ts
type VisualizationIntentV1 = {
  nodeId: string;
  purpose: "explain_structure" | "compare" | "show_process" | "show_geometry" | "show_evidence";
  candidateModalities: GeneratedVisualizationModality[];
  evidenceIds: string[];
  requestedBy: "automatic" | "explicit_user_request";
  expectedLearningGain: "low" | "medium" | "high";
};
```

主规划器只输出紧凑 intent，不直接输出绘图代码或完整 artifact。

### 7.3 VisualizationArtifactV1

```ts
type VisualizationArtifactV1 = {
  artifactId: string;
  nodeId: string;
  modality: VisualizationModality;
  artifactVersion: "liteasy.visualization/v1";
  implementation: {
    skillId: string;
    skillVersion: string;
    rendererId: string;
    rendererVersion: string;
    kernelId?: string;
    kernelVersion?: string;
  };
  spec: VisualizationSpecV1;
  evidenceBindings: EvidenceBindingV1[];
  semanticObjects: SemanticObjectV1[];
  interaction: InteractionContractV1;
  validation: ValidationReportV1;
  fallbackHistory: FallbackRecordV1[];
  usage: UsageRecordLinkV1;
  createdAt: string;
};
```

服务端规范记录保留完整 implementation、validation 和 usage 关联。普通用户客户端只接收渲染所需字段和最小来源状态；provider、成本和内部诊断只投影给管理员或开发诊断权限。

`spec` 是严格的 discriminated union：

```ts
type VisualizationSpecV1 =
  | { modality: "semantic_graph"; payload: SemanticGraphSpecV1 }
  | { modality: "circuit"; payload: CircuitSpecV1 }
  | { modality: "physics_diagram"; payload: PhysicsDiagramSpecV1 }
  | { modality: "biology_structure"; payload: BiologyStructureSpecV1 }
  | { modality: "geometry_2d"; payload: Geometry2DSpecV1 }
  | { modality: "function_plot"; payload: FunctionPlotSpecV1 }
  | { modality: "geometry_3d"; payload: Geometry3DSpecV1 }
  | { modality: "physics_process"; payload: PhysicsProcessSpecV1 }
  | { modality: "reaction_process"; payload: ReactionProcessSpecV1 }
  | { modality: "raster_illustration"; payload: RasterIllustrationSpecV1 }
  | { modality: "source_figure"; payload: SourceFigureRefV1 };
```

`artifact.modality` 必须等于 `artifact.spec.modality`，否则 schema 校验失败。

```ts
type InteractionContractV1 = {
  pan: boolean;
  zoom: boolean;
  rotate: boolean;
  playback: "none" | "timeline" | "stepwise";
  parameterIds: string[];
  selectableObjectIds: string[];
};

type ValidationReportV1 = {
  outcome: "pass" | "degraded" | "fail";
  checks: Array<{
    validatorId: string;
    validatorVersion: string;
    outcome: "pass" | "warning" | "fail";
    diagnosticCode?: string;
  }>;
  repairCount: 0 | 1;
};

type FallbackRecordV1 = {
  from: VisualizationModality;
  to?: VisualizationModality;
  reasonCode: string;
};

type UsageRecordLinkV1 = {
  ledgerId: string;
  reservationId: string;
  providerRouteId: string;
  costPolicyVersion: string;
  reservedUnits: number;
  settledUnits: number;
};
```

`UsageRecordLinkV1` 是服务端和管理员投影字段。普通用户客户端只保留不可逆的 artifact 状态，不接收 provider route 或单位值。`fail` 报告不能进入可见 artifact；`degraded` 只表示 fallback 产物自身已经通过全部硬门。

### 7.4 证据和语义对象

```ts
type EvidenceBindingV1 = {
  claimId: string;
  evidenceIds: string[];
  sourceFigureId?: string;
  sourceRegion?: NormalizedBoundingBox;
  confidence: "direct" | "derived" | "contextual";
};

type NormalizedBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SemanticObjectV1 = {
  objectId: string;
  kind: string;
  label: string;
  objectPath: string[];
  evidenceClaimIds: string[];
  selectable: boolean;
};
```

`derived` 只用于 kernel 可复算的推导结果。不能把模型猜测标记为推导证据。

`NormalizedBoundingBox` 的四个值都使用左上角原点和 `[0, 1]` 范围，并满足 `x + width <= 1`、`y + height <= 1`、`width > 0`、`height > 0`。

### 7.5 深化目标

```ts
type DeepDiveTargetV1 =
  | {
      kind: "generated_object";
      nodeId: string;
      artifactId: string;
      objectId: string;
      objectPath: string[];
      evidenceClaimIds: string[];
      viewport?: ViewportSnapshot;
    }
  | {
      kind: "source_figure";
      nodeId: string;
      sourceFigureId: string;
      evidenceIds: string[];
    }
  | {
      kind: "source_region";
      nodeId: string;
      sourceFigureId: string;
      bbox: NormalizedBoundingBox;
      sourcePixelSize: { width: number; height: number };
      evidenceIds: string[];
    };
```

矩形区域坐标归一化到原始图片，不依赖当前缩放、设备像素比或 CSS 尺寸。超出边界、面积过小、图片身份不匹配或缺少可关联证据时拒绝深化。

## 8. 模态能力设计

### 8.1 语义图

`SemanticGraphSpecV1` 表示节点、typed edge、组、层级、时间顺序和证据命题，覆盖流程图、思维导图、因果图和时间线。

- Renderer：可信 SVG 和 React Flow 交互投影。
- Kernel：树/DAG 约束、循环检测、时间顺序、稳定布局、路由和碰撞诊断。
- 证据：每个内容节点和事实边必须绑定命题证据；纯组织边必须明确为布局关系。
- 交互：缩放、平移、折叠、聚焦、高亮和对象深化。
- 回退：复杂交互图 -> 分组静态图 -> 结构化列表。

### 8.2 电路与物理绘图

`CircuitSpecV1` 表示元件、端口、网络、导线、参数和测量点。`PhysicsDiagramSpecV1` 表示物体、矢量、光线、约束、标注和装置关系。

- Renderer：从受控专业符号库构建的安全 SVG。
- Kernel：网络连通、端口合法性、适用时的 KCL/KVL、量纲、矢量和几何约束。
- 证据：元件、数值、方向和装置关系分别绑定来源。
- 交互：高亮支路、端口、矢量和光路，查看量值，选择对象深化。
- 回退：可验证子电路或简化物理图 -> 原论文图。

KCL/KVL 通过只证明电路拓扑和给定量值满足对应约束，不证明器件模型或实验设定完整正确。

### 8.3 生物结构和神经连接

`BiologyStructureSpecV1` 表示结构、区域、层级、连接、方向、标签、受控本体 ID 和证据置信度。

- Renderer：分层 SVG，超大连接图可使用 Canvas 投影。
- Kernel：本体引用、连接端点、拓扑一致性、方向和标签绑定检查。
- 证据：结构、连接和标签逐项绑定；无法从论文证据支持的精细结构不得生成。
- 交互：显隐、聚焦、连接高亮、标注查看和对象深化。
- 回退：证据型结构简图 -> 带区域标注的原论文图。

### 8.4 平面几何和函数图像

`Geometry2DSpecV1` 表示点、线、圆、曲线、区域、约束和构造关系。`FunctionPlotSpecV1` 表示表达式 AST、定义域、参数、坐标轴、关键点和辅助曲线。

- Renderer：SVG 或 Canvas。
- Kernel：解析几何求解、约束检查、表达式解析、受界采样、奇点检测和关键性质复核。
- 证据：论文给出的表达式、条件和参数绑定来源；kernel 生成的采样点标记为可复算派生值。
- 交互：缩放、平移、参数滑块、轨迹、切线、高亮和对象深化。
- 回退：固定参数静态图 -> 公式和关键点表。

### 8.5 立体几何

`Geometry3DSpecV1` 表示点、线、面、实体、网格、约束、剖切、投影和相机提示。

- Renderer：按需加载 Three.js，不允许模型提供 shader、脚本或资源 URL。
- Kernel：向量和矩阵计算、相交、共面、法向、网格完整性和退化检测。
- 证据：输入条件绑定论文或用户问题；所有几何派生量可由 kernel 重算。
- 交互：旋转、缩放、平移、显隐、剖切滑块和对象拾取。
- 回退：交互 3D -> kernel 计算的多视图 2D。

### 8.6 物理过程动画

`PhysicsProcessSpecV1` 表示状态、参数、方程、事件、时间轴、不变量和误差阈值。

- Renderer：Canvas 或 WebGL 时间投影。
- Kernel：解析解优先；无解析解时采用受界数值积分、单位检查、守恒量和累计误差检查。
- 证据：方程、边界条件、初始条件和事件分别绑定。
- 交互：播放、暂停、单步、时间滑块、允许范围内的参数滑块和轨迹高亮。
- 回退：动画 -> 关键帧序列 -> 静态状态图。

数值积分通过只证明在指定模型和误差阈值内的数值一致性，不证明论文模型本身描述了真实世界的全部因素。

### 8.7 化学过程动画

`ReactionProcessSpecV1` 表示物种、化学式、计量数、atom map、步骤、条件、状态和证据类型。

- Renderer：SVG 或 Canvas 时间轴。
- Kernel：化学式解析、方程配平、元素守恒、电荷守恒和 atom map 完整性。
- 证据：反应物、产物、条件和每个机理步骤分别绑定。论文只给总反应时不得补造机理。
- 交互：播放、暂停、单步、物种高亮、条件查看和对象深化。
- 回退：有证据的机理动画 -> 守恒可验的反应级动画 -> 配平方程与状态序列。

### 8.8 栅格插图和原论文图片

`RasterIllustrationSpecV1` 表示 Visual Schema、构图约束、标签、风格锁和证据命题。`SourceFigureRefV1` 表示原图身份、页码、图注、区域、提取信息和来源证据。

- Renderer：经过格式和资源检查的位图，以及可信的区域覆盖层。
- Kernel/Validator：prompt 完整性、标签/OCR 复核、区域合法性、来源身份和完整性检查。
- 证据：生成图中的科学标签仍必须绑定 typed spec 和原始证据；生成像素本身不能成为事实证据。
- 交互：缩放、平移、标签高亮、整图选择、矩形区域选择和深化。
- 回退：生成图失败 -> 原论文图片；原图不足 -> 纯正文。

科学关系适合 typed vector renderer 时，优先使用矢量模态。栅格生成用于确有解释增益的场景，不用来绕过领域校验。

## 9. 内置 Skill 系统

### 9.1 包结构

V1 只加载部署内置 Skill。每个 Skill 包包含：

```text
skill.json
instructions.md
schemas/
templates/
validators/
fixtures/
```

`skill.json` 至少声明：

- `id`、`version` 和兼容的 runtime version。
- 支持的 modality 和 typed input/output schema。
- `evidenceRequirements`。
- `validatorIds`。
- `rendererId` 和可选 `kernelId`。
- `fallbackModalities`。
- `integrityRules` 和 `styleLock`。
- 成本等级、超时和资源上限。

Skill 不能直接访问密钥、数据库或任意网络。需要副作用时必须调用注册 Action，并由服务端重新检查授权和额度。

### 9.2 注册与加载

- 启动时只加载 manifest 和能力摘要。
- 规划器根据 intent 获取紧凑能力目录。
- 决定模态后才加载具体 instructions、schema、模板和 validators。
- Skill、Renderer 和 Kernel 版本写入 artifact，保证重绘和回归可追踪。
- 同一输入和版本的确定性阶段必须产生稳定结果。
- V1 不提供远程安装、动态执行下载代码或运行第三方脚本的入口。

### 9.3 与现有 Agent 融合

- 现有 `skillRegistry` 升级为 built-in package catalog，不继续停留在 Action 的薄名称映射。
- `ArtifactWorkflowHarness` 泛化为 `VisualizationWorkflowHarness`，保留阶段事件、诊断和 verifier 插槽。
- `actionRegistry` 继续作为可信副作用边界。
- `thinReadingAgent` 负责正文计划和 `VisualizationIntent`，不承担 provider 调用或渲染。
- 模态能力摘要进入 Agent Core 的渐进上下文；具体 Skill 仅在选中后加载，避免 prompt 和依赖膨胀。

## 10. 四个上游项目的吸收策略

审计基线：

- EduLab：`059a302`
- SchemaTex：`e8b792b`
- stem-illustration-skill：`80bc2bb`
- ink-graph：`d144ce8`

### 10.1 stem-illustration-skill

已逐项审计其 24 个 JSON 模板。它们本质上是 prompt 预设，不是可证明正确性的 validator。

吸收：

- 模态 taxonomy。
- Visual Schema 到 Prompt 的两阶段结构。
- 九段 prompt 组织方式。
- 风格锁和学术诚信边界。

重构为 `VisualizationTemplateRegistry`，每个模板增加 `renderStrategy`、`evidenceRequirements`、`validatorIds`、`fallbackModalities`、`integrityRules` 和 `styleLock`。

不采用：

- 同步/异步 HTTP wrapper。
- 未真正实现的 KEGG、UniProt、IUPAC 或 ISO 校验声明。
- 错误的 Garfield 几何样例。

### 10.2 EduLab

审计确认其实际范围为解析几何、立体几何和化学反应三个 Skill。

吸收：

- typed spec 和单一数据源。
- 确定性 kernel。
- 明确的交互状态。
- 方程配平和 atom map 思路。

不采用：

- CDN HTML、`innerHTML` 和动态 `Function`。
- Python sidecar。
- 有限题型硬编码作为通用能力。
- 仅探测 RDKit 可用性却没有真实 SMILES 到构象链路的实现。

化学低层守恒只作为基础门，不被描述成价态、机理或能量正确性证明。

### 10.3 SchemaTex

审计范围包括 52 个公开类型和 50 个引擎目录。其 DSL/AST、布局、diagnostics、source range、scene metadata 和专业符号体系具有较高复用价值，但不能整包引入。

吸收：

- DSL/AST 分层。
- 布局诊断和 scene metadata。
- 专业符号及按模态裁剪的 adapter。
- 可定位错误的 source range 思路。

重实现要求：

- 重建或严格净化 SVG builder。
- 所有标签、引脚和属性转义。
- 移除外部资源、事件属性和脚本。
- 将 fishbone 等路径中的 `Math.random()` 替换为稳定布局或 artifact seed。

不整包 vendor 根共享块，不把通过现有测试等同于 Liteasy 的安全和领域验收。

### 10.4 ink-graph

其 npm `main` 指向 `SKILL.md`，不是可直接加载的运行时 renderer。

吸收：

- Graph JSON。
- 图类型选择优先级。
- 路由、碰撞和失败案例规则。
- 克制动画原则。

不采用：

- 模型直接生成生产 SVG。
- 只检查 XML、重复 ID 和 fragment URL 的 `validate_svg.py` 作为完整 validator。
- 不避开中间节点的 fallback layout。

### 10.5 自主性和许可证边界

Liteasy 只选择性移植许可证允许且质量合格的最小代码片段；其余部分根据公开思想和已确认契约在项目内重实现。任何引入的代码、资源或字体都必须完成来源记录和许可证审查。生产运行不调用四个项目的远程服务，也不要求安装其仓库。

## 11. 用户界面和正文排布

### 11.1 极简原则

普通用户界面不显示以下内容：

- provider、模型和密钥信息。
- Kernel、Renderer、Skill、schema 或内部版本。
- reservation、weighted units 或结算细节。
- 开发状态、实现说明或内部诊断正文。

阅读页只保留：

- 一个有可访问名称和 Tooltip 的多模态图标或开关。
- 必要的短状态。
- `生成` 与 `论文原图` 的来源区分。
- 用户主动展开时的简短未生成原因。

管理员控制面显示完成配置任务所需的字段和表格，详细 provider、成本和审计信息进入高级区域。

### 11.2 节点布局

节点布局固定为：

1. 生成可视化区域。
2. 薄读正文。
3. 原论文图片和证据区。

不把原图继续嵌入单句，不把生成图和原图放在同一来源层，不使用卡片嵌套。桌面端保持单列阅读宽度；移动端仍保持相同顺序。固定比例、最小高度和稳定 grid 轨道用于避免加载状态改变布局。

### 11.3 选择和深入

- 生成图通过 `semanticObjects` 提供可信 hit target。
- 原图点击可选择整图。
- 原图允许拖拽矩形区域，覆盖层只表示选择，不修改原图。
- 三类选择都投影成 `DeepDiveTargetV1`，复用当前节点证据和 Agent 深入流程。
- 新的深入节点重新经过权限、开关、必要性、额度和校验门。
- 键盘用户可以聚焦语义对象、整图和已有区域；区域选择提供等价的键盘入口。

## 12. 管理员、权限和额度

### 12.1 管理角色

V1 中只有 `deployment_admin` 能：

- 配置 provider endpoint、模型路由、能力和 `secretRef`。
- 启用或停用 provider。
- 配置全局模态成本表和总预算。
- 为用户授予或撤销多模态权限。
- 配置用户模态白名单、日/月额度和并发数。
- 查看 usage ledger 和审计。

V1 不引入可委派额度管理员角色。

### 12.2 密钥

- 数据库只保存 `secretRef` 和非敏感 provider 元数据。
- 密钥值由部署环境或 Secret Store adapter 保存。
- 管理控制面可选择或更新 `secretRef`；Secret Store 支持写入时，凭据设置使用独立的一次性服务端动作。
- 桌面端、capability 响应、artifact 和普通日志不得包含密钥。
- provider 调用只在 Liteasy 正式服务边界内发生。

### 12.3 Capability 投影

`/v1/account/capabilities` 扩展为：

```ts
type MultimodalVisualizationCapability = {
  allowed: boolean;
  enabled: boolean;
  explicitRequestsAllowed: boolean;
  allowedModalities: GeneratedVisualizationModality[];
  quota: {
    available: boolean;
    remainingBand: "none" | "low" | "available";
  };
  limits: {
    automaticArtifactsPerNode: 1;
    explicitArtifactsPerNode: 2;
    sourceFiguresPerNode: 2;
  };
};
```

普通客户端只收到是否可用和粗粒度额度状态，不收到内部成本明细。管理员 API 返回精确单位和 ledger。

`remainingBand` 由日额度和月额度中更紧张的一项决定：剩余为零时是 `none`，剩余比例大于零且不超过 10% 时是 `low`，其余为 `available`。客户端提示不构成授权，服务端仍以实时 reservation 结果为准。

### 12.4 管理 API

- `GET/PUT /v1/admin/visualization/providers`
- `GET/PUT /v1/admin/visualization/entitlements/:userId`
- `GET/PUT /v1/admin/visualization/quota-policies`
- `GET /v1/admin/visualization/usage`
- `GET /v1/admin/visualization/audit`
- `PUT /v1/account/preferences/multimodal-visualization`

所有变更使用 revision、idempotency key、MFA 和 append-only audit。撤权对新请求即时生效，运行中的请求在提交前再次校验；撤权后未提交产物取消并回滚预留。

### 12.5 加权计算单元

默认成本表作为可版本化种子：

| 模态 | 默认单位 |
| --- | ---: |
| 语义图 | 1 |
| 平面几何 | 1 |
| 函数图像 | 1 |
| 电路图 | 2 |
| 物理绘图 | 2 |
| 生物结构图 | 2 |
| 立体几何 | 3 |
| 物理过程动画 | 4 |
| 化学过程动画 | 4 |
| 栅格插图 | 8 |
| 已提取原论文图片 | 0 |

部署管理员可以改变未来请求使用的成本表。历史 ledger 保留成本表版本，不按新表重算。

一次调用执行：

```text
estimate -> reserve -> generate -> validate -> settle
                                      -> rollback
```

- 预留值使用当前模态、provider、最大修复次数和 artifact 数量的上界。
- 成功后按实际 provider 调用和资源消耗结算，但不能超过未经追加授权的预留上限。
- 需要追加预留时必须在下一次调用前完成，并写审计。
- 失败、取消、超时、撤权和未通过校验均释放未使用预留。
- 同部署、同权限边界内的有效缓存复用不产生 provider 生成单位，但写入 `cache_reuse` ledger 事件。

## 13. 服务端持久化

正式 Liteasy API 增加独立领域表或等价仓储：

- `visualization_provider_configs`
- `visualization_entitlements`
- `visualization_user_preferences`
- `visualization_quota_policies`
- `visualization_quota_reservations`
- `visualization_usage_ledger`
- `visualization_artifacts`

关键约束：

- reservation 有唯一 idempotency key、过期时间和状态机。
- usage ledger append-only，不覆盖历史事件。
- artifact 和 settled usage 在同一业务事务或 outbox 保证的一致提交边界内完成。
- artifact 只在 `ready` 或明确的 `degraded` 成功状态下对客户端可见。
- 图片对象存储键、内容哈希和数据库身份一致。
- Liteasy 与 Intuecho 继续使用独立业务数据库和凭据。

`development/dev-cloud/` 只提供本地真实开发 API，不提供演示账号或 mock 业务结果。正式实现位于 `products/liteasy/services/api/`；开发适配器不得被生产服务导入。

## 14. 安全设计

### 14.1 不可信输入

以下内容均视为不可信：

- 模型产生的 intent 和 spec。
- 论文文本、OCR、图注、标签和图片元数据。
- 上游项目的 SVG 字符串和模板。
- 用户选择区域、参数和提示。

所有 spec 必须通过 JSON Schema 或 Zod discriminated union，再进入 kernel 和 renderer。

### 14.2 SVG、Canvas 和 WebGL

- SVG 由可信 builder 创建，所有文字和属性转义。
- 禁止 `<script>`、事件属性、`foreignObject`、外部 URL、外部字体、外部样式和不受控 fragment reference。
- Canvas 接收已验证 display list，不执行模型代码。
- Three.js 只接收 typed geometry、material allowlist 和相机参数，不接收自定义 shader 或任意资源地址。
- renderer 使用 CSP、资源上限和独立错误边界。

### 14.3 图片

- 验证 MIME、魔数、解码结果、尺寸、像素量和文件大小。
- 去除不需要的元数据，不信任扩展名。
- 原图保留 paper/page/figure/caption/content hash 来源链。
- 生成图具有明确来源类型，不能写入 `SourceFigureRefV1`。

### 14.4 数据最小化

发给外部 provider 的内容限制为完成任务所需的证据片段、结构化输入和脱敏元数据。默认不发送整篇论文。每个 provider route 声明允许的数据类别，Action 在调用前执行策略检查。

## 15. 性能和资源控制

- 禁用或无需生成路径不调用 provider，不加载模态 renderer，不创建 artifact 任务。
- Skill 启动时只加载 manifest；具体 instructions、schema 和模板渐进加载。
- 3D、动画和重型专业 renderer 独立 code split，并在 artifact 进入视口或用户展开时加载。
- 折叠或离屏 artifact 使用静态预览，展开后再激活交互 renderer。
- artifact 缓存键至少包含部署/租户边界、证据哈希、spec、locale、Skill、Kernel 和 Renderer 版本。
- 不跨租户复用包含论文内容的 artifact。
- spec、图片、对象数、动画帧率、模拟步数、执行时长和内存均设置硬上限。
- 初始桌面 JavaScript 压缩体积相对基线增加不超过 120 KiB；Three.js 不计入首屏包，只存在于懒加载 chunk。
- artifact JSON 可用后，静态 renderer 首次呈现目标为 p95 250 ms 内。
- 交互目标为基准设备稳定 50 FPS，低配置基线不低于 30 FPS。

## 16. 状态机和失败恢复

```text
planned -> reserved -> generating -> validating -> ready
              |             |            |
              +-----------> cancelled    +-> degraded
              +-----------> omitted
```

- 每次任务使用稳定 idempotency key。
- provider 超时、桌面断线和进程退出不自动重复创建计费调用。
- 服务端可根据 reservation 和 provider invocation 状态恢复、结算或回滚。
- 校验失败最多执行一次受限修复。
- fallback 历史记录原始模态、失败门、修复结果和最终选择。
- 正文持久化独立于可视化成功，生成失败不得删除已成功正文。
- 动画必须提供暂停和单步，并尊重 reduced motion。
- 未知版本或缺少 renderer 时显示静态预览；没有安全预览时隐藏 artifact，正文继续可读。

普通用户只看到极短状态。完整错误进入开发诊断、管理员审计和 `ValidationReportV1`。

## 17. 测试与验收

### 17.1 每种模态的硬门

每个点名模态必须拥有：

1. 正常生产样例。
2. 应拒绝生成的证据不足样例。
3. 首选模态失败后的 fallback 样例。
4. 可交互行为样例。
5. 桌面端和移动端视觉基准。
6. 键盘、可访问名称和 reduced motion 验收。

验收重点：

- 语义图：节点、边、方向、DAG/树约束、路由和碰撞。
- 电路/物理图：元件、端口、连通、适用的 KCL/KVL、单位、矢量和几何。
- 生物结构图：本体、标签、连接、方向和逐项证据，无臆造精细结构。
- 平面几何/函数：约束、定义域、奇点、交点、参数变化和参考数值。
- 立体几何：相交、共面、剖切、投影、网格和对象拾取。
- 物理过程：确定性、单位、不变量、守恒量和数值误差。
- 化学过程：化学式、计量数、元素/电荷守恒、atom map 和机理证据。
- 栅格/原图：来源身份、OCR 标签、页码、图注、矩形坐标和生成/原图区分。

### 17.2 横向测试

- Schema、Skill、Kernel、Renderer、Validator 和 Action 单元测试。
- 图结构、几何、守恒和数值计算的性质测试与黄金样例。
- SVG 注入、图片炸弹、恶意标签、资源上限和 CSP 测试。
- 权限、开关、白名单、并发、撤权即时生效和越权测试。
- 额度 estimate、reservation、追加、settlement、rollback、过期和幂等重试测试。
- 生成图对象、原图整图和原图矩形区域三种深化路径。
- 正文顺序始终为“生成可视化 -> 正文 -> 原论文图片”。
- 禁用或无需生成时零 provider 调用、零生成额度、零重型 renderer 加载。
- `v1` 只读兼容，`v2` 不生成任意 HTML。
- 浏览器和桌面视觉验收检查像素非空、构图、裁剪、遮挡和响应式布局。

### 17.3 评测指标

- 确定性领域校验、安全校验和来源身份校验必须 100% 通过。
- 未绑定证据的科学标签、连接或机理一律失败。
- 专家标注路由集上的模态选择准确率目标不低于 90%。
- 专家标注路由集上的不必要生成率目标不高于 5%。
- 性能指标满足第 15 节预算。

自动测试使用确定性 fixtures 和 provider 边界替身，不向 `dev-cloud` 注入 mock 业务结果。真实 provider 最终冒烟测试使用部署管理员临时提供的测试配置，密钥写入本地未提交 Secret Store 或环境配置，不进入仓库、快照和测试输出。

## 18. 实施工作流和完成定义

实施计划应拆分为可独立验收的工作流，但共享本规格的数据契约和质量门：

1. Runtime 契约、内置 Skill package、workflow harness 和 validator pipeline。
2. 服务端 provider、entitlement、偏好、额度、ledger 和管理员 API。
3. 薄读 v2 数据迁移、布局、原图选择和三种深化目标。
4. 语义图、电路/物理图、生物结构图 renderer 和 kernel。
5. 平面几何、函数图像和立体几何 renderer 和 kernel。
6. 物理过程、化学过程和栅格插图 renderer、kernel 和 provider route。
7. 管理员 Fluent 2 控制面。
8. 跨模态评测、性能、安全和真实 provider 冒烟验证。

内部可以按工作流逐步实现和集成，但不能把只有 schema 占位或演示 fixture 的模态声明为完成。面向用户启用某模态前，该模态必须通过第 17 节全部硬门。整个首版完成的定义是用户点名的全部模态均存在真实生产路径和验收样例。

## 19. 关键实现位置

预期主要影响：

- `products/liteasy/apps/desktop/src/app/features/thin-reading/`
- `products/liteasy/apps/desktop/src/app/controllers/`
- `products/liteasy/apps/desktop/src/app/features/skills/`
- `products/liteasy/apps/desktop/src/app/features/artifact-workflow/`
- `products/liteasy/apps/desktop/src/app/features/agent-core/`
- `products/liteasy/apps/admin/`
- `products/liteasy/services/api/`
- `platform/identity-service/`

生产服务不得导入 `development/`。`AppShell` 只组合 UI；跨模块生成和状态编排进入 controller。所有新界面遵循现有 FluentProvider、Fluent 2 token、`@fluentui/react-components` 和 `@fluentui/react-icons` 基线。

## 20. 参考项目

- EduLab: <https://github.com/wy51ai/edulab>
- SchemaTex: <https://github.com/SchemaTex/SchemaTex>
- stem-illustration-skill: <https://github.com/liangdabiao/stem-illustration-skill>
- ink-graph: <https://github.com/qaz1230sp/ink-graph>
