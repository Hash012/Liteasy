import { expect, test } from "@playwright/test";

test("keeps thin-reading prose and evidence markers readable on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-fixture");
  const summary = page.getByTestId("thin-reading-summary");
  const evidenceMarker = page.locator(".thin-reading__summary-sentence > sup").first();
  await expect(summary).toBeVisible();
  await expect(evidenceMarker).toBeVisible();
  await expect(page.getByRole("button", { name: "深入了解实验" })).toBeVisible();
  await expect(page.getByRole("button", { name: "深入了解局限" })).toBeVisible();
  await page.getByRole("button", { name: "展开 Intuecho 推荐栏" }).click();
  await expect(page.getByRole("heading", { name: "Intuecho" })).toBeVisible();
  await expect(page.getByText("连接 Intuecho 社区后显示共享批注推荐", { exact: true })).toBeVisible();
  const fontSizes = await evidenceMarker.evaluate((marker) => {
    const summaryFontSize = Number.parseFloat(getComputedStyle(marker.closest("[data-testid='thin-reading-summary']")!).fontSize);
    const markerFontSize = Number.parseFloat(getComputedStyle(marker).fontSize);
    return { markerFontSize, summaryFontSize };
  });
  expect(fontSizes.markerFontSize).toBeLessThan(fontSizes.summaryFontSize * 0.6);
  await expect(page).toHaveScreenshot("thin-reading-desktop.png", { fullPage: true });
});

test("keeps the community recommendation rail visible without a configured source on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/?thin-reading-fixture");
  const summary = page.getByTestId("thin-reading-summary");
  await expect(summary).toBeVisible();
  await expect(page.getByRole("button", { name: "深入了解实验" })).toBeVisible();
  await expect(page.getByRole("button", { name: "深入了解局限" })).toBeVisible();
  await page.getByRole("button", { name: "展开 Intuecho 推荐栏" }).click();
  await expect(page.getByRole("heading", { name: "Intuecho" })).toBeVisible();
  await expect(page.getByText("连接 Intuecho 社区后显示共享批注推荐", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot("thin-reading-mobile.png", { fullPage: true });
});

test("keeps generation progress visible and prevents duplicate branch starts", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-progress-fixture");

  await expect(page.getByText("核验薄读证据", { exact: true })).toBeVisible();
  await expect(page.getByText("正在核验句级证据映射", { exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "LLM 实时工作窗口" })).toBeVisible();
  const progressbar = page.getByRole("progressbar", { name: "薄读 Agent 进度" });
  await expect(progressbar).toHaveAttribute("aria-valuenow", "64");
  await expect(page.getByRole("button", { name: "查看已生成的下一层页面" })).toBeDisabled();
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

test("renders the community recommendation empty state for the local thin-reading fixture", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-fixture");
  await page.getByRole("button", { name: "展开 Intuecho 推荐栏" }).click();
  await expect(page.locator(".thin-reading__intuecho")).toHaveCount(1);
  await expect(page.getByText("连接 Intuecho 社区后显示共享批注推荐", { exact: true })).toBeVisible();
});

test("switches thin-reading graph forms and reclaims the collapsed recommendation column", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-fixture");

  await expect(page.getByText("Graph View", { exact: true })).toHaveCount(0);
  await expect(page.locator(".thin-reading__intuecho")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "展开 Intuecho 推荐栏" })).toBeVisible();

  const collapsedLayout = await page.locator(".thin-reading__body").evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns,
    width: element.getBoundingClientRect().width
  }));
  expect(collapsedLayout.columns.trim().split(/\s+/)).toHaveLength(1);
  expect(collapsedLayout.width).toBeLessThanOrEqual(901);

  await page.getByRole("button", { name: "关系网络" }).click();
  await expect(page.getByRole("heading", { name: "薄读页面网络" })).toBeVisible();
  await page.getByRole("button", { name: "思维导图" }).click();
  await expect(page.getByRole("heading", { name: "薄读层次思维导图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "思维导图" })).toHaveAttribute("aria-pressed", "true");
  const mindmapNode = page.locator(".thin-reading__graph.is-mindmap .thin-reading__mindmap-node").first();
  await expect(mindmapNode).toBeVisible();
  expect((await mindmapNode.boundingBox())?.width).toBeGreaterThan(160);

  await page.getByRole("button", { name: "收起结构图" }).click();
  await expect(page.getByRole("group", { name: "选择薄读结构图形式" })).toBeVisible();
});

test("keeps deep mind-map branches in columns and copies a dragged subtree into a split pane", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-mindmap-fixture");
  await page.getByRole("button", { name: "思维导图" }).click();

  const depthZero = page.locator('[data-mindmap-depth="0"]').first();
  const depthOne = page.locator('[data-mindmap-depth="1"]').first();
  const depthTwo = page.locator('[data-mindmap-depth="2"]').first();
  const formulaNode = page.locator('[data-mindmap-depth="4"] > .thin-reading__mindmap-node').first();
  await expect(depthZero).toHaveClass(/is-horizontal/);
  await expect(depthOne).toHaveClass(/is-horizontal/);
  await expect(depthTwo).toHaveClass(/is-vertical/);
  await expect(formulaNode.locator(".katex").first()).toBeVisible();

  const primaryScroll = page.getByTestId("mindmap-primary-scroll");
  await expect(primaryScroll).toHaveCSS("overflow-x", "auto");
  await expect(primaryScroll).toHaveCSS("overflow-y", "auto");
  await formulaNode.dragTo(page.getByRole("region", { name: "拖到此处创建对照分栏" }));

  const split = page.getByRole("region", { name: /对照阅读：累计动作敏感度/ });
  await expect(split).toBeVisible();
  await expect(page.getByTestId("mindmap-split-scroll")).toHaveCSS("overflow-y", "auto");
  await expect(page.locator('[data-mindmap-depth="4"]')).toHaveCount(2);
});

test("keeps external source markers selectable for annotation but not deeper reading", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-external-fixture");
  const source = page.getByRole("link", {
    exact: true,
    name: "打开外部来源：Highly accurate protein structure prediction with AlphaFold"
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

  await expect(page.getByLabel("深入提示（可选）")).not.toBeVisible();
  await expect(page.getByRole("textbox", { name: "批注" })).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "深入" })).not.toBeVisible();

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

test("uses the full paper width while resolving and bounding MinerU images in source and translation", async ({ page }) => {
  await page.setViewportSize({ height: 1_000, width: 1_800 });
  await page.goto("/?paper-resource-fixture");

  const resource = page.getByRole("main", { name: /Space-efficient translation layer 提取图文版/ });
  const multimodal = page.getByRole("region", { name: "按论文原文顺序排列的图文版" });
  const sourceImage = page.getByAltText("Architecture diagram");
  await expect(resource).toBeVisible();
  await expect(sourceImage).toBeVisible();
  const initialGeometry = await page.evaluate(() => {
    const resourceElement = document.querySelector(".paper-resource-tab")!;
    const contentElement = document.querySelector(".paper-resource-tab__multimodal-list")!;
    const imageElement = document.querySelector<HTMLImageElement>(".mineru-markdown__image")!;
    const markdownElement = document.querySelector<HTMLElement>(".mineru-markdown")!;
    return {
      contentWidth: contentElement.getBoundingClientRect().width,
      imageWidth: imageElement.getBoundingClientRect().width,
      markdownWidth: markdownElement.getBoundingClientRect().width,
      resourceWidth: resourceElement.getBoundingClientRect().width,
      src: imageElement.src
    };
  });
  expect(initialGeometry.contentWidth).toBeGreaterThan(initialGeometry.resourceWidth * 0.9);
  expect(initialGeometry.markdownWidth).toBeLessThanOrEqual(780);
  expect(initialGeometry.imageWidth).toBeLessThanOrEqual(720);
  expect(initialGeometry.src).toMatch(/^data:image\/svg\+xml/);
  await expect(multimodal).toBeVisible();

  await page.getByRole("button", { name: "翻译文本" }).click();
  await page.getByRole("button", { name: "确认翻译为 中文" }).click();
  await expect(page.getByText(/中文解释内容/).first()).toBeVisible();
  await expect(page.getByAltText("Architecture diagram")).toHaveCount(2);
  const translatedGeometry = await page.locator(".paper-resource-tab__translation").evaluate((element) => ({
    borderRadius: getComputedStyle(element).borderRadius,
    resourceWidth: element.closest(".paper-resource-tab")!.getBoundingClientRect().width,
    width: element.getBoundingClientRect().width
  }));
  expect(translatedGeometry.width).toBeGreaterThan(translatedGeometry.resourceWidth * 0.9);
  expect(translatedGeometry.borderRadius).toBe("0px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("keeps legacy page-based ACORN extraction inside the viewport with hostile intrinsic widths", async ({ page }) => {
  await page.setViewportSize({ height: 1_000, width: 1_600 });
  await page.goto("/?paper-resource-fallback-fixture");

  await expect(page.getByText("第 1 页")).toBeVisible();
  const oversizedImage = page.getByAltText("Oversized ACORN figure");
  await oversizedImage.scrollIntoViewIfNeeded();
  await expect(oversizedImage).toBeVisible();

  const geometry = await page.evaluate(() => {
    const resource = document.querySelector<HTMLElement>(".paper-resource-tab")!;
    const fallbackPage = document.querySelector<HTMLElement>(".paper-resource-tab__multimodal-page")!;
    const markdown = fallbackPage.querySelector<HTMLElement>(".mineru-markdown")!;
    const image = fallbackPage.querySelector<HTMLImageElement>("figure img")!;
    const resourceRect = resource.getBoundingClientRect();
    const markdownRect = markdown.getBoundingClientRect();
    return {
      fallbackClientWidth: fallbackPage.clientWidth,
      fallbackScrollWidth: fallbackPage.scrollWidth,
      imageWidth: image.getBoundingClientRect().width,
      markdownLeft: markdownRect.left,
      markdownRight: markdownRect.right,
      markdownWidth: markdownRect.width,
      resourceClientWidth: resource.clientWidth,
      resourceLeft: resourceRect.left,
      resourceRight: resourceRect.right,
      resourceScrollWidth: resource.scrollWidth
    };
  });

  expect(geometry.resourceScrollWidth).toBeLessThanOrEqual(geometry.resourceClientWidth + 1);
  expect(geometry.fallbackScrollWidth).toBeLessThanOrEqual(geometry.fallbackClientWidth + 1);
  expect(geometry.markdownWidth).toBeLessThanOrEqual(780);
  expect(geometry.markdownLeft).toBeGreaterThanOrEqual(geometry.resourceLeft);
  expect(geometry.markdownRight).toBeLessThanOrEqual(geometry.resourceRight);
  expect(geometry.imageWidth).toBeLessThanOrEqual(720);
});
