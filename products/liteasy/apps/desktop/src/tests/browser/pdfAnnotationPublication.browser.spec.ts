import { expect, test, type Page } from "@playwright/test";

async function mountFixture(page: Page, mode: "candidate" | "manual") {
  await page.goto("/");
  await page.evaluate(async (fixtureMode) => {
    document.body.innerHTML = '<div id="pdf-annotation-publication-fixture"></div>';
    const fixtureModuleUrl = "/src/tests/fixtures/pdfAnnotationPublicationBrowserFixture.tsx";
    const fixtureModule = await import(fixtureModuleUrl);
    await fixtureModule.mountPdfAnnotationPublicationBrowserFixture(
      document.getElementById("pdf-annotation-publication-fixture"),
      fixtureMode
    );
  }, mode);
  await expect(page.getByRole("region", { name: "PDF 阅读器" })).toBeVisible();
  await expect(page.locator(".pdf-text-layer").first()).toBeVisible();
}

async function selectFixtureText(page: Page, excerpt: string) {
  await page.evaluate((text) => {
    const layer = document.querySelector(".pdf-text-layer");
    if (!layer) throw new Error("PDF text layer is unavailable");
    const span = document.createElement("span");
    span.textContent = text;
    layer.append(span);
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    layer.closest("[aria-label='PDF 页面滚动区']")?.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      clientX: 240,
      clientY: 240
    }));
  }, excerpt);
}

async function expectUsableLayout(page: Page) {
  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>(".pdf-left-sidebar")!.getBoundingClientRect();
    const stage = document.querySelector<HTMLElement>(".pdf-main-stage")!.getBoundingClientRect();
    const annotation = document.querySelector<HTMLElement>(".pdf-annotation-item")!.getBoundingClientRect();
    const overflowedText = [...document.querySelectorAll<HTMLElement>(
      ".pdf-annotation-item small, .pdf-annotation-item button, .pdf-annotation-item label"
    )].filter((element) => element.scrollWidth > element.clientWidth + 1).length;
    return {
      annotationInsideSidebar: annotation.left >= sidebar.left - 1 && annotation.right <= sidebar.right + 1,
      overflowedText,
      siblingOverlap: sidebar.right > stage.left + 1,
      viewportOverflow: document.documentElement.scrollWidth > window.innerWidth
    };
  });
  expect(layout).toEqual({
    annotationInsideSidebar: true,
    overflowedText: 0,
    siblingOverlap: false,
    viewportOverflow: false
  });
}

for (const viewport of [
  { height: 900, name: "desktop", width: 1440 },
  { height: 844, name: "narrow", width: 390 }
]) {
  test(`direct annotation publication remains usable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mountFixture(page, "candidate");
    await selectFixtureText(page, "Late interaction evidence");
    await page.getByRole("button", { name: "注释" }).click();
    await page.getByRole("checkbox", { name: /Late interaction evidence/u }).click();
    await expect(page.getByRole("dialog", { name: "确认文献身份" })).toBeVisible();
    await page.getByRole("button", { name: "选择 ColBERT" }).click();
    await expect(page.getByText("已公开到论坛")).toBeVisible();

    await page.getByRole("button", { name: /编辑批注：Late interaction evidence/u }).click();
    await page.getByRole("textbox", { name: "补充批注笔记" }).fill("Updated after publication");
    await page.getByRole("button", { name: "保存笔记" }).click();
    await expect(page.getByText("已公开到论坛")).toBeVisible();

    await page.getByRole("checkbox", { name: /Late interaction evidence/u }).click();
    await expect(page.getByText(/撤回失败，论坛仍公开/u)).toBeVisible();
    await expectUsableLayout(page);
    await page.screenshot({
      fullPage: true,
      path: `test-results/pdf-annotation-publication-${viewport.name}.png`
    });
  });

  test(`manual literature fallback remains usable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mountFixture(page, "manual");
    await selectFixtureText(page, "Manual identity evidence");
    await page.getByRole("button", { name: "注释" }).click();
    await page.getByRole("checkbox", { name: /Manual identity evidence/u }).click();
    await expect(page.getByLabel("文献标题")).toBeVisible();
    await page.getByLabel("文献标题").fill("Manually Identified Paper");
    await page.getByLabel("作者").fill("Ada Lovelace; Grace Hopper");
    await page.getByLabel("年份").fill("2026");
    await page.getByRole("button", { name: "确认文献信息" }).click();
    await expect(page.getByText("已公开到论坛")).toBeVisible();
    await expect(page.getByRole("status", { name: "文献身份来源" })).toHaveText("文献身份：手动录入");
    await expectUsableLayout(page);
  });
}
