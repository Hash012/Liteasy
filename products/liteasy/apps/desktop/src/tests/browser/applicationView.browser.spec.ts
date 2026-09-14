import { expect, test } from "@playwright/test";

test("application zoom and font settings persist while the frame stays inside the viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  const frame = page.locator(".app-frame");
  const root = page.locator("html");
  const expectViewportFit = async () => {
    await expect
      .poll(async () => {
        const bounds = await frame.boundingBox();
        return bounds ? Math.abs(bounds.height - 1000) : Infinity;
      })
      .toBeLessThan(2);
    await expect
      .poll(async () => (await frame.boundingBox())?.width ?? Infinity)
      .toBeLessThanOrEqual(1601);
  };
  await expectViewportFit();
  await page.keyboard.press("Control+=");
  await expect(root).toHaveCSS("zoom", "1.1");
  await expectViewportFit();
  await page.keyboard.press("Control+-");
  await expect(root).toHaveCSS("zoom", "1");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByLabel("View 显示设置", { exact: true });
  await settings
    .getByRole("combobox", { name: "显示比例", exact: true })
    .click();
  await page.getByRole("option", { name: "125%", exact: true }).click();
  await expect(root).toHaveCSS("zoom", "1.25");
  await expectViewportFit();
  const fontPicker = settings.getByRole("combobox", {
    name: "界面字号",
    exact: true,
  });
  const originalFont = await fontPicker.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize),
  );
  const assistantText = page.locator(".assistant-context-toggle");
  const originalAssistantFont = await assistantText.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize),
  );
  await fontPicker.click();
  await page.getByRole("option", { name: "大号 · 18 px", exact: true }).click();
  await expect
    .poll(() =>
      fontPicker.evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize),
      ),
    )
    .toBeGreaterThan(originalFont);
  await expect
    .poll(() =>
      assistantText.evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize),
      ),
    )
    .toBeGreaterThan(originalAssistantFont);
  await expect(root).toHaveCSS("zoom", "1.25");
  await page.screenshot({ path: testInfo.outputPath("application-view.png") });
  await page.reload();
  await expect(root).toHaveCSS("zoom", "1.25");
  await expect(frame).toHaveCSS("font-size", "18px");
  await expectViewportFit();
  await page.keyboard.press("Control+0");
  await expect(root).toHaveCSS("zoom", "1");
  await expect(frame).toHaveCSS("font-size", "18px");
  await expectViewportFit();
});

test("the PDF reader and research board retain reachable edges at 200 percent", async ({
  page,
}) => {
  const { readFile } = await import("node:fs/promises");
  const pdf = await readFile(
    new URL(
      "../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf",
      import.meta.url,
    ),
  );
  await page.route("**/manual-preview/das24a.pdf", (route) =>
    route.fulfill({ body: pdf, contentType: "application/pdf" }),
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/?pdf-highlight-fixture#importable");
  await expect(
    page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer'),
  ).not.toBeEmpty({ timeout: 30000 });
  for (let index = 0; index < 5; index++)
    await page.keyboard.press("Control+=");
  await expect(page.locator("html")).toHaveCSS("zoom", "2");
  const assertReaderBounds = async () => {
    const reader = await page.locator(".pdf-reader").boundingBox();
    const stage = await page.locator(".pdf-stage").boundingBox();
    expect(reader).not.toBeNull();
    expect(stage).not.toBeNull();
    expect(stage!.width).toBeGreaterThan(100);
    expect(stage!.height).toBeGreaterThan(100);
    expect(reader!.x + reader!.width).toBeLessThanOrEqual(1600);
    expect(stage!.x + stage!.width).toBeLessThanOrEqual(
      reader!.x + reader!.width + 2,
    );
    expect(stage!.y + stage!.height).toBeLessThanOrEqual(1000);
  };
  await assertReaderBounds();
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  const workbench = page.locator(".object-workbench");
  await expect(workbench).toBeVisible();
  const panel = await workbench.boundingBox();
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(1600);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(1000);
  await assertReaderBounds();
  const close = workbench.getByRole("button", {
    name: "关闭白板",
    exact: true,
  });
  await expect(close).toBeInViewport();
  await close.click();
  await expect(workbench).not.toBeVisible();
  await assertReaderBounds();
  await page.keyboard.press("Control+0");
  await expect(page.locator("html")).toHaveCSS("zoom", "1");
  await assertReaderBounds();
});
