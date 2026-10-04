import type { DockItemId, DockLayout, DockRegionId } from "../dock/dock.types";

export const onboardingStorageKey = "liteasy.onboarding.v1";
export type OnboardingModel = {
  invitation: boolean; index: number | null; automatic: boolean; background: boolean; error: string;
  start(): void; next(): void; previous(): void; close(completed?: boolean): void;
  dismissInvitation(): void; toggleAutomatic(): void;
};
export type OnboardingStep = { id: string; title: string; description: string; tip: string; target: string; page?: DockItemId; article?: string };
export const onboardingSteps: readonly OnboardingStep[] = [
  { id: "library", title: "先放入一份资料", page: "library", target: '[data-tour-page="library"]',
    description: "文献库可以整理 PDF、电子书、Markdown 和其他文件。点击导入按钮，或把文件拖到目标文件夹，即可开始。",
    tip: "单击查看文件信息，双击打开阅读。先从一份熟悉的资料开始。" },
  { id: "reader", title: "中间是你的阅读与工作区", page: "help", article: "reading.pdf", target: '[data-region="main"]',
    description: "打开的文献、笔记和设置都会显示在这里。现在展示的是阅读指南；打开自己的文件后，可以选中文字添加高亮、批注或提问。",
    tip: "拖动面板边界调整宽度；三击文件条目收起侧栏，F11 进入全屏专注。" },
  { id: "notes", title: "把理解留在笔记里", page: "notes", target: '[data-tour-page="notes"]',
    description: "个人笔记、论文衍生笔记和 AI 产物各有归属。连接的 Obsidian Vault 等外部目录集中在 extern 下，并保留原有层次。",
    tip: "输入 [[ 可以引用另一份资料；Markdown 默认边读边编辑，并在停顿后保存。" },
  { id: "search", title: "从这里找回任何线索", target: '[data-tour="global-search"]',
    description: "顶部搜索框可以查找文献、笔记、批注和正文。结合标签、文件格式与正则表达式，逐步缩小结果范围。",
    tip: "Ctrl+Shift+F 打开全局搜索；点击结果跳到原文匹配处。" },
  { id: "settings", title: "让 Liteasy 适合你的习惯", page: "settings", target: '[data-tour-page="settings"]',
    description: "设置按用途分类，也可以直接搜索。先选择界面与阅读字体、深浅主题和数据目录；使用 AI 前，在“AI 与助手”中配置可用模型。",
    tip: "本地阅读不需要 API key。保存并测试模型会发出真实请求，导览本身不会调用 AI。" },
  { id: "assistant", title: "从一个具体问题开始对话", page: "assistant", target: '[data-tour="assistant-composer"]',
    description: "在右侧输入问题，通过模型选择器切换模型。思考强度按钮中可以同时调整回答速度、严谨程度和系统提示词。",
    tip: "小环显示上下文占用；悬停可以查看已用 tokens 和上限。" },
  { id: "context", title: "明确告诉 AI 看什么", target: '[data-tour="add-context"]',
    description: "点击添加上下文，选择文件、论文或笔记片段；也可以从文献库直接拖进输入框，或输入 @ 搜索。正文中会插入资料名称。",
    tip: "先加资料，再问“请解释这段内容”。需要薄读、提纲或 PPT 时，使用顶栏 AI 工作台。" },
  { id: "runs", title: "查看工作进度与结果", page: "workflow-runs", target: '[data-tour-page="workflow-runs"]',
    description: "下方运行记录集中展示工作流的步骤、状态和结果。左侧产物库用于查找已经生成的内容，方便回到相关论文继续整理。",
    tip: "面板右上角的收起按钮只隐藏面板。需要时，从活动栏重新打开。" },
  { id: "finish", title: "准备好了，开始你的第一次阅读", page: "help", article: "getting-started.basics", target: '[data-tour="replay"]',
    description: "导览结束后，文献库、阅读区、AI 与运行记录会保持展开。点击文献库导入一份资料，按手册中的第一条路线试一试。",
    tip: "按 F1 打开手册，点击播放按钮，随时重新观看这段导览。" },
];

const tourPages: Partial<Record<DockRegionId, DockItemId[]>> = {
  left: ["library", "notes", "artifact-library"], main: ["help", "settings"], right: ["assistant"], bottom: ["workflow-runs"],
};

/** A complete, predictable teaching layout; retain existing tabs and split regions. */
export function createOnboardingLayout(current: DockLayout): DockLayout {
  const moved = new Set(Object.values(tourPages).flat());
  const regions = Object.fromEntries(Object.entries(current.regions).map(([id, region]) => {
    const items = [...(tourPages[id as DockRegionId] ?? []), ...region.itemIds.filter(item => !moved.has(item))];
    return [id, { itemIds: items, activeItemId: tourPages[id as DockRegionId]?.[0] ?? (region.activeItemId && items.includes(region.activeItemId) ? region.activeItemId : items[0] ?? null) }];
  })) as DockLayout["regions"];
  return { ...current, regions,
    horizontalOrder: ["left", "main", "right", ...current.horizontalOrder.filter(id => !["left", "main", "right"].includes(id))],
    bottomOrder: ["bottom", ...current.bottomOrder.filter(id => id !== "bottom")], regionWidths: {},
  };
}

export type TourRect = { left: number; top: number; width: number; height: number };
export function placeTourCard(target: TourRect | null, card: { width: number; height: number }, viewport: { width: number; height: number }) {
  const gap = 20, margin = 12;
  const maxLeft = Math.max(margin, viewport.width - card.width - margin);
  const maxTop = Math.max(margin, viewport.height - card.height - margin);
  if (!target) return { left: Math.max(margin, (viewport.width - card.width) / 2), top: Math.max(margin, (viewport.height - card.height) / 2) };
  const candidates = [
    { left: target.left + target.width + gap, top: Math.max(margin, Math.min(target.top, maxTop)) },
    { left: target.left - card.width - gap, top: Math.max(margin, Math.min(target.top, maxTop)) },
    { left: Math.max(margin, Math.min(target.left, maxLeft)), top: target.top + target.height + gap },
    { left: Math.max(margin, Math.min(target.left, maxLeft)), top: target.top - card.height - gap },
  ];
  return candidates.find(p => p.left >= margin && p.left <= maxLeft && p.top >= margin && p.top <= maxTop)
    ?? { left: maxLeft, top: maxTop };
}
