import { expect, test, type Page } from "@playwright/test";

async function mountThinReadingMultimodalFixture(page: Page, authorized = true) {
  await page.goto("/");
  await page.evaluate(async (isAuthorized) => {
    document.body.innerHTML = '<div id="thin-reading-multimodal-fixture"></div>';
    const fixtureModule = await import("/src/tests/fixtures/visualizationFixtures.ts");
    fixtureModule.mountThinReadingMultimodalFixture(
      document.getElementById("thin-reading-multimodal-fixture"),
      isAuthorized
    );
  }, authorized);
}

test("keeps thin-reading prose and evidence markers readable on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-fixture");
  const summary = page.getByTestId("thin-reading-summary");
  const evidenceMarker = page.locator(".thin-reading__summary-sentence > sup").first();
  await expect(summary).toBeVisible();
  await expect(evidenceMarker).toBeVisible();
  await expect(page.getByRole("button", { name: "深入了解实验" })).toBeVisible();
  await expect(page.getByRole("button", { name: "深入了解局限" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "论坛" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "论坛" })).toBeVisible();
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
  await expect(page.locator(".thin-reading__intuecho")).toHaveCount(1);
  await expect(page.getByText("连接 Intuecho 社区后显示共享批注推荐", { exact: true })).toBeVisible();
});

test("switches thin-reading graph forms and reclaims the collapsed recommendation column", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-fixture");

  await expect(page.getByText("Graph View", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "收起 Intuecho 推荐栏" }).click();
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

test.describe("thin-reading multimodal integration", () => {
  for (const viewport of [
    { height: 900, name: "desktop", width: 1440 },
    { height: 844, name: "mobile", width: 390 }
  ]) {
    test(`keeps visual, prose, and source figure regions ordered on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ height: viewport.height, width: viewport.width });
      await mountThinReadingMultimodalFixture(page);
      const visuals = page.getByTestId("thin-reading-visuals");
      const prose = page.getByTestId("thin-reading-prose");
      const sourceFigures = page.getByTestId("thin-reading-source-figures");
      await expect(visuals).toBeVisible();
      await expect(prose).toBeVisible();
      await expect(sourceFigures).toBeVisible();
      const geometry = await page.evaluate(() => {
        const regions = ["thin-reading-visuals", "thin-reading-prose", "thin-reading-source-figures"]
          .map((testId) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.getBoundingClientRect())
          .map((rect) => rect ? { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top } : null);
        const [visual, proseRegion, source] = regions;
        const overlap = (a: typeof visual, b: typeof visual) => Boolean(a && b &&
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
        return {
          ordered: Boolean(visual && proseRegion && source && visual.top <= proseRegion.top && proseRegion.top <= source.top),
          overlaps: overlap(visual, proseRegion) || overlap(proseRegion, source) || overlap(visual, source),
          regions
        };
      });
      expect(geometry.ordered).toBe(true);
      expect(geometry.overlaps).toBe(false);

      const toggle = page.getByRole("switch", { name: "多模态" });
      await expect(toggle).toBeChecked();
      await toggle.click();
      await expect(toggle).not.toBeChecked();

      const wholeFigure = page.getByRole("button", { name: "深入整图" });
      await expect(wholeFigure).toBeVisible();
      await wholeFigure.click();
      const regionTrigger = page.getByRole("button", { name: "选择区域" });
      await regionTrigger.click();
      const regionForm = page.getByLabel("区域坐标");
      await expect(regionForm).toBeVisible();
      const regionAction = page.getByRole("button", { name: "深入此区域" });
      await regionAction.focus();
      await page.keyboard.press("Enter");
      await expect(regionForm).not.toBeVisible();

      const objectAction = page.getByRole("button", { name: "深入 Start" });
      await expect(objectAction).toBeVisible();
      await objectAction.click();
      await testInfo.attach(`thin-reading-multimodal-${viewport.name}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png"
      });
    });
  }

  test("fails closed for an unauthorized multimodal capability", async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await mountThinReadingMultimodalFixture(page, false);
    const toggle = page.getByRole("switch", { name: "多模态" });
    await expect(toggle).toBeDisabled();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByTestId("thin-reading-source-figures")).toBeVisible();
  });
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

test("anchors the PDF selection menu to the real selected text", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-reader-evidence-fixture");
  const textLayer = page.locator(".pdf-text-layer").first();
  await expect.poll(async () => textLayer.evaluate((element) => element.textContent?.trim().length ?? 0), {
    timeout: 90_000
  }).toBeGreaterThan(20);

  await textLayer.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !(node.textContent?.trim())) node = walker.nextNode();
    if (!node?.textContent) throw new Error("PDF text layer has no selectable text node.");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(12, node.textContent.length));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  const menu = page.getByLabel("选中文本批注菜单");
  await expect(menu).toBeVisible();
  const selectionRect = await page.evaluate(() => {
    const range = window.getSelection()?.getRangeAt(0);
    if (!range) throw new Error("PDF selection was cleared before the menu rendered.");
    const rect = range.getBoundingClientRect();
    return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
  });
  const menuRect = await menu.boundingBox();
  expect(menuRect).not.toBeNull();
  expect(Math.abs(
    (menuRect!.x + menuRect!.width / 2) - (selectionRect.left + selectionRect.right) / 2
  )).toBeLessThan(3);
  if (await menu.evaluate((element) => element.classList.contains("is-above"))) {
    expect(menuRect!.y + menuRect!.height).toBeLessThanOrEqual(selectionRect.top - 6);
  } else {
    expect(menuRect!.y).toBeGreaterThanOrEqual(selectionRect.bottom + 6);
  }
});

test("draws the thin-reading page graph around the concepts where the prose put them", async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/?thin-reading-anchor-graph-fixture");

  const marks = page.locator(".thin-reading__anchor");
  await expect(marks).toHaveCount(5);
  await page.getByRole("button", { name: "页级关联图" }).click();

  const graph = page.getByRole("region", { exact: true, name: "页级关联图" });
  await expect(graph).toBeVisible();
  const chips = graph.locator(".association-anchor__chip");
  await expect(chips).toHaveCount(5);

  // Each chip stands where its own words are, not at a centre the layer invented.
  const drift = await page.evaluate(() => {
    const results: number[] = [];
    for (const chip of document.querySelectorAll<HTMLElement>(".association-anchor__chip")) {
      const label = chip.textContent?.trim() ?? "";
      const mark = [...document.querySelectorAll<HTMLElement>(".thin-reading__anchor")]
        .find((candidate) => candidate.textContent?.trim() === label);
      if (!mark) continue;
      const markRect = mark.getClientRects()[0];
      const chipRect = chip.getBoundingClientRect();
      results.push(Math.hypot(chipRect.left - markRect.left, chipRect.top - markRect.top));
    }
    return results;
  });
  expect(drift).toHaveLength(5);
  expect(Math.max(...drift)).toBeLessThan(14);

  // Nothing lands on another node or on the concept it belongs to.
  const collisions = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".association-node")].map((node) => node.getBoundingClientRect());
    const chipBoxes = [...document.querySelectorAll(".association-anchor__chip")].map((chip) => chip.getBoundingClientRect());
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    let count = 0;
    for (let index = 0; index < boxes.length; index += 1) {
      for (let other = index + 1; other < boxes.length; other += 1) if (hit(boxes[index], boxes[other])) count += 1;
      for (const chip of chipBoxes) if (hit(boxes[index], chip)) count += 1;
    }
    return count;
  });
  expect(collisions).toBe(0);

  await expect(graph.locator(".association-node.is-crossing")).toHaveCount(1);
  await expect(graph.locator(".association-edge.is-crossing")).toHaveCount(2);
  await testInfo.attach("thin-reading-association-graph", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });

  await chips.first().click();
  await expect(graph.locator(".association-anchor.is-dimmed")).toHaveCount(4);

  await page.getByRole("button", { name: /核心方法的原始定义与理论依据/ }).click();
  await expect(page.getByLabel("关联论文：核心方法的原始定义与理论依据")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("关联论文：核心方法的原始定义与理论依据")).not.toBeVisible();
  await expect(graph).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(graph).not.toBeVisible();
});
