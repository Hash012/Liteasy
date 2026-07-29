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

test("keeps generation progress visible and prevents duplicate branch starts", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-progress-fixture");

  await expect(page.getByText("核验薄读证据", { exact: true })).toBeVisible();
  await expect(page.getByText("正在核验句级证据映射", { exact: true })).toBeVisible();
  const progressbar = page.getByRole("progressbar", { name: "薄读 Agent 进度" });
  await expect(progressbar).toHaveAttribute("aria-valuenow", "64");
  await expect(page.getByLabel("待展开板块").getByRole("button").first()).toBeDisabled();
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

test("keeps mobile selection actions visible and saves an annotation", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
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

  const popover = page.locator(".thin-reading__selection-popover");
  await expect(popover).toBeVisible();
  const popoverBox = await popover.boundingBox();
  expect(popoverBox?.x).toBeGreaterThanOrEqual(0);
  expect((popoverBox?.x ?? 0) + (popoverBox?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(popoverBox?.y).toBeGreaterThanOrEqual(0);
  expect((popoverBox?.y ?? 0) + (popoverBox?.height ?? 0)).toBeLessThanOrEqual(844);

  await page.getByRole("textbox", { name: "批注" }).fill("移动端选区批注");
  await page.getByRole("button", { exact: true, name: "保存批注" }).click();
  await expect(page.getByText("移动端选区批注", { exact: true })).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
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

test("keeps external source prose selectable for annotation and deeper reading", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-external-fixture");
  const source = page.getByRole("link", {
    exact: true,
    name: "Highly accurate protein structure prediction with AlphaFold"
  });

  await source.evaluate((element) => {
    const textNode = element.firstChild;
    if (!textNode) {
      throw new Error("External source fixture has no selectable title text.");
    }
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(16, textNode.textContent?.length ?? 0));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  await expect(page.getByLabel("深入提示（可选）")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "批注" })).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "深入" })).toBeVisible();

  const navigationPrevented = await source.evaluate((element) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(navigationPrevented).toBe(true);
});

test("loads the bundled OCR language data in the browser and extracts a scanned PDF", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/?thin-reading-ocr-fixture");
  const fixture = page.getByTestId("ocr-browser-fixture");

  await expect(fixture).toContainText("Liteasy scanned evidence OCR must preserve this sentence.", {
    timeout: 90_000
  });
  await expect(fixture).not.toContainText("OCR failed:");
});

test("keeps a real PDF evidence overlay aligned after zooming", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-reader-evidence-fixture");
  const evidence = page.getByLabel(/Agent 引用证据高亮：第 1 页/).first();
  const canvas = page.getByLabel("PDF.js 页面画布 1", { exact: true });
  await expect(evidence).toBeVisible({ timeout: 90_000 });
  const canvasWidthBefore = await canvas.evaluate((element) => element.getAttribute("width"));
  const before = await evidence.evaluate((element) => ({
    height: element.getAttribute("style")?.match(/height:\s*([^;]+)/)?.[1],
    left: element.getAttribute("style")?.match(/left:\s*([^;]+)/)?.[1],
    top: element.getAttribute("style")?.match(/top:\s*([^;]+)/)?.[1],
    width: element.getAttribute("style")?.match(/width:\s*([^;]+)/)?.[1]
  }));

  await page.getByRole("button", { name: "放大 PDF 页面" }).click();
  await expect(page.getByText("显示比例 110%", { exact: true })).toBeVisible();
  await expect.poll(async () => canvas.evaluate((element) => element.getAttribute("width")))
    .not.toBe(canvasWidthBefore);
  await expect(evidence).toBeVisible({ timeout: 90_000 });
  const after = await evidence.evaluate((element) => ({
    height: element.getAttribute("style")?.match(/height:\s*([^;]+)/)?.[1],
    left: element.getAttribute("style")?.match(/left:\s*([^;]+)/)?.[1],
    top: element.getAttribute("style")?.match(/top:\s*([^;]+)/)?.[1],
    width: element.getAttribute("style")?.match(/width:\s*([^;]+)/)?.[1]
  }));
  for (const key of ["height", "left", "top", "width"] as const) {
    expect(Math.abs(Number.parseFloat(after[key] ?? "NaN") - Number.parseFloat(before[key] ?? "NaN"))).toBeLessThan(0.1);
  }
});
