export type TabWidthInput = { id: string; preferredWidth: number; minimumWidth?: number };
/** Only budgets the strip. It never changes tab IDs, their order, or renderer ownership. */
export function layoutTabs({ availableWidth, utilityWidth, tabs, activeId, gap = 3 }: { availableWidth: number; utilityWidth: number; tabs: readonly TabWidthInput[]; activeId?: string; gap?: number }) {
  const available = Math.max(0, (Number.isFinite(availableWidth) ? availableWidth : 0) - Math.max(0, utilityWidth));
  const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === activeId));
  const minimum = (index: number) => Math.max(1, tabs[index].minimumWidth ?? (index === activeIndex ? 120 : 88));
  const selected: number[] = tabs.length ? [activeIndex] : [];
  const priority = tabs.map((_, index) => index).filter(index => index !== activeIndex).sort((a, b) => Math.abs(a - activeIndex) - Math.abs(b - activeIndex) || a - b);
  let used = tabs.length ? Math.min(available, minimum(activeIndex)) : 0;
  for (const index of priority) { const next = minimum(index) + gap; if (used + next <= available) { selected.push(index); used += next; } }
  const widths = new Map(selected.map(index => [index, Math.min(available, minimum(index))]));
  let remaining = Math.max(0, available - used);
  for (const index of selected) {
    const width = widths.get(index)!;
    const extra = Math.min(remaining, Math.max(0, tabs[index].preferredWidth - width));
    widths.set(index, width + extra); remaining -= extra;
  }
  return { visible: selected.sort((a, b) => a - b).map(index => ({ id: tabs[index].id, width: widths.get(index)! })), overflowIds: tabs.filter((_, index) => !widths.has(index)).map(tab => tab.id) };
}
