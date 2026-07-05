# LiteasyClaw Dock 工作台与 UI 归位规范

## 1. 目的

LiteasyClaw 后续不再把左栏、Reader、右栏和下栏理解为四个写死内容的页面。目标是建立类似 VS Code 的可拖拽 Dock 工作台：

```text
┌──────── Primary Side Bar ────────┬──────── Main / Editor ────────┬──── Secondary Side Bar ────┐
│ 文献库 | Folders | Search        │ PDF | 思维导图 | 流程图 | 动画 │ AI 助手 | 批注 | 属性       │
├──────────────────────────────────┴────────────────────────────────┴─────────────────────────────┤
│ Bottom Panel：生成任务 | 中间产物 | 日志 | 模型运行 | 终端                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

每个业务内容页都应注册为可打开、可关闭、可拖动的标签页。区域只负责承载标签组和布局，不拥有业务状态。

本文是新增 UI 功能默认位置、拖拽能力和空区域表现的工程依据。如果功能与本文冲突，应先修改本文并评审，而不是直接在现有 Pane 中追加 JSX。

## 2. 统一术语

### 2.1 `DockItem`

一个可进入工作台的内容页，例如文献库、搜索、PDF、思维导图、AI 助手或生成记录。

`DockItem` 至少描述：

```ts
type DockRegionId = "left" | "main" | "right" | "bottom";

type DockItemDescriptor = {
  id: string;
  kind: string;
  title: string;
  preferredRegion: DockRegionId;
  allowedRegions: DockRegionId[];
  closable: boolean;
  singleton: boolean;
  stateKey?: string;
};
```

`preferredRegion` 只是首次打开位置，不是永久绑定。`allowedRegions` 用于禁止明显不合理的落点，而不是把布局重新写死。

### 2.2 `TabGroup`

同一个区域内的一组标签。一个区域可以包含一个或多个 `TabGroup`，后续允许水平或垂直拆分。

### 2.3 `DockRegion`

工作台提供四个一级区域：

- `left`：左侧主侧边栏（Primary Side Bar）
- `main`：中央主内容区（Editor / Main Area）
- `right`：右侧辅助侧边栏（Secondary Side Bar）
- `bottom`：下方面板（Bottom Panel）

### 2.4 `LayoutTree`

保存区域、标签组、拆分方向、尺寸比例、标签顺序和激活标签的布局树。业务模块不得直接修改布局 DOM，应通过 Dock action 修改 `LayoutTree`。

## 3. 区域职责

### 3.1 左侧：定位、发现与资源入口

适合回答“我有哪些资源”“我在哪里”“我要找什么”的内容：

- 文献库
- Folders / 工作区目录
- Search
- 组织空间入口
- 收藏与推荐列表
- 文档 Outline

不应默认放置：

- PDF 正文
- 大型流程图、思维导图或动画画布
- 长会话 AI 主界面
- 持续刷新的运行日志

### 3.2 中央：主要阅读、编辑与可视化产物

适合需要最大画布、用户主要注意力或可编辑状态的内容：

- PDF Reader
- 思维导图
- 流程图
- 树形展开
- 动画预览与时间轴编辑器
- 图表、PPT、白板等多模态 Artifact
- 后续可编辑的 AI 最终产物

中央内容通常允许多实例，例如同时打开多篇 PDF、多个 Artifact。中央标签关闭后，其领域数据不能随组件卸载而丢失。

### 3.3 右侧：上下文、交互与检查器

适合围绕当前主内容提供辅助操作的内容：

- AI 助手
- 批注列表
- 属性 / 元数据检查器
- 引用与来源
- 当前选择详情
- Artifact 参数与样式面板

右侧内容应通过显式上下文读取当前激活主标签，不得直接读取中央组件的 React 私有状态。

### 3.4 下方：过程、运行状态与可追踪中间结果

适合横向空间较宽、纵向可压缩、需要持续观察但不是主要画布的内容：

- AI 生成任务队列
- Generation Runs
- 中间生成产物
- 模型调用与工具执行日志
- 错误、审计与诊断信息
- 终端或开发控制台
- 后台同步状态

最终可视化产物默认进入中央；生成过程和中间步骤默认进入下方。不要把二者混成同一个标签。

## 4. 空 Dock 区域的统一表现

顶部布局控制中的左栏、右栏、下栏按钮只控制对应 `DockRegion` 的展开与折叠。

当 `left`、`right` 或 `bottom` 区域满足以下条件：

1. 用户点击对应按钮将区域展开；
2. 该区域没有任何 `DockItem`；

则区域必须渲染统一的 `DockEmptyState`：

- 居中显示 LiteasyClaw Logo；
- 不显示“暂无内容”“请选择页面”等说明文字；
- 不创建假的占位标签；
- 不自动把其他区域的标签搬过来；
- 仍然显示有效的拖拽落点，用户可把标签拖入该区域；
- 空区域尺寸沿用用户上一次调整结果；没有历史尺寸时使用默认尺寸。

Logo 使用现有品牌资源：

```text
LiteasyClaw/desktop/src/assets/liteasyclaw-logo.jpg
```

`main` 区域没有打开的主内容时也应使用相同的品牌空状态，但中央空状态不等同于创建一个 Logo 标签。

## 5. 拖拽与停靠规则

拖动标签时必须提供明确的可视化反馈：

- 区域中央：加入目标 `TabGroup`
- 标签条前后：调整标签顺序
- 目标组左 / 右 / 上 / 下边缘：创建拆分组
- 工作台最左：移动到左侧栏
- 工作台最右：移动到右侧栏
- 工作台底部：移动到下方面板

拖动期间显示半透明目标区域和待落位轮廓。只有松手后才提交布局 action。

移动标签只改变布局位置，不改变：

- PDF 当前页、缩放和选区
- AI 会话内容
- Artifact 数据和版本
- 生成任务状态
- 批注及未保存草稿

关闭标签与删除业务对象是两种不同操作。关闭只从布局树移除实例；删除必须使用领域 action 并按风险规则确认。

## 6. 新功能归位决策

开发新 UI 前依次回答：

1. 它是否需要独立打开、关闭或切换？
   - 是：注册为 `DockItem`。
   - 否：作为现有 DockItem 的内部组件。
2. 它是资源入口、主内容、上下文辅助，还是运行过程？
   - 资源入口 → `left`
   - 主阅读 / 编辑 / 可视化 → `main`
   - 上下文 / AI / 检查器 → `right`
   - 任务 / 中间结果 / 日志 → `bottom`
3. 它是单例还是多实例？
   - Search、AI 助手通常是单例。
   - PDF、Artifact、生成详情通常按资源 ID 多实例。
4. 哪些区域允许接收它？
   - 大画布至少允许 `main`。
   - 工具型内容通常允许 `left`、`right`、`bottom`。
   - 不要仅因“开发方便”把所有区域都列为允许。
5. 关闭并重新打开时如何恢复？
   - 领域状态由 feature store / repository 保存。
   - 布局和激活状态由 Dock layout store 保存。

无法回答以上问题时，不应直接把功能追加到 `LeftPane`、`ReaderPane`、`AssistantSidebar` 或 `AppShell`。

## 7. 工程边界

建议新增：

```text
features/dock/
  dock.types.ts
  dockRegistry.ts
  dockLayout.store.ts
  dockLayout.storage.ts
  DockRegion.tsx
  DockTabStrip.tsx
  DockDropOverlay.tsx
  DockEmptyState.tsx
```

职责划分：

- `shell`：组合四个区域、尺寸控制和全局拖拽层。
- `dock`：布局树、标签生命周期、拖拽停靠、持久化和空状态。
- 业务 feature：提供 DockItem 内容、标题和领域 action。
- controller：把当前工作区、选择和账号上下文适配给 DockItem。

禁止：

- 业务 feature 导入 `AppShell`。
- Dock store 保存 PDF、AI 会话或 Artifact 的完整业务数据。
- Pane 组件通过 `kind === "xxx"` 堆叠大量业务分支。
- 新功能绕过 `dockRegistry` 直接硬编码到某个栏。

## 8. 当前组件迁移映射

| 当前内容 | 默认 Dock 区域 | 迁移方向 |
|---|---|---|
| `LibraryPane` | `left` | 注册为 library DockItem |
| Folders / Collection tree | `left` | 从 LibraryPane 拆成可独立标签 |
| Search | `left` | 新增独立单例 DockItem |
| `PdfReader` | `main` | 每篇文献一个实例 |
| Artifact tabs | `main` | 每个 Artifact 一个实例，不再嵌在固定下栏 |
| `AssistantPane` | `right` | 注册为单例，可允许拖入 bottom |
| PDF 批注栏 | `right` | 从 PDF 内部侧栏逐步拆成上下文 DockItem |
| Generation Runs / 中间产物 | `bottom` | 新增过程型 DockItem |
| 设置、账号、组织管理 | `left` 或全局 Dialog | 根据是否需要持续驻留决定 |

迁移期间可以保留现有 Pane 组件，但新增功能必须遵守目标模型，避免扩大固定三栏接口。

## 9. 持久化与恢复

至少保存：

- 每个区域是否展开
- 区域尺寸
- TabGroup 拆分结构
- DockItem 实例和顺序
- 每组激活标签

恢复时：

1. 读取布局版本；
2. 丢弃未注册或已无权限的 DockItem；
3. 用 `dockRegistry` 恢复可用内容；
4. 空的左、右、下区域在折叠时保持折叠；
5. 用户主动展开空区域时显示 Logo 空状态。

布局存储必须带 schema version，后续升级只能迁移，不能假定旧 JSON 永远兼容。

## 10. 测试要求

每次新增 DockItem 至少验证：

- 默认进入正确区域；
- 只在 `allowedRegions` 内停靠；
- 跨区域移动后业务状态保留；
- 关闭和重新打开行为符合 singleton / multi-instance 定义；
- 布局刷新后可恢复；
- 左、右、下空区域被展开时只显示 Logo；
- 空区域仍可接收拖拽；
- 键盘用户可完成标签激活、移动和关闭。

拖拽命中计算和布局树变化应写纯函数测试；`AppShell.test.tsx` 只保留一个端到端 Dock smoke path。

## 11. 当前实现状态

第一阶段 Dock 工作台已经落地：

- `left`、`main`、`right`、`bottom` 四个区域均由统一 `DockRegion` 渲染；
- 文献库、组织、个人中心、设置、Reader、Liteasy Chat、多模态产物均已注册为 DockItem；
- 工具标签可以在允许区域间拖动，标签顺序、激活项和所在区域会持久化；
- `Shift + Alt + 方向键` 可将当前工具标签移动到对应区域；
- 左、右、下栏为空但被展开时，只显示 LiteasyClaw Logo，并继续作为拖放目标；
- 多模态产物已从 Reader 的固定下半区拆出，默认停靠下栏，也可拖到主内容区；
- 侧栏宽度、下栏高度和各区域展开状态继续独立持久化。

当前实现采用“每个区域一个 TabGroup”的第一阶段模型，尚未加入区域内再次拆分、
浮动窗口、标签关闭和同类资源多实例。后续扩展这些能力时，应升级布局 schema，
而不是把特例重新写回 `AppShell`。
