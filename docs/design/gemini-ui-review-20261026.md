当前界面出现“苍白扁平、重点不突出”的核心原因，在于**完全依赖 `1px` 实线边框来分割空间，而缺乏“背景明度层级（Surface Elevation）”与“视觉权重对比”**。

结合截图来看，目前存在四个典型的视觉瓶颈：

1. **全局同色导致的“白茫茫一片”**：从最左侧图标栏、文献/笔记目录树、批注列表、设置面板，到核心的 PDF 阅读区、白板以及右侧 AI 助手，几乎全部使用了相同的纯白或极浅灰底色（`#FFFFFF`）。没有底色灰阶差，人眼就无法在 4 栏并排时瞬间锁定“主工作区（PDF/白板）”。


2. **“线框地狱（Border Fatigue）”**：面板分割线、顶部 Tab 栏、搜索框、下拉菜单（如设置页的“简体中文”、“微软雅黑”选框）、批注卡片全部使用了高对比度的深灰实线边框。过多线条喧宾夺主，吞噬了内容本身的呼吸感。


3. **信息层级与排版同质化**：笔记列表中的标题、正文摘要、页码链接（如 `Cicada · 第 1 页`）字重与字号拉开不足；文献库中的年份与分类标签（如 `2023`、`cs.LG`）饱和度偏高且样式生硬，破坏了学术阅读软件应有的精致与克制。


4. **缺乏 AI Native 的灵动感**：顶部的 `AI 解读`、右上角的 `AI` 按钮 以及右侧的对话输入框，样式与普通表单按钮无异，缺少现代 AI 原生应用（如 Cursor、Linear、Readwise Reader、Heptabase）那种“悬浮感、微光感与呼吸感”。



---

### 交付给 Coding Agent 的 UI 重构提示词（Master Prompt）

你可以直接复制以下 Markdown 提示词，连同你的前端样式文件（如 `tailwind.config.js`、`globals.css` 及核心布局组件）一起发给 **Cursor / Claude Code / Windsurf** 等 Coding Agent 执行重构：

```markdown
# Role & Objective
你是一位世界顶尖的 Design Engineer（设计工程师），精通 Linear、Readwise Reader、Heptabase、Notion 和 Cursor 的 UI/UX 设计范式。
当前我们正在开发一款 AI Agent Native 的学术 PDF 阅读器与知识库软件（Liteasy）。目前的浅色模式（Light Mode）UI 过于苍白、扁平，存在严重的“线框堆积（Border Fatigue）”，且多栏布局下视觉重点不突出。

请在不破坏任何现有业务逻辑、状态管理、路由及 DOM 交互功能的前提下，全面重构前端的视觉样式系统（Design Tokens、布局层级、组件样式与微交互）。

---

# Core Design Philosophy (重构核心准则)

1. **用“背景明度层级（Surface Layering）”取代“生硬线框”**：
   - 严禁所有分栏使用相同的纯白色背景。必须通过冷暖克制的微灰阶（Zinc / Slate 色系）区分“导航区 -> 列表/辅助区 -> 核心阅读与创作区 -> AI 副驾驶区”。
2. **削弱边框，强化阴影与留白（Whisper-quiet Borders）**：
   - 移除不必要的嵌套边框。全局分割线使用极低透明度的 `rgba(0, 0, 0, 0.06)`（或 `#EBECEF`）。
   - 工具栏、画布控制条、AI 输入框采用“悬浮卡片（Floating Island）”设计，配合细腻的多层弥散阴影。
3. **建立清晰的排版对比度（Typographic Hierarchy）**：
   - 拉开面板标题、文档标题、正文摘要、元数据（页码、标签、时间戳）的字重（Font Weight）与字色明度（Text Opacity），让用户一眼扫过即可捕捉重点。
4. **塑造 AI Native 视觉语言**：
   - 为 AI 相关入口（AI 解读、AI 标注、右侧 Agent 助手）赋予独特的微渐变（Indigo-to-Violet 或深邃学术蓝）、柔和光晕与精致的胶囊态（Pill-shaped）交互体验。

---

# Step 1: Global Design Tokens (CSS Variables / Tailwind 规范)

请在全局样式（如 `:root` 或 Tailwind 配置）中建立并替换为以下浅色模式语义化 Token：

```css
:root {
  /* 1. Surface Hierarchy (背景层级：由暗到亮，凸显核心阅读区) */
  --bg-app-shell: #F3F4F6;        /* 最外层应用框架、最左侧图标导航栏、顶部全局栏 */
  --bg-sidebar: #F8F9FA;          /* 一级侧边栏：文献库目录树、笔记文件夹树 */
  --bg-panel-secondary: #FAFAFA;  /* 二级列表面板：笔记/批注卡片流、设置页背景、右侧 AI 面板底色 */
  --bg-canvas-primary: #FFFFFF;   /* 核心工作区：PDF 阅读器底板、白板画布、激活态卡片 */
  --bg-elevated: rgba(255, 255, 255, 0.88); /* 悬浮工具栏、下拉菜单（配合 backdrop-filter: blur(12px)） */

  /* 交互态表面色 */
  --bg-hover: rgba(15, 23, 42, 0.04);
  --bg-active: rgba(15, 23, 42, 0.07);
  --bg-selected-accent: #EEF2FF;  /* 选中项的极浅品牌色底色 */

  /* 2. Typography Colors (文字色彩层级：避免纯黑，使用深灰蓝提升阅读舒适度) */
  --text-primary: #0F172A;        /* 标题、核心正文、选中态文字 (Slate 900) */
  --text-secondary: #475569;      /* 摘要正文、次级导航项、常规设置项 (Slate 600) */
  --text-muted: #94A3B8;          /* 页码、时间戳、占位符、辅助说明文字 (Slate 400) */

  /* 3. Brand & AI Native Accents (品牌色与 AI 专属色) */
  --accent-primary: #2563EB;      /* 核心交互主色（学术蓝） */
  --accent-primary-hover: #1D4ED8;
  --ai-accent-gradient: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); /* AI 原生功能微渐变 */
  --ai-surface-subtle: #F5F3FF;   /* AI 消息气泡/提示框极浅紫底色 */
  --ai-border-subtle: #DDD6FE;    /* AI 专属微边框 */

  /* 4. Borders & Dividers (极简边框系统) */
  --border-subtle: rgba(15, 23, 42, 0.06);  /* 面板分割线、列表内部分割 */
  --border-default: rgba(15, 23, 42, 0.10); /* 输入框、卡片默认边框 */
  --border-focus: #3B82F6;                  /* 聚焦态外发光边框 */

  /* 5. Shadows (精细化多层阴影) */
  --shadow-xs: 0 1px 2px rgba(15, 23, 42, 0.03);
  --shadow-card: 0 1px 3px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.02);
  --shadow-floating: 0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 4px 10px -2px rgba(15, 23, 42, 0.04);
  --shadow-pdf-page: 0 4px 20px rgba(15, 23, 42, 0.07), 0 0 1px rgba(15, 23, 42, 0.12);
}

```

---

# Step 2: Layout & Component Refactoring Rules (分模块重构细则)

请按照以下规范逐一改造现有界面模块：

### 1. 顶部全局栏与多栏标签页 (Top Bar & Workspace Tabs)

* **移除生硬的矩形方框 Tab**：当前带有粗蓝底边和全包围灰线的 Tab 过于陈旧。
* **改为现代胶囊/融入式 Tab（类似 Arc / Linear / Obsidian 新版）**：
* Tab 栏背景设为 `--bg-app-shell` (`#F3F4F6`)。
* 未激活 Tab：背景透明，文字为 `--text-secondary`，无边框，Hover 时背景变为 `--bg-hover`。
* 激活态 Tab：背景为 `--bg-canvas-primary` (`#FFFFFF`)，文字为 `--text-primary` 且 `font-weight: 500`，带圆角 `rounded-t-lg` 或独立胶囊圆角 `rounded-md`，配合 `--shadow-xs`，在视觉上与下方工作区自然融为一体。


* **全局搜索框（“搜索工作区”）**：改为背景 `rgba(15, 23, 42, 0.04)`、边框透明（Hover 时显现微弱边框）、圆角 `rounded-lg` 的内嵌式精致命令栏样式，右侧快捷键 `Ctrl + Shift + F` 封装为浅灰 `<kbd>` 按键样式。

### 2. 最左侧导航栏与一级目录树 (Activity Bar & File/Note Tree)

* **最左侧图标栏**：背景固定为 `--bg-app-shell`，移除与相邻侧边栏之间的粗边框，改用 `1px solid var(--border-subtle)`。选中态图标不要使用刺眼的纯蓝框，改为精致的圆角浅蓝底块或左侧 `3px` 胶囊指示条。
* **文献库 / 笔记目录树**：
* 背景设为 `--bg-sidebar` (`#F8F9FA`)。
* 树节点行高适度收紧并增加水平内边距（`px-2.5 py-1.5 rounded-md`），选中态使用 `--bg-active` 配合加粗字体。
* **文献元数据标签重构（重点）**：将文献库中原本高饱和度的 `2023`、`cs.LG`、`会议论文` 标签，统一改为**低饱和度微边框胶囊（Subtle Pill Badges）**：
* 年份标签：背景 `#F1F5F9`，文字 `#475569`，字号 `11px`，字体等宽（`font-mono`）。
* 分类标签（如 `cs.LG` / `期刊论文`）：背景 `#EFF6FF`，文字 `#2563EB`，边框 `1px solid rgba(37, 99, 235, 0.15)`，圆角 `4px`，内边距 `1px 6px`。





### 3. 批注列表与摘录卡片流 (Notes & Annotations Feed)

* **解决“卡片杂乱扁平”问题**：
* 列表容器背景设为 `--bg-panel-secondary` (`#FAFAFA`)。
* **左侧批注列表（Cicada 列表）**：移除生硬的通栏分割线，改为间距 `gap-2` 的无边框或极淡边框卡片流。将“批注”二字弱化为小号图标+浅色文字，将 `Cicada · 第 1 页` 改造为精致的浅蓝胶囊引用标签，正文摘要使用 `--text-primary`，行高 `1.6`，最多展示 3 行（`line-clamp-3`），彻底消灭底部文字被生硬截断一半的视觉瑕疵。
* **中间 PDF 摘录卡片**：
* 移除整张卡片满铺的刺眼黄底！
* 改为**纯白卡片底色 (`#FFFFFF`) + 左侧 `3px` 彩色高亮指示条（如琥珀黄 `#F59E0B` 或学术蓝 `#3B82F6`）**，卡片带 `--shadow-card` 和 `rounded-lg` 圆角。这样既能清晰区分高亮颜色，又能让版面瞬间干净高级。





### 4. 核心工作区：PDF 阅读器与白板 (PDF Reader & Canvas)

* **强化视觉绝对重心**：
* PDF 阅读器背景底板设为温暖柔和的 `#F1F5F9`（Slate 100），让中间的 PDF 页面（`#FFFFFF`）通过 `--shadow-pdf-page` 真正“浮”在桌面上，形成强烈的纸张质感与立体聚焦。


* **顶部工具栏改造**：
* 将 `AI 解读`、`MinerU 解析`、`AI 标注` 与右侧的缩放/翻页控件分组。
* `AI 解读` 按钮使用 `--ai-accent-gradient` 渐变背景或带有星光图标的高质感描边按钮（背景 `--ai-surface-subtle`，文字 `#4F46E5`，边框 `--ai-border-subtle`），使其一眼区别于普通工具按钮。


* **白板（Canvas）视图**：
* 点阵背景（Dot Grid）的点颜色调淡至 `rgba(15, 23, 42, 0.12)`。
* 底部工具栏改为毛玻璃悬浮岛（`background: var(--bg-elevated)`，`backdrop-filter: blur(12px)`，`box-shadow: var(--shadow-floating)`，`border-radius: 9999px` 或 `12px`）。



### 5. 右侧 AI 研究助手面板 (AI Agent Copilot Dock)

* **打造 AI Native 沉浸感**：
* 顶部 `首页 | 对话 | 任务` 切换器改为苹果/Linear 风格的 **Segmented Control（分段滑块控制器）**：外框浅灰槽 `#F1F5F9` + 内部纯白圆角滑块带微阴影。
* AI 回复区域：增加舒适的阅读留白，项目符号（Bullet points）使用精致的自定义缩进与行距（`leading-relaxed`）。
* **底部 AI 输入框（Composer）重构（核心视觉亮点）**：
* 抛弃死板的直角灰框，改为大圆角悬浮输入框（`rounded-xl`，背景 `#FFFFFF`，默认带 `--shadow-card` 与 `1px solid var(--border-default)`）。
* 当输入框 `:focus-within` 时，呈现柔和的 AI 品牌色光晕：`border-color: #6366F1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12), var(--shadow-floating);`。
* 左下角模型选择器（`deepseek-v4-flash`）改为紧凑的浅灰胶囊按钮（`bg-slate-100 hover:bg-slate-200 text-xs font-medium rounded-full px-2.5 py-1`），右下角发送按钮改为精致的圆角渐变或深色主按钮。





### 6. 设置面板与表单控件 (Settings & Form Controls)

* **告别 Windows 传统表单感**：
* 设置页采用左右分栏或居中限宽容器（`max-w-2xl`），避免下拉框随面板无限拉宽。
* 每一组设置项（如“界面语言”、“界面主题”、“列表密度”）改为类似 macOS System Settings 或 Linear Settings 的**水平对齐行（左侧标题+小字说明，右侧紧凑型下拉框，宽度固定为 `180px~220px`）**，组与组之间用圆角白底卡片包裹，而不是垂直堆叠几十个全宽大框。



---

# Step 3: Typography & Micro-interactions (字体与微交互)

1. **字体栈优化**：
* UI 界面字体优先使用：`'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', sans-serif`。
* 数字、页码、年份标签强制启用 `font-variant-numeric: tabular-nums;`。


2. **微交互过渡**：
* 所有按钮、树节点、卡片、Tab 的背景与边框变化统一添加 `transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1)`。


3. **滚动条美化**：
* 隐藏或极简化多栏各自的原生粗大滚动条，改为 `width: 5px`、滑块颜色 `rgba(15, 23, 42, 0.12)` 且仅在 Hover 面板时显现的纤细滚动条。



---

# Execution Instructions (执行要求)

1. 请先扫描项目中的全局样式文件与核心布局组件，列出你将要修改的文件清单。
2. 优先落地 Step 1 的全局 CSS Variables / Tailwind 主题变量。
3. 按模块逐步重构组件样式代码，确保所有颜色、边框、圆角、阴影均引用上述语义化变量，方便后续无缝扩展深色模式（Dark Mode）。

```

---

### 建议的落地顺序（防止 Coding Agent 一次性改崩布局）

为了让 Coding Agent 输出最稳定的代码，建议你在对话框中分 **3 个小步** 引导它执行：
1. **第一步（注入全局 Token 与底色分层）**：先让 Agent 只修改全局 CSS 变量和主框架（App Shell、Sidebar、PDF 容器、AI 面板）的背景色与分割线。你会立刻看到 4 栏的主次关系浮现出来[cite: 1, 2]。
2. **第二步（卡片、标签与排版降噪）**：指定它重构“文献库树形列表”[cite: 2] 与“批注/摘录卡片流”[cite: 1]，重点把满铺黄底卡片改为“白底+左侧色条”，把刺眼标签改为低饱和度胶囊。
3. **第三步（AI 面板与设置页精修）**：最后重构右侧 AI 对话框的悬浮输入区与设置页的左右对齐布局[cite: 2]。

你目前前端使用的是哪套技术栈（如 React/Vue + Tailwind CSS，还是原生 CSS Modules / Styled Components）？告诉我后，我可以帮你把上述提示词中的样式规则直接转换成对应框架的配置代码。

```