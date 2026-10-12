# 统一内容与资产实施记录

基线：`b5ba9b7f`，分支 `feat/unified-content-assets`。用户已有 .gitignore、AGENTS.md 和 agent 终端评估文档不属于本次改动。

## WP00：真实调用链

`workspaceAgentAssetService` → `readAgentAssetText`（UTF-16 字符窗口）→ `runWorkspaceAgent.reads`（按路径覆盖）→ `evidenceReportFromAssetReads`（再次截取 4000 字符）→ `EvidenceLens.PassageCard`（裸字符串）。

已有底座：MarkdownContent、MineruMarkdown 的安全表格适配、ObjectRepository 的版本/CAS、ResourceFileService 的 provider 和 scope、AgentAssetService、ContextSnapshot、resourceReveal。只增量收敛，不另建存储。

## 基线迁移清单

| 资产/表面 | 现有入口 | 需要补足 |
|---|---|---|
| 对象/笔记/消息/白板 | 对象仓库 + objects adapter | 内容合同、类型注册、原生表示保留 |
| 外部 Markdown/TXT/Canvas | NoteFileService + files adapter | 结构片段、固定版本定位 |
| 论文/PDF | papers adapter + paper anchors | 保留页坐标，不假造字符映射 |
| 产物/批注 | artifacts adapter + context bridge | 去除上下文 provider 白名单 |
| 阅读器/笔记/白板/消息/帮助 | MarkdownContent | 统一安全表格策略 |
| 证据 | PassageCard | typed body、源码切换、禁止远程图片自动加载 |
| 临时界面文本/诊断 | React literal | 保持字面文本，不文件化 |

合成 fixture 来自任务包，不是用户 Larimar 原文。WP00 使用 expected-failure 测试记录两个可重复失败，后续阶段转成正常断言。

## WP01：共享渲染

加入宿主固定 research profile（raw→sanitize→有界表格属性→受限 KaTeX），MinerU 不再自建净化流水线。Evidence 使用 ContentView，旧字符串通过集中 legacy adapter，标题保持 literal；证据禁用自动图片/嵌入加载，提供原样源码按钮。完整表格渲染不意味着残片已经修复。共享 Markdown/证据回归测试覆盖安全链接和攻击内容。

## WP02：结构片段

基于现有 remark 生态建立原始 UTF-16 块索引，保留 CRLF 与精确选区；完整父块/脚注定义仅进入 viewContext，记录展示扩展。超过结构预算保留原始摘录并明确降级。证据取消 4000 字符二次截断，快照可持久化 ContentFragment。上下文预算不再切开 HTML 表、fence、数学、列表。47 项相关断言通过；TypeScript 编译通过。

## WP03：读取账本与定位

追加式读取账本保留同路径不同范围/版本。模型调用成功后记录实际保留下来的 read IDs、UTF-16 范围与序列化输入 SHA-256；展示扩展单独标记，不会自动计入模型输入或提升核验等级。WP06 的模型投影可明确选择预算内完整结构，并独立记录实际投递范围。最新 read Map 仅用于 CAS。账本随 evidence report 持久化；来源绑定不匹配则拒绝解析。导航支持版本与原文行/摘录，外部版本变化拒绝打开，内部历史对象走 repository.get，避免打开最新附件。43 项回归及账本专项 2 项通过，TypeScript 通过。

## WP04：注册与多入口

新增宿主类型组合根，注册时拒绝缺失 context、handler、fixture、codec 和未知 profile。生产对象、挂载文件、论文、产物都经注册派生 Agent 门面；六种对象类型另派生 ResourceProvider，原生导出保留 ObjectEnvelope JSON。资源上下文路由不再限定 artifacts；旧 artifacts URI 的账号/版本兼容由独立 provider bridge 承担。research.memo 挑战在真实 IndexedDB 对象仓库完成发现、固定上下文、Agent 读取、native roundtrip、证据、CAS、重开与历史读取，无 Assistant/Evidence/context-picker 分支改动。59 项相关测试通过。挂载文件/原始 PDF 的通用 native provider 仍明确返回未接入原因，原领域导出能力保留。

## WP05：正文表面迁移

阅读器、外部 Markdown、笔记、白板文本、薄读、批注、消息、生成演示/思维图、帮助与资源预览均改用 typed ContentView；旧正文通过集中 legacyContent 适配，不伪造固定来源。ContextSnapshot 增加结构片段并保留原有 text/预算协议。共享净化保留宿主产生的薄读交互标记，原始 HTML 无法伪造这些标记；原有引用/术语/表格测试保留。静态入口已收敛，专用原生格式仍由领域处理。

## 数据流与迁移

1. 领域仓库保持权威原物，注册表只组合服务，不保存另一份正文。
2. 原始 read 返回 exactSelection；结构解析使用同一份源字符串的 UTF-16 坐标，viewContext 记录补全块/定义。
3. Agent 最新版本缓存负责写前检查，追加账本负责历史证据。模型请求按实际序列化内容记录投递范围与 SHA-256，显示扩展不能自动成为事实支持。
4. EvidenceReport 的 v1 可选字段增加 `content`、`readLedger`；旧 quote 保留，由 legacy adapter 显示，绝不补造版本/精确定位/核验记录。未识别的报告仍经既有安全解析回退，不回写历史文件。
5. GUI/拖拽/@ 固定 ObjectRef，Agent/本地 MCP 复用 AgentAssetService；注册类型的 ResourceProvider 输出原生 JSON 或受控文本表示。域权限、来源限制和 CAS 留在既有 adapter/repository。
6. 证据导航传递 scope、revision、行与摘录；不存在历史版本时拒绝静默切 latest。PDF 保留页级语义。

## 资产能力矩阵

实际矩阵由 `service.resourceTypes.matrix()` 生成。支持意味着已接入的操作，而非所有格式/权限均可用。

| 类型 | 真源/原生 | 读取/上下文 | 写入与导航 |
|---|---|---|---|
| content.note / research.memo 样例 | ObjectRepository / object JSON | Markdown、结构片段、固定 ObjectRef | 复用笔记 CAS；固定版本导航 |
| content.fragment / conversation.message / artifact.document | ObjectRepository / object JSON | 共享正文/证据/上下文 | 注册类型只读；领域操作保留 |
| source.document | ObjectRepository / object JSON（不冒充原始 PDF） | 已有正文能力检查；未提取格式明确拒绝 | 原领域原文件阅读器 |
| workspace.board | ObjectRepository + placements/edges / board bundle | JSON Canvas 投影、成员上下文 | 专用白板编辑；历史布局不可用则拒绝 |
| mounted-files | NoteFileService / 原始 md、canvas、图片 | 原文件版本与结构片段；图片走专用图像 API | 文件 CAS、外部编辑冲突规则保留 |
| papers | 论文索引/阅读器缓存 | 摘要与已解析页，不假定全文覆盖 | 不覆盖 PDF，领域页定位 |
| artifacts / artifact-resources | 现有产物仓库 | 原 URI + 通用资源 URI 桥接，校验账号/版本 | 原编辑器；历史产物导航未提供时明确拒绝 |
| 帮助/公开设置说明 | 现有说明/setting projector | 共享正文；设置诊断 literal | 不因为可以显示就提供写权限 |
| 原始未知二进制/工作流专用结构 | 原领域 adapter | 保持已有专用能力；不能提取时返回原因 | 本次不虚构通用 Markdown/native codec |

挂载文件、原始 PDF 的通用 native ResourceProvider 尚未接入；不会宣称这些原始二进制已能通过文本接口无损 roundtrip。注册表有明确不可用原因，原领域导出不受影响。新原生格式仍须实现专业 codec，不能仅加一个 typeId。

## 验收环境与边界

Linux + Node 22.23.2 + Chromium。浏览器测试使用真实 OPFS 文件句柄、NoteFileService、IndexedDB 对象仓库、固定 ContextSnapshot、DesktopAgentService/管理器/真实工作区工具执行；模型 transport 为明确标记的确定性模拟，未调用真实供应商。不能据此称 live 模型质量或 Windows 安装版已验收。

新增浏览器用例覆盖 320/360/720px、light/dark、200% 缩放；截图输出 `products/liteasy/apps/desktop/test-results/unifiedContent.browser-*/content-*.png`，不提交运行生成物。已有 Evidence Lens 浏览器用例继续覆盖键盘、弹窗、完整消息列表与真实导航。

用户原始 Larimar 文件未提供，因此本任务验证机制及合成资料链路，不宣称已经复现该具体文档。任务包混合 fixture 的脚注后紧邻 `[note]` 行在 remark 中属于脚注延续；保持原样，并另加正确分隔的参考链接用例，绝不自动改造来源以使测试好看。


## WP06：强制门禁与收尾

- `ci:content` 已接入普通前端 CI：TypeScript AST 拦截独立 ReactMarkdown/raw/sanitize 流水线、绕过 ContentView 的调用、裸证据 blockquote 与再次切片；Node 负例测试证明门禁会失败。生产 TypeScript 包含负向类型用例，拒绝裸 string 与缺失能力实现。
- 模型投影优先完整父块及定义；预算不够时只送完整块，否则 metadata-only，单独记录 delivery ranges。不能把 display receipt 当作模型或核验读取。相同来源/版本只计一个 source，同时保留每次 passage/read receipt。
- 每次成功读取及模型返回后保存 run.evidenceCheckpoint。取消/重开保留原文摘录与账本，不恢复工具或重放写入；存储失败停止任务。损坏 checkpoint 进入现有只读恢复流程，不擦除其他可读记录。
- CRLF/UTF-16 的片段 segments 对应原文；数学规范化无法精确映射时移除渲染坐标并标记 unavailable。流式内容标记为未完成；超大正文/过深树有明确展示限制，原文不改写。
- 六种对象的 conformance 覆盖原生表示与上下文；白板 native bundle 保留 placements/edges，未保存历史布局时明确拒绝历史导出。通用注册类型可经同一个导航 controller 打开固定版本。
- 全量回归曾暴露两个兼容问题并已修复：部分上下文不得持久化未读的展示扩展；PDF 受控 attachment 图片协议须保留给原领域 URL 解析器。Node 门禁用例采用 `.node-test.mjs`，避免被 Vitest 当作空测试套件。

### 验收索引与限制

用例编号来自 `development/test-data/unified-content/acceptance-cases.json`。以下是可追溯的测试入口；不是宣称所有宿主/文件格式的所有组合都通过。

| 用例 | 实施与回归入口 | 范围说明 |
|---|---|---|
| C01–C06 | unifiedContent、MarkdownContent、ThinReadingMarkdown、AssistantMarkdown、pdfCanvasStorage、跨表面 ContentView | 合成 GFM/HTML 合并表格、数学、源码、字面标题与依赖定义 |
| C07–C13 | unifiedContent、modelContentProjection、contextIntegrity、resourceReveal | 原始选区、结构闭包、超大块、CRLF/surrogate、规范化精度降级 |
| C14–C18 | contentReadLedger、workspaceAgent、modelContentProjection | 重复/跨版本读取、独立投递、同源去重、预算与驱逐 |
| C19–C22 | resourceReveal、paperAttachments、resourceTypeRegistry、browser/unifiedContent | 固定对象身份/版本、文件变化拒绝、原领域 PDF/Canvas 定位保留；外部文件重命名无稳定别名时不会凭同名猜测 |
| C23–C28 | unifiedContent、resourceReferences、resourceReferenceContext、workspaceAgentSafety、resourceActionPolicy | 安全 HTML/URL、证据禁自动远程媒体、scope 与来源权限、确认写入 |
| C29–C32 | resourceTypeRegistry、contentContract.typecheck、check-content-boundaries.node-test | 注册负例与 research.memo 真仓库挑战 |
| C33–C35 | libraryAssetContextDrop、resourceContextDrop、liteasyPath、localAssetMcp、resourceFileService、resourceTypeRegistry | 共用固定 ref 与核心服务；Windows 原生 MCP 进程本次 NOT_RUN |
| C36–C39 | evidencePersistence、agentStatePersistence、contentReadLedger、contextIntegrity、resourceTypeRegistry | 旧报告未知精度、取消恢复、CAS、版本/scope 校验；没有另建跨主体内容缓存 |
| C40–C42 | browser/unifiedContent、browser/evidenceLens、unifiedContent | 窄栏/主题/缩放、键盘与滚动、未完成流式内容 |
| C43–C44 | ci:content AST/类型/注册负例与安全渲染正例 | 正常富正文可用与危险内容不执行同时验证 |
| C45–C46 | browser/unifiedContent、resourceTypeRegistry | 实际文件/仓库/Agent 工具链，确定性模拟模型；代码生成的能力矩阵，不把 unsupported 算作支持 |

通用注册表本次不接管创建/删除命令；这些动作仍由领域入口提供权限与确认，不因 read/context 注册而自动获得。

Tauri Windows 安装版、真实模型供应商、用户原始 Larimar 重现：**NOT_RUN**。挂载文件/PDF 的通用 native provider、原始外部文件无版本历史时的旧版本恢复：**显式 unsupported**；原领域文件操作继续保留。不能以此记录代替原生安装版或用户具体资料验收。


固定资料：`mixed-content.md` SHA-256 `470ddbb127b0acfbe71f5759b01462b1204a90d72193fade7592fc701a0644c0`；`long-table.md` SHA-256 `28981a77c683f3eb9d54930c2bf904cd045e0d506b46f5e05fe6b40f14e88093`。没有用修改 fixture 内容来掩盖结构失败。


### 本轮执行结果（2026-10-12）

- `npm test`：545 个文件通过、3 个跳过；3,796 项通过、7 项跳过。随后仅追加表头 `headers` 对齐、超大源结构预算和浏览器正式导航验收，使用以下相关回归验证；未把跳过的 live 用例记为成功。
- `npm run ci:content`：AST 检查与 Node 负例通过；最新 25 项内容/账本/注册/模型投影测试通过。
- `npx vitest run src/tests/MarkdownContent.test.tsx src/tests/ThinReadingMarkdown.test.tsx src/tests/contextIntegrity.test.ts src/tests/contextModelInput.test.ts src/tests/contextBuilder.test.ts src/tests/AssistantMarkdown.test.tsx src/tests/pdfCanvasStorage.test.tsx`：33 项通过。
- `npm run ci:smoke`：通过。语言包未改动。
- `npm run build`：最新生产构建通过，158 个静态资源校验通过；保留现有大 chunk 提示。
- 提交后 `npm run ci:contracts`：通过，输出 `Selected paths match Git; no generated-file or lockfile drift detected.`；生成 schema、锁文件与 Git 一致。本结果补记仅改文档，受检代码未变化。
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:1425 PLAYWRIGHT_EXECUTABLE_PATH=/home/tjm/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome npx playwright test src/tests/browser/unifiedContent.browser.spec.ts src/tests/browser/evidenceLens.browser.spec.ts --workers=2`：最新 20 项通过；模型 transport 的 provider 为 `synthetic-fixture-no-network`、mode 为 `unknown`，不冒充真实执行。来源打开经过正式 createAgentAssetNavigator，原文编辑器只读展示且选区断言通过。
- 仓库根目录 `bash .github/scripts/lint-workflows.sh` 与 `node --test .github/scripts/*.test.mjs`：通过，93 项脚本测试成功。

表头 ID 被净化器加安全前缀后，`headers` 指向同步调整，避免屏幕阅读器失去关联。超过 2,000,000 UTF-16 单元的来源不会为一个小窗口构造完整 AST，而是明确结构预算降级；原文和精确选区仍保留。
