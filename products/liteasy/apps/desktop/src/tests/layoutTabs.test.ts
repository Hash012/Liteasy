import { expect, test } from "vitest";
import { layoutTabs } from "../app/features/dock/layoutTabs";
for (const availableWidth of [0, 280, 420, 640, 1000]) for (const count of [2, 6, 15]) test(`budgets ${count} tabs in ${availableWidth}px without losing the active tail`, () => {
  const tabs = Array.from({ length: count }, (_, index) => ({ id: String(index), preferredWidth: index % 2 ? 280 : 180 }));
  const budget = layoutTabs({ availableWidth, utilityWidth: 76, tabs, activeId: String(count - 1) });
  expect(budget.visible.some(tab => tab.id === String(count - 1))).toBe(true);
  expect(budget.visible.reduce((sum, tab) => sum + tab.width, 0) + Math.max(0, budget.visible.length - 1) * 3).toBeLessThanOrEqual(Math.max(0, availableWidth - 76));
  expect(new Set([...budget.visible.map(tab => tab.id), ...budget.overflowIds]).size).toBe(count);
  expect(budget.visible.map(tab => Number(tab.id))).toEqual(budget.visible.map(tab => Number(tab.id)).sort((a, b) => a - b));
});
test("measured font minima and actual utility width control overflow", () => {
  const tabs = [{ id: "中文长标题", preferredWidth: 360, minimumWidth: 180 }, { id: "long English title", preferredWidth: 240, minimumWidth: 140 }, { id: "tail", preferredWidth: 220, minimumWidth: 140 }];
  expect(layoutTabs({ tabs, activeId: "tail", availableWidth: 420, utilityWidth: 60 }).visible).toHaveLength(2);
  expect(layoutTabs({ tabs, activeId: "tail", availableWidth: 420, utilityWidth: 200 }).visible.map(tab => tab.id)).toEqual(["tail"]);
});
