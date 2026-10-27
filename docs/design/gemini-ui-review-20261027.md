# Role & Mission
你是一位顶尖的 Frontend Architect & Design Engineer。在上一轮 UI 重构后，主框架的浅色层次已初步建立，但暴露出两个严重问题：
1. **部分区域点击无反应（交互阻塞 Bug）** 与 **“研究工作台”双栏挤压排版紊乱**。
2. **条件渲染分支（展开态子面板、AI 助手“首页”视图、报错态、禁用态按钮）被遗漏**，依然保留着老旧粗糙的原生 HTML 样式。

请严格遵循以下《修正原则》与《全局巡检规章》，对整个前端代码库进行地毯式排查与深度修正。

---

# Part 1: 严格修正原则 (Strict Correction Principles) —— 优先级最高！

在修改任何一行样式代码前，必须遵守以下四条铁律：

1. **交互零阻塞原则（修复“点击无反应”的核心）**：
   - 立即全局检索所有新增的装饰性层、渐变背景层、毛玻璃遮罩层以及 `::before` / `::after` 伪元素，**必须强制加上 `pointer-events: none;`**，严禁任何视觉装饰层拦截鼠标点击事件！
   - 检查“研究工作台”及各面板容器的 `z-index` 与 `position` 层级，确保表单控件（`<button>`, `<select>`, `<input>`, `<textarea>`）处于最高可交互层级，且没有被父级 `overflow: hidden` 或透明兄弟节点覆盖。
   - 严禁在重构 DOM 结构时丢失原有的 `onClick`、`onChange`、`onSubmit` 事件绑定及 `disabled` 状态逻辑。
2. **原子组件先行原则（拒绝打补丁式修改）**：
   - 不允许只修改某个页面的外层 `div`！必须深入底层的**基础原子组件（Button, Input, Select, Textarea, Accordion/Collapse, Badge, Link）**进行样式收敛，确保任何未展开的折叠面板、弹窗、抽屉一旦渲染，天然继承最新设计规范。
3. **容器自适应（Container-Aware Layout）原则**：
   - 严禁在宽度不足 `640px` 的分栏面板内使用硬编码的左右五五开双列网格（Grid/Flex）。当面板较窄时，必须改为**单列垂直流式卡片布局**，防止表单与文字被挤压截断。
4. **消灭原生浏览器默认样式（Zero Raw HTML Style）**：
   - 严禁出现浏览器默认的灰底直角 `<button>`（尤其是 `:disabled` 状态）、带默认黑框的 `<textarea>`，以及带生硬下划线的 `<a>` 标签（如“查看全部”）。

---

# Part 2: 全局 UI 巡检规章 (Global Inspection Checklist)

在提交代码前，你必须扫描整个前端工程的组件树，逐项核对以下 5 类常被遗漏的视图分支：
- [ ] **所有 Tab 的非默认分支**：例如右侧 AI 面板的 `首页`、`对话`、`任务` 三个视图，必须全部重构，不能只改 `对话` 视图。
- [ ] **所有树节点/手风琴的展开态（Expanded States）**：例如左侧文献列表点击展开后的“关联内容 / 提取结果”内嵌面板。
- [ ] **所有表单控件的特殊状态**：包括 `disabled`（禁用态）、`readonly`（只读态）、`error`（错误态，如 `chatgpt_discovery_failed`）和 `loading`（加载态）。
- [ ] **所有空状态（Empty States）与引导卡片**：如“开始新对话”、“暂无任务”等占位视图。
- [ ] **窗口顶栏（Titlebar）的弹性对齐**：检查左、中、右三个 flex 容器在窗口缩放时的对齐与裁切情况。

---

# Part 3: 四大重灾区精准重构指令 (Targeted Refactoring Specs)

### 1. 顶部全局栏右上角：对齐与对称修复 (Top-Right Window Bar)
- **问题现状**：右上角的紫色 `AI` 按钮高度过大、紧贴上边缘，与右侧图标及窗口控制按钮（`-`, `□`, `×`）不在同一水平中线上，视觉严重失衡。
- **修正规范**：
  - 将顶栏右侧区域设为 `display: flex; align-items: center; height: 100%; gap: 6px; padding-right: 4px;`。
  - **重构 `AI` 触发按钮**：高度严格限制为 `26px`（或 `h-6.5`），上下留出呼吸空间；采用精致的胶囊或小圆角矩形（`rounded-md px-2.5 text-xs font-medium`），背景使用柔和渐变 `linear-gradient(135deg, #4F46E5, #7C3AED)`，文字纯白，内部图标与文字间距 `gap-1.5`。
  - **统一图标与窗口控制按钮**：分栏切换图标、`...` 按钮统一设为 `28px × 28px` 的 `rounded-md` 幽灵按钮（Hover 背景 `rgba(15, 23, 42, 0.06)`）。最右侧的 `-`、`□`、`×` 窗口控制按钮保持标准等宽对齐，与左侧功能图标之间用一条高 `14px`、颜色 `rgba(15, 23, 42, 0.1)` 的垂直细分割线隔开。

### 2. 左侧文献库：内嵌展开子面板重构 (`2 项关联内容` / `提取结果`)
- **问题现状**：文献条目下方展开的“提取结果”面板边框生硬、背景苍白、按钮挤作一团，完全是老旧 UI。
- **修正规范**：
  - **打造“内嵌抽屉（Inset Sub-panel）”质感**：展开区域整体向右缩进（`ml-6 mr-1 my-1.5`），左侧添加一条 `2px` 宽的柔和引导竖线（`border-l-2 border-indigo-200` 或 `border-slate-200`），容器采用微灰底色 `bg-slate-50/80`（`#F8FAFC`），圆角 `rounded-lg`，内边距 `p-2.5`，边框 `1px solid rgba(15, 23, 42, 0.06)`。
  - **优化内部控件排版**：
    - 顶部提示文字 `2 项关联内容` 设为 `11px`、字色 `#64748B`（`text-slate-500`）。
    - `提取结果` 折叠头使用紧凑的 `text-xs font-semibold text-slate-700 flex items-center justify-between py-1`。
    - 将 `遵循全局设置` 下拉框与 `准备全文与图表` 按钮改为上下排列或自适应紧凑排列：下拉框与按钮统一高度 `28px`（`text-xs`），按钮采用白底微阴影描边样式（`bg-white border border-slate-200/80 shadow-2xs hover:bg-slate-50 text-slate-700 rounded-md px-2.5`）。
    - 底部的 `论文提取文本`、`论文提取图文版` 改为可点击的精致文件列表项（带左侧小图标、`py-1.5 px-2 rounded-md hover:bg-white hover:shadow-2xs transition-all text-xs text-slate-600`）。

### 3. 中间栏：“研究工作台”彻底重排与交互修复 (Research Workbench)
- **问题现状**：1）点击无反应；2）左右双列在窄面板下严重挤压，导致“研究目标”文本框内容显示不全；3）`验证所选模型`、`断开并移除本机凭据` 呈现出丑陋的原生 HTML 灰色死板按钮样式；4）右侧 `chatgpt_discovery_failed` 报错框突兀简陋。
- **修正规范**：
  - **第一步（排查并恢复点击交互）**：检查“研究工作台”组件及其父级容器的 DOM 与事件绑定，移除任何阻挡点击的图层，确保所有按钮、折叠面板、输入框可正常点击与输入。
  - **第二步（改双列挤压为“单列卡片流 + 响应式网格”）**：
    - 移除当前生硬的左右分栏！在常规面板宽度下，采用**垂直单列模块化卡片布局**（容器设置 `max-w-2xl mx-auto p-5 space-y-5 overflow-y-auto`）。
    - **模块一：研究目标与任务卡片（Research Goal Card）**：
      - 将顶部的说明文字（“先创建一个研究目标……”）作为模块标题下方的浅色副标题说明（`text-xs text-slate-500 leading-relaxed mb-3`），不再单独占用右侧一整列！
      - “研究目标”输入框（Textarea）设为全宽（`w-full min-h-[80px] p-3 rounded-lg bg-slate-50/50 border border-slate-200/80 text-sm text-slate-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15`），确保文字完整展示、绝不截断。
      - `+ 创建研究任务` 按钮改为醒目的主次操作样式（`w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium shadow-xs transition-all`）。
      - 下方的已创建任务项（如 `等待确认 · 本机实验 0/6`）封装为带左侧状态指示条的精致白底小卡片。
    - **模块二：模型连接配置卡片（Model Connection Card）**：
      - 外层使用独立卡片包裹（`bg-white rounded-xl border border-slate-200/70 shadow-xs p-4 space-y-4`）。
      - 将报错信息 `chatgpt_discovery_failed` 整合进该卡片顶部，改造为现代化的 **Alert 警告横幅**：背景 `#FEF2F2`（`bg-red-50`），边框 `1px solid #FECACA`（`border-red-200`），文字 `#DC2626`（`text-red-600`），带警告小图标与等宽字体 `font-mono text-xs px-3 py-2 rounded-lg`。
      - `Continue with ChatGPT` 改为品牌感强的深色或白底高质感认证按钮（`h-9 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-xs`）。
      - **修复丑陋的禁用态/次级按钮（`验证所选模型` / `断开并移除本机凭据`）**：严禁使用 `#D1D5DB` 这种死灰底色！将这两个按钮放在同一行（`flex flex-wrap gap-2 pt-1`）：
        - 默认次级按钮：`h-8 px-3 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50`。
        - 禁用态（`:disabled`）：`bg-slate-50 border border-slate-200/60 text-slate-400 cursor-not-allowed opacity-75`。
        - 危险操作（`断开并移除本机凭据` 未禁用时）：Hover 时呈现微红警示（`hover:text-red-600 hover:border-red-200 hover:bg-red-50/50`）。

### 4. 右侧 AI 助手：“首页”视图重构 (AI Copilot Home Tab)
- **问题现状**：切换到 `首页` 时，“开始新对话”和“最近对话”完全没有应用新 UI 风格，边框粗糙，且 `查看全部` 带有丑陋的原生下划线。
- **修正规范**：
  - **“开始新对话”上下文引导卡片**：
    - 移除杂乱的外框，改为带有 AI 微光质感的柔和卡片：背景 `linear-gradient(180deg, #F5F3FF 0%, #FFFFFF 100%)`，边框 `1px solid #EDE9FE`，圆角 `rounded-xl`，内边距 `p-3.5`，阴影 `--shadow-card`。
    - 标题 `开始新对话` 设为 `text-xs font-semibold text-indigo-950 mb-1.5`。
    - 已选资料区域：将文献标题封装为一个小巧的引用胶囊或内嵌块（带 PDF 小图标、`bg-white/80 border border-indigo-100 rounded-md px-2.5 py-1.5 text-xs text-slate-700 my-2 line-clamp-2`）。
    - `根据已选资料提问` 按钮：改为精致的 AI 主题色按钮（`w-full h-8 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium shadow-xs transition-all flex items-center justify-center gap-1.5`）。
  - **“最近对话”列表重构**：
    - 栏目标题 `最近对话` 设为小号高对比度副标题（`text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mt-4 mb-1.5`）。
    - 每条历史记录（如 `Liteasy研究助手功能介绍 10/15`）：移除生硬间距，改为无边框悬浮列表项（`group flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-slate-100/80 cursor-pointer transition-colors`）。标题使用 `text-xs text-slate-700 group-hover:text-slate-900 truncate`，日期 `10/15` 使用 `text-[11px] text-slate-400 font-mono`，右侧 `...` 按钮默认半透明或隐藏，Hover 行时显现。
    - **消灭下划线链接**：将底部的 `查看全部` 彻底移除 `text-decoration: underline`，改为幽灵文本按钮（`inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-indigo-600 px-2 py-1 mt-1 rounded-md hover:bg-slate-100/60 transition-colors`）。

---

# Part 4: 全局原子组件兜底 CSS 规范 (Global Atomic Fallback)

请在全局样式表中补充以下兜底规则，防止任何角落遗漏原生老旧控件：

```css
/* 1. 杜绝原生丑陋的 disabled 按钮 */
button:disabled,
[role="button"][aria-disabled="true"] {
  background-color: #F8FAFC !important;
  color: #94A3B8 !important;
  border-color: rgba(15, 23, 42, 0.08) !important;
  cursor: not-allowed !important;
  box-shadow: none !important;
}

/* 2. 杜绝原生带下划线的 a 标签或按钮链接 */
a, .btn-link {
  text-decoration: none !important;
}

/* 3. 统一所有输入框、下拉框、文本域的基础质感 */
input:not([type="checkbox"]):not([type="radio"]),
select,
textarea {
  background-color: #FFFFFF;
  border: 1px solid rgba(15, 23, 42, 0.10);
  border-radius: 8px;
  color: #0F172A;
  font-size: 13px;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: #3B82F6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}