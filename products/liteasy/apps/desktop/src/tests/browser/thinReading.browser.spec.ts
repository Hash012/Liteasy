import { expect, test, type Page } from "@playwright/test";
import { createCanvas, loadImage } from "@napi-rs/canvas";

async function mountPageRecommendationGraphFixture(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="page-recommendation-graph-fixture"></div>';
    const fixtureModuleUrl = "/src/tests/fixtures/pageRecommendationGraphBrowserFixture.tsx";
    const fixtureModule = await import(fixtureModuleUrl);
    await fixtureModule.mountPageRecommendationGraphFixture(
      document.getElementById("page-recommendation-graph-fixture")
    );
  });
}

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

async function mountThinReadingBrowserFixture(page: Page, options: Record<string, boolean> = {}) {
  await page.goto("/");
  await page.evaluate(async (fixtureOptions) => {
    // Match the production app root so full-page layout baselines retain its viewport height.
    document.body.innerHTML = '<div id="root"></div>';
    const fixtureModule = await import("/src/tests/fixtures/visualizationFixtures.ts");
    fixtureModule.mountThinReadingBrowserFixture(
      document.getElementById("root"),
      fixtureOptions
    );
  }, options);
}

async function mountOcrBrowserFixture(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="ocr-browser-fixture-root"></div>';
    const fixtureModule = await import("/src/tests/fixtures/visualizationFixtures.ts");
    fixtureModule.mountOcrBrowserFixture(document.getElementById("ocr-browser-fixture-root"));
  });
}

async function mountReaderEvidenceBrowserFixture(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="reader-evidence-browser-fixture-root"></div>';
    const fixtureModule = await import("/src/tests/fixtures/visualizationFixtures.ts");
    fixtureModule.mountReaderEvidenceBrowserFixture(document.getElementById("reader-evidence-browser-fixture-root"));
  });
}

async function openPageRecommendationGraph(page: Page) {
  const recommendations = page.getByRole("button", { name: "相关推荐" });
  await expect(recommendations).toHaveAttribute("aria-pressed", "false");
  await recommendations.click();
  await expect(page.locator(".thin-reading__anchor").first()).toBeVisible();
  await expect(page.getByText("概念标记已显示", { exact: true })).toBeVisible();
  await recommendations.click();
  await expect(page.getByRole("region", { exact: true, name: "页级关联图" })).toBeVisible();
  return recommendations;
}

async function graphGeometry(page: Page) {
  return page.evaluate(() => {
    type Point = { x: number; y: number };
    type Rectangle = { bottom: number; left: number; right: number; top: number };
    const point = (values: string): Point => {
      const [x = 0, y = 0] = values.trim().split(/[ ,]+/u).map(Number);
      return { x, y };
    };
    const endpoints = (path: SVGPathElement) => {
      const d = path.getAttribute("d") ?? "";
      const match = d.match(/^M\s*([\d.+-]+[ ,]+[\d.+-]+).*?([\d.+-]+[ ,]+[\d.+-]+)\s*$/u);
      if (!match) throw new Error(`Cannot read association edge endpoints: ${d}`);
      return { end: point(match[2]!), start: point(match[1]!) };
    };
    const orientation = (a: Point, b: Point, c: Point) =>
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const intersects = (a: Point, b: Point, c: Point, d: Point) =>
      orientation(a, b, c) * orientation(a, b, d) < 0 &&
      orientation(c, d, a) * orientation(c, d, b) < 0;
    const primary = [...document.querySelectorAll<SVGPathElement>(
      '.association-edge.is-primary.is-hit[data-edge-layer="edge-hit"]'
    )].map((path) => ({ id: path.dataset.edgeId ?? "", ...endpoints(path) }));
    let primaryCrossings = 0;
    for (let index = 0; index < primary.length; index += 1) {
      for (let other = index + 1; other < primary.length; other += 1) {
        const left = primary[index]!;
        const right = primary[other]!;
        if (left.id.split(":")[1] === right.id.split(":")[1]) continue;
        if (intersects(left.start, left.end, right.start, right.end)) primaryCrossings += 1;
      }
    }
    const anchorIds = [...document.querySelectorAll<HTMLElement>("[data-anchor-id]")]
      .map((anchor) => anchor.dataset.anchorId!)
      .filter((anchorId, index, all) => all.indexOf(anchorId) === index);
    const sideByAnchor = new Map<string, Set<number>>();
    for (const edge of primary) {
      const anchorId = anchorIds.find((candidate) => edge.id.startsWith(`primary:${candidate}:`));
      if (!anchorId) throw new Error(`Cannot identify anchor for ${edge.id}`);
      const side = Math.sign(edge.end.x - edge.start.x);
      const sides = sideByAnchor.get(anchorId) ?? new Set<number>();
      if (side !== 0) sides.add(side);
      sideByAnchor.set(anchorId, sides);
    }
    const sameSideViolations = [...sideByAnchor.values()].filter((sides) => sides.size > 1).length;
    const fullPaperRect = (node: HTMLElement) => {
      const resting = node.getBoundingClientRect();
      const centreX = resting.left + resting.width / 2;
      const centreY = resting.top + resting.height / 2;
      const width = Math.max(resting.width, 152);
      const height = Math.max(resting.height, 100);
      return {
        bottom: centreY + height / 2,
        height,
        left: centreX - width / 2,
        right: centreX + width / 2,
        top: centreY - height / 2,
        width
      };
    };
    const boxNodes = [...document.querySelectorAll<HTMLElement>(".association-node")];
    const boxes = boxNodes.map(fullPaperRect);
    const overlap = (a: Rectangle, b: Rectangle) =>
      a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    let nodeOverlaps = 0;
    const overlapPairs: string[] = [];
    for (let index = 0; index < boxes.length; index += 1) {
      for (let other = index + 1; other < boxes.length; other += 1) {
        if (overlap(boxes[index]!, boxes[other]!)) {
          nodeOverlaps += 1;
          overlapPairs.push(`${boxNodes[index]!.textContent}:${JSON.stringify(boxes[index])}|${
            boxNodes[other]!.textContent
          }:${JSON.stringify(boxes[other])}`);
        }
      }
    }
    const realAnchors = [...document.querySelectorAll<HTMLElement>(".thin-reading__anchor[data-anchor-id]")];
    const graphChips = [...document.querySelectorAll<HTMLElement>(".association-anchor__chip")];
    const anchorObstructions = boxes.reduce((count, box) => count + graphChips.filter((chip) =>
      overlap(box, chip.getBoundingClientRect())).length, 0);
    const anchorDrift = Math.max(0, ...graphChips.map((chip, index) => {
      const original = realAnchors[index]?.getBoundingClientRect();
      if (!original) return Number.POSITIVE_INFINITY;
      const chipRect = chip.getBoundingClientRect();
      return Math.hypot(chipRect.left - original.left,
        chipRect.top + chipRect.height / 2 - (original.top + original.height / 2));
    }));
    const graphElement = document.querySelector<HTMLElement>(".association-layer")!;
    const graph = graphElement.getBoundingClientRect();
    const textOverflow = [...document.querySelectorAll<HTMLElement>(
      ".association-node:not(.is-dot) strong, .association-legend span, .thin-reading__mode-state"
    )].filter((element) => {
      const child = element.getBoundingClientRect();
      const parent = element.parentElement!.getBoundingClientRect();
      return child.left < parent.left - 1 || child.right > parent.right + 1 ||
        child.top < parent.top - 1 || child.bottom > parent.bottom + 1;
    }).length;
    const outsideGraph = [...document.querySelectorAll<HTMLElement>(".association-node")]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < graph.left - 1 || rect.right > graph.right + 1 ||
          rect.top < graph.top - 1 || rect.bottom > graph.bottom + 1;
      }).length;
    return {
      anchorDrift,
      anchorObstructions,
      candidateHard: [
        graphElement.dataset.candidateCrossings,
        graphElement.dataset.candidateSameSide,
        graphElement.dataset.candidateNodeOverlaps,
        graphElement.dataset.candidateOverflow,
        graphElement.dataset.candidateAnchorObstructions
      ].join("/"),
      layoutPrimaryCrossings: Number(graphElement.dataset.primaryEdgeCrossings),
      layoutSameSideViolations: Number(graphElement.dataset.sameSideViolations),
      layoutSource: graphElement.dataset.layoutSource,
      nodeOverlaps,
      overlapPairs,
      outsideGraph,
      primaryCrossings,
      sameSideViolations,
      stressNoWorse: Number(graphElement.dataset.candidateStress) <=
        Number(graphElement.dataset.baselineStress) + Number.EPSILON,
      textOverflow
    };
  });
}

test("keeps thin-reading prose and evidence markers readable on desktop", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await mountThinReadingBrowserFixture(page);
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
  await mountThinReadingBrowserFixture(page);
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
  await mountThinReadingBrowserFixture(page, { generationProgress: true });

  await expect(page.getByText("核验薄读证据", { exact: true })).toBeVisible();
  await expect(page.getByText("正在核验句级证据映射", { exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "LLM 实时工作窗口" })).toBeVisible();
  const progressbar = page.getByRole("progressbar", { name: "薄读 Agent 进度" });
  await expect(progressbar).toHaveAttribute("aria-valuenow", "64");
  await expect(page.getByRole("button", { name: "查看已生成的下一层页面" })).toBeDisabled();
});

test("opens deepen and annotation controls for a selected summary passage", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await mountThinReadingBrowserFixture(page);
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
  await mountThinReadingBrowserFixture(page);
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
  await mountThinReadingBrowserFixture(page);
  await expect(page.locator(".thin-reading__intuecho")).toHaveCount(1);
  await expect(page.getByText("连接 Intuecho 社区后显示共享批注推荐", { exact: true })).toBeVisible();
});

test("switches thin-reading graph forms and reclaims the collapsed recommendation column", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await mountThinReadingBrowserFixture(page);

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
  await mountThinReadingBrowserFixture(page, { deepMindMap: true });
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
  await mountThinReadingBrowserFixture(page, { external: true });
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
  await mountOcrBrowserFixture(page);
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
          ordered: Boolean(visual && proseRegion && source && visual.bottom <= proseRegion.top && proseRegion.bottom <= source.top),
          overlaps: overlap(visual, proseRegion) || overlap(proseRegion, source) || overlap(visual, source),
          regions
        };
      });
      expect(geometry.ordered).toBe(true);
      expect(geometry.overlaps).toBe(false);
      await expect(visuals.locator('[data-testid="visualization-artifact-stage"]')).toHaveCount(1);
      await expect(sourceFigures.locator(".thin-reading__figure-embed")).toHaveCount(2);

      const toggle = page.getByRole("switch", { name: "多模态" });
      await expect(toggle).toBeChecked();
      await toggle.click();
      await expect(toggle).not.toBeChecked();

      const firstSourceFigure = sourceFigures.locator(".thin-reading__figure-embed").first();
      const wholeFigure = firstSourceFigure.getByRole("button", { name: "深入整图" });
      await expect(wholeFigure).toBeVisible();
      await wholeFigure.click();
      const regionTrigger = firstSourceFigure.getByRole("button", { name: "选择区域" });
      await regionTrigger.click();
      const regionForm = page.getByLabel("区域坐标");
      await expect(regionForm).toBeVisible();
      await page.getByRole("spinbutton", { name: "x" }).fill("10");
      await page.getByRole("spinbutton", { name: "y" }).fill("20");
      await page.getByRole("spinbutton", { name: "width" }).fill("30");
      await page.getByRole("spinbutton", { name: "height" }).fill("40");
      const regionAction = page.getByRole("button", { name: "深入此区域" });
      await regionAction.focus();
      await page.keyboard.press("Enter");
      await expect(regionForm).not.toBeVisible();

      const objectAction = page.getByRole("button", { name: "深入 Start" });
      await expect(objectAction).toBeVisible();
      await objectAction.click();
      await expect.poll(async () => page.evaluate(() => (
        (window as unknown as { __liteasyThinReadingTargets?: unknown[] }).__liteasyThinReadingTargets?.length ?? 0
      ))).toBe(3);
      const sources = await page.evaluate(() => (
        (window as unknown as { __liteasyThinReadingTargets?: Array<{ kind: string; target: Record<string, unknown> }> }).__liteasyThinReadingTargets ?? []
      ));
      expect(sources[0]).toEqual({
        kind: "visualization_target",
        target: { evidenceIds: ["evidence-attention-self-attention"], kind: "source_figure", nodeId: expect.any(String), sourceFigureId: "figure-a" }
      });
      expect(sources[1]).toEqual(expect.objectContaining({
        kind: "visualization_target",
        target: expect.objectContaining({ evidenceIds: ["evidence-attention-self-attention"], kind: "source_region", nodeId: expect.any(String), sourceFigureId: "figure-a", sourcePixelSize: { height: 1, width: 1 } })
      }));
      const region = sources[1]?.target.bbox as { height: number; width: number; x: number; y: number };
      expect(region.x).toBeCloseTo(0.1);
      expect(region.y).toBeCloseTo(0.2);
      expect(region.width).toBeCloseTo(0.3);
      expect(region.height).toBeCloseTo(0.4);
      expect(sources[2]).toEqual({
        kind: "visualization_target",
        target: { artifactId: "viz-fixture", evidenceClaimIds: ["thin-reading-claim-attention-core"], kind: "generated_object", nodeId: expect.any(String), objectId: "start", objectPath: ["start"] }
      });
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
  await mountReaderEvidenceBrowserFixture(page);
  await expect(page.getByRole("main", { name: "PDF evidence browser fixture" })).toBeVisible();
  await expect(page.locator('.pdf-reader[data-pdf-source^="http"]')).toBeVisible();
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
  await mountReaderEvidenceBrowserFixture(page);
  await expect(page.getByRole("main", { name: "PDF evidence browser fixture" })).toBeVisible();
  await expect(page.locator('.pdf-reader[data-pdf-source^="http"]')).toBeVisible();
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

test.describe("page recommendation graph", () => {
  test("cycles through marks and a verified page-wide ink graph with keyboard return", async ({ page }, testInfo) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await mountPageRecommendationGraphFixture(page);
    const recommendations = await openPageRecommendationGraph(page);
    const graph = page.getByRole("region", { exact: true, name: "页级关联图" });

    await expect(graph.locator(".association-anchor__chip")).toHaveCount(5);
    await expect(graph.locator(".association-node")).toHaveCount(10);
    await expect(graph.locator(".association-node.is-crossing")).toHaveCount(1);
    await expect(graph.locator(".association-node.is-crossing")).not.toHaveClass(/is-dot/u);
    await expect(graph.locator(".association-node.is-crossing .association-node__crossing")).toBeVisible();
    await expect(graph.locator(".association-edge.is-paper-relation.is-ink")).toHaveCount(2);
    await expect(graph.locator('.association-edge.is-paper-relation.is-hit[role="img"]')).toHaveCount(2);
    await expect(graph.getByRole("img", { name: /直接引用/u })).toHaveCount(1);
    await expect(graph.getByRole("img", { name: /共享参考文献/u })).toHaveCount(1);

    const legend = graph.getByLabel("当前关系图例");
    await expect(legend).toContainText("作者亲引");
    await expect(legend).toContainText("引用图推导");
    await expect(legend).toContainText("语义相似，无引用关系");
    await expect(legend).toContainText("直接引用");
    await expect(legend).toContainText("共享参考文献");

    const geometry = await graphGeometry(page);
    expect(geometry).toEqual({
      anchorDrift: expect.any(Number),
      anchorObstructions: 0,
      layoutPrimaryCrossings: 0,
      candidateHard: "0/0/0/0/0",
      layoutSameSideViolations: 0,
      layoutSource: "constrained",
      nodeOverlaps: 0,
      overlapPairs: [],
      outsideGraph: 0,
      primaryCrossings: 0,
      sameSideViolations: 0,
      stressNoWorse: true,
      textOverflow: 0
    });
    expect(geometry.anchorDrift).toBeLessThan(14);

    const ink = await graph.locator(".association-layer__edges").screenshot({ omitBackground: true });
    const decodedInk = await loadImage(ink);
    const inkCanvas = createCanvas(decodedInk.width, decodedInk.height);
    const inkContext = inkCanvas.getContext("2d");
    inkContext.drawImage(decodedInk, 0, 0);
    let nonTransparentInkPixels = 0;
    const pixels = inkContext.getImageData(0, 0, decodedInk.width, decodedInk.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index]! > 8) nonTransparentInkPixels += 1;
    }
    expect(nonTransparentInkPixels).toBeGreaterThan(100);

    const firstEdge = graph.locator('.association-edge.is-hit[data-edge-layer="edge-hit"]').first();
    await firstEdge.focus();
    await expect(firstEdge).toBeFocused();
    await page.keyboard.press("ArrowRight");
    const secondEdge = graph.locator('.association-edge.is-hit[data-edge-layer="edge-hit"]').nth(1);
    await expect(secondEdge).toBeFocused();
    await expect(secondEdge).toHaveAttribute("tabindex", "0");

    const paper = page.getByRole("button", { name: /核心方法的原始定义与理论依据/u });
    await paper.focus();
    await paper.click();
    const readingCard = page.getByLabel("关联论文：核心方法的原始定义与理论依据");
    await expect(readingCard).toBeVisible();
    await expect(page.getByRole("button", { name: "返回关联图" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(readingCard).toHaveCount(0);
    await expect(paper).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(graph).toHaveCount(0);
    await expect(page.getByText("概念标记已显示", { exact: true })).toBeVisible();
    await expect(recommendations).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByText("相关推荐未展开", { exact: true })).toBeVisible();
    await expect(recommendations).toHaveAttribute("aria-pressed", "false");

    await recommendations.click();
    await recommendations.click();
    await recommendations.click();
    await expect(page.getByRole("region", { exact: true, name: "页级关联图" })).toHaveCount(0);
    await expect(page.locator(".thin-reading__body")).toHaveClass(/is-marks-hidden/u);

    await testInfo.attach("page-recommendation-graph-desktop", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png"
    });
  });

  for (const viewport of [
    { height: 900, name: "narrow", width: 760 },
    { height: 844, name: "mobile", width: 390 }
  ]) {
    test(`keeps graph geometry and text contained on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ height: viewport.height, width: viewport.width });
      await mountPageRecommendationGraphFixture(page);
      await openPageRecommendationGraph(page);
      const geometry = await graphGeometry(page);
      expect(geometry).toEqual({
        anchorDrift: expect.any(Number),
        anchorObstructions: 0,
        layoutPrimaryCrossings: 0,
        candidateHard: "0/0/0/0/0",
        layoutSameSideViolations: 0,
        layoutSource: "constrained",
        nodeOverlaps: 0,
        overlapPairs: [],
        outsideGraph: 0,
        primaryCrossings: 0,
        sameSideViolations: 0,
        stressNoWorse: true,
        textOverflow: 0
      });
      expect(geometry.anchorDrift).toBeLessThan(14);
      const sharedPaper = page.locator(".association-node.is-crossing");
      await expect(sharedPaper).not.toHaveClass(/is-dot/u);
      await expect(sharedPaper.locator(".association-node__crossing")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (viewport.name === "mobile") {
        const compactNodes = page.locator(".association-node.is-dot");
        const compactCount = await compactNodes.count();
        let compactIndex = 0;
        let furthestRight = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < compactCount; index += 1) {
          const box = await compactNodes.nth(index).boundingBox();
          if (box && box.x > furthestRight) {
            compactIndex = index;
            furthestRight = box.x;
          }
        }
        const compactNode = compactNodes.nth(compactIndex);
        await expect(compactNode).toBeVisible();
        const scroller = page.locator(".thin-reading");
        const scrollLeftBefore = await scroller.evaluate((element) => element.scrollLeft);
        for (let step = 0; step < 30; step += 1) {
          await page.keyboard.press("Tab");
          if (await compactNode.evaluate((node) => document.activeElement === node)) break;
        }
        await expect(compactNode).toBeFocused();
        const scrollLeftAfter = await scroller.evaluate((element) => element.scrollLeft);
        expect(scrollLeftAfter).toBeGreaterThan(scrollLeftBefore);
        await expect(compactNode.locator("strong")).toBeVisible();
        const containment = await compactNode.evaluate((node) => {
          const title = node.querySelector("strong")!.getBoundingClientRect();
          const card = node.getBoundingClientRect();
          const scroller = node.closest(".thin-reading")!.getBoundingClientRect();
          return card.left >= scroller.left - 1 && card.right <= scroller.right + 1 &&
            title.left >= card.left - 1 && title.right <= card.right + 1 &&
            title.top >= card.top - 1 && title.bottom <= card.bottom + 1;
        });
        expect(containment).toBe(true);
        expect(await page.locator(".thin-reading").evaluate((element) =>
          element.scrollWidth > element.clientWidth)).toBe(true);
      }
      await testInfo.attach(`page-recommendation-graph-${viewport.name}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png"
      });
    });
  }
});
