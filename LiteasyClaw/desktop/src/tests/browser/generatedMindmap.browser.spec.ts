import { expect, test } from "@playwright/test";

test("renders generated QVLA mind maps with hybrid columns, KaTeX, and split comparison", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?generated-mindmap-fixture");

  const root = page.locator('[data-generated-mindmap-depth="0"]').first();
  const section = page.locator('[data-generated-mindmap-depth="1"]').first();
  const formulaBranch = page.locator('[data-generated-mindmap-depth="2"]').first();
  const formulaNode = formulaBranch.locator(":scope > .genui-mindmap-node");
  await expect(root).toHaveClass(/is-horizontal/);
  await expect(section).toHaveClass(/is-horizontal/);
  await expect(formulaBranch).toHaveClass(/is-vertical/);
  await expect(formulaNode.locator(".katex").first()).toBeVisible();

  await page.getByRole("button", { name: /展开：累计动作敏感度/ }).click();
  const definition = page.locator('[data-generated-mindmap-depth="3"]').first();
  const [rootBox, sectionBox, formulaBox, definitionBox] = await Promise.all([
    root.boundingBox(),
    section.boundingBox(),
    formulaBranch.boundingBox(),
    definition.boundingBox()
  ]);
  expect(sectionBox!.x).toBeGreaterThan(rootBox!.x + 250);
  expect(formulaBox!.x).toBeGreaterThan(sectionBox!.x + 250);
  expect(Math.abs(definitionBox!.x - formulaBox!.x)).toBeLessThan(80);
  expect(definitionBox!.y).toBeGreaterThan(formulaBox!.y + 40);

  const primaryScroll = page.getByTestId("generated-mindmap-primary-scroll");
  await expect(primaryScroll).toHaveCSS("overflow-x", "auto");
  await formulaNode.dragTo(page.getByRole("region", { name: "拖到此处创建生成思维导图对照分栏" }));

  await expect(page.getByRole("region", { name: /生成思维导图对照阅读：累计动作敏感度/ })).toBeVisible();
  await expect(page.getByTestId("generated-mindmap-split-scroll")).toHaveCSS("overflow-y", "auto");
  await expect(page.locator('[data-generated-mindmap-node-id="qvla-formula"]')).toHaveCount(2);
});
