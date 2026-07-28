import { expect, test } from "@playwright/test";

test("keeps thin-reading prose and evidence markers readable on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-fixture");
  const summary = page.getByTestId("thin-reading-summary");
  const evidenceMarker = page.locator(".thin-reading__summary-sentence > sup").first();
  await expect(summary).toBeVisible();
  await expect(evidenceMarker).toBeVisible();
  await expect(page.getByRole("heading", { name: "Intuecho" })).toBeVisible();
  const fontSizes = await evidenceMarker.evaluate((marker) => {
    const summaryFontSize = Number.parseFloat(getComputedStyle(marker.closest("[data-testid='thin-reading-summary']")!).fontSize);
    const markerFontSize = Number.parseFloat(getComputedStyle(marker).fontSize);
    return { markerFontSize, summaryFontSize };
  });
  expect(fontSizes.markerFontSize).toBeLessThan(fontSizes.summaryFontSize * 0.6);
  await expect(page).toHaveScreenshot("thin-reading-desktop.png", { fullPage: true });
});

test("stacks thin-reading recommendations below prose on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?thin-reading-fixture");
  const summary = page.getByTestId("thin-reading-summary");
  const recommendation = page.getByRole("heading", { name: "Intuecho" });
  await expect(summary).toBeVisible();
  await expect(recommendation).toBeVisible();
  const summaryBox = await summary.boundingBox();
  const recommendationBox = await recommendation.boundingBox();
  expect(recommendationBox?.y).toBeGreaterThan((summaryBox?.y ?? 0) + (summaryBox?.height ?? 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot("thin-reading-mobile.png", { fullPage: true });
});

test("opens deepen and annotation controls for a selected summary passage", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-fixture");
  const summary = page.getByTestId("thin-reading-summary");
  await summary.evaluate((element) => {
    const textNode = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
    if (!textNode) {
      throw new Error("Thin-reading fixture summary has no selectable text.");
    }
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(12, textNode.textContent?.length ?? 0));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  await expect(page.getByLabel("深入提示（可选）")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "批注" })).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "深入" })).toBeVisible();
});

test("keeps Intuecho recommendation prose selectable for annotation and deeper reading", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-fixture");
  const recommendation = page.locator(".thin-reading__recommendation span").first();

  await recommendation.evaluate((element) => {
    const textNode = element.firstChild;
    if (!textNode) {
      throw new Error("Thin-reading fixture recommendation has no selectable text.");
    }
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(12, textNode.textContent?.length ?? 0));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  await expect(page.getByLabel("深入提示（可选）")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "批注" })).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "深入" })).toBeVisible();
});
