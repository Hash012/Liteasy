import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
test.use({ video: "on" });

test("PAGE-01/02: registered page 49 is the first PDF frame and expansion keeps the document", async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/src/tests/browser/fixtures/context-picker-v3.html");
  await page.getByRole("link", { name: "page-49", exact: true }).click();
  await expect(page.getByText("第 49 / 101 页", { exact: true })).toBeVisible();
  await expect(page.getByLabel("第 49 页文字")).toContainText("PHYSICAL PAGE 49");
  await page.getByRole("button", { name: "放大预览", exact: true }).click();
  await expect(page.getByLabel("第 49 页文字")).toBeVisible();
  await page.screenshot({ path: info.outputPath("02-page49-preview.png"), animations: "disabled" });
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByLabel("第 50 页文字")).toContainText("PHYSICAL PAGE 50");
  await page.getByRole("button", { name: "缩回预览", exact: true }).click();
  await expect(page.getByText("第 50 / 101 页", { exact: true })).toBeVisible();
  await page.getByRole("spinbutton", { name: "跳到物理页" }).fill("102");
  await page.getByRole("spinbutton", { name: "跳到物理页" }).press("Enter");
  await expect(page.getByRole("alert")).toContainText("超出此 PDF 的范围");
  await expect(page.locator(".source-pdf-page")).toBeHidden();
  await page.getByRole("spinbutton", { name: "跳到物理页" }).fill("50");
  await page.getByRole("spinbutton", { name: "跳到物理页" }).press("Enter");
  await expect(page.getByLabel("第 50 页文字")).toBeVisible();
  await page.getByRole("button", { name: "关闭引用预览", exact: true }).click();
  await page.getByRole("link", { name: "page-50", exact: true }).click();
  await expect(page.getByLabel("第 50 页文字")).toContainText("PHYSICAL PAGE 50");
  const evidence = await page.evaluate(() => ({ ...(window as any).contextV3.counters, trace: (window as any).contextV3.trace() }));
  expect(evidence.bytes).toBe(1);
  expect(evidence.trace.filter((event: any) => event.event === "pdf.document.open")).toHaveLength(1);
  expect(evidence.trace.filter((event: any) => event.event === "pdf.page.publish")[0].value).toBe(49);
  writeFileSync(info.outputPath("page49-trace.json"), JSON.stringify(evidence, null, 2));
});

test("STABLE-01/03: 30 seconds of new catalog objects preserve image and zoom", async ({ page }, info) => {
  test.setTimeout(60000);
  await page.goto("/src/tests/browser/fixtures/context-picker-v3.html");
  await page.getByRole("button", { name: "对象重建 开始" }).click();
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  await page.getByRole("button", { name: "全部资产", exact: true }).click();
  await page.getByRole("button", { name: "进入 未归属图片", exact: true }).click();
  await page.getByRole("button", { name: "预览 实验流程 A", exact: true }).click();
  await expect(page.getByRole("img", { name: "imageA", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "放大图片", exact: true }).click();
  const samples = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 150; i++) { await new Promise(resolve => setTimeout(resolve, 200)); const img = document.querySelector('.picker-image-stage img') as HTMLImageElement; samples.push({ loaded: img?.complete && img.naturalWidth > 0, width: img?.style.width, pending: document.querySelector('[aria-label="资产预览"] [role="status"]')?.textContent }); }
    return samples;
  });
  expect(samples.every(sample => sample.loaded && sample.width === "125%" && !sample.pending)).toBe(true);
  const evidence = await page.evaluate(() => ({ ...(window as any).contextV3.counters, trace: (window as any).contextV3.trace() }));
  await page.getByRole("button", { name: "返回对话", exact: true }).last().click();
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  await expect(page.getByRole("img", { name: "imageA", exact: true })).toBeVisible();
  expect(await page.getByRole("img", { name: "imageA", exact: true }).evaluate(img => (img as HTMLElement).style.width)).toBe("125%");
  expect(evidence.imageA).toBe(1); expect(evidence.updates).toBeGreaterThanOrEqual(150);
  writeFileSync(info.outputPath("stable-30s-trace.json"), JSON.stringify({ evidence, samples }, null, 2));
});

test("STABLE-02: late A never replaces B", async ({ page }, info) => {
  await page.goto("/src/tests/browser/fixtures/context-picker-v3.html");
  await page.waitForFunction(() => "contextV3" in window);
  await page.evaluate(() => (window as any).contextV3.slow(true));
  await page.getByRole("button", { name: "添加上下文", exact: true }).click();
  await page.getByRole("button", { name: "全部资产", exact: true }).click();
  await page.getByRole("button", { name: "进入 未归属图片", exact: true }).click();
  await page.getByRole("button", { name: "预览 实验流程 A", exact: true }).click();
  await page.getByRole("button", { name: "预览 实验流程 B", exact: true }).click();
  await expect(page.getByRole("img", { name: "imageB", exact: true })).toBeVisible();
  await page.waitForTimeout(1400);
  await expect(page.getByRole("img", { name: "imageA", exact: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "资产预览" })).toContainText("实验流程 B");
  writeFileSync(info.outputPath("race-trace.json"), JSON.stringify(await page.evaluate(() => (window as any).contextV3.trace()), null, 2));
});

for (const physical of [50, 101]) test(`PAGE-05: rotated CropBox page ${physical} preserves the source region`, async ({ page }) => {
  await page.goto("/src/tests/browser/fixtures/context-picker-v3.html");
  await page.getByRole("link", { name: `region-${physical}`, exact: true }).click();
  await expect(page.getByLabel(`第 ${physical} 页文字`)).toContainText(`PHYSICAL PAGE ${physical}`);
  const box = await page.getByLabel("来源区域", { exact: true }).boundingBox();
  const canvas = await page.getByLabel(`原始 PDF 第 ${physical} 页`, { exact: true }).boundingBox();
  expect(box).not.toBeNull(); expect(canvas).not.toBeNull();
  expect(Math.abs((box!.x - canvas!.x) / canvas!.width - .2)).toBeLessThan(.005);
  expect(Math.abs((box!.y - canvas!.y) / canvas!.height - (physical === 101 ? .8 : .3))).toBeLessThan(.005);
  expect(Math.abs(box!.width / canvas!.width - .4)).toBeLessThan(.005);
  expect(Math.abs(box!.height / canvas!.height - .1)).toBeLessThan(.005);
  await expect(page.getByLabel("来源区域", { exact: true })).toBeInViewport();
  await page.locator(".source-pdf-stage").evaluate(stage => { stage.scrollTop = 0; });
  await page.getByRole("button", { name: "回到来源", exact: true }).click();
  await expect(page.getByLabel("来源区域", { exact: true })).toBeInViewport();
});
test("STABLE-04: width changes settle without a render loop", async ({ page }, info) => {
  await page.goto("/src/tests/browser/fixtures/context-picker-v3.html");
  await page.getByRole("link", { name: "page-49", exact: true }).click();
  await expect(page.getByLabel("第 49 页文字")).toBeVisible();
  await page.getByRole("button", { name: "放大预览", exact: true }).click();
  for (const width of [1280, 1366, 1180, 1920, 1400]) { await page.setViewportSize({ width, height: 800 }); await page.waitForTimeout(100); }
  await expect(page.getByLabel("第 49 页文字")).toBeVisible();
  await page.waitForTimeout(600);
  const first = await page.evaluate(() => (window as any).contextV3.trace());
  await page.waitForTimeout(700);
  const last = await page.evaluate(() => (window as any).contextV3.trace());
  expect(last.filter((event: any) => event.event === "pdf.page.render").length).toBe(first.filter((event: any) => event.event === "pdf.page.render").length);
  writeFileSync(info.outputPath("resize-trace.json"), JSON.stringify(last, null, 2));
});
