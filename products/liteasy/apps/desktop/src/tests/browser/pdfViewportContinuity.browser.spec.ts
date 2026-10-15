import { expect, test, type Page } from "@playwright/test";

function book(count: number) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${count} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (let index = 0; index < count; index++) {
    const height = index % 3 === 2 ? 1200 : 900;
    const text = Array.from({ length: 24 }, (_, line) => `BT /F1 14 Tf 40 ${height - 50 - line * 30} Td (PAGE ${index + 1} reading line ${line + 1}) Tj ET`).join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`, `<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => { const offset = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
async function open(page: Page, count: number, hash = "") {
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: book(count), contentType: "application/pdf" }));
  await page.goto(`/?pdf-highlight-fixture${hash}`);
  await expect(page.locator('.pdf-page-shell[data-page="1"] .pdf-text-layer')).toContainText("PAGE 1", { timeout: 30_000 });
}
async function go(page: Page, number: number) {
  const input = page.getByLabel("当前页码"); await input.fill(String(number)); await input.press("Enter");
  await expect(page.locator(`.pdf-page-shell[data-page="${number}"] .pdf-text-layer`)).toContainText(`PAGE ${number}`);
  await expect(input).toHaveValue(String(number));
}
const settled = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
async function offset(page: Page, number: number, readingLine = 0) {
  return page.getByLabel("PDF 页面滚动区").evaluate((stage, { number, readingLine }) => {
    const bounds = stage.querySelector(`.pdf-page-shell[data-page="${number}"]`)!.getBoundingClientRect();
    return (stage.getBoundingClientRect().top + stage.clientTop + readingLine - bounds.top) / bounds.height;
  }, { number, readingLine });
}
test.use({ viewport: { width: 1537, height: 1001 } });
test("mixed-size pages keep the reading line through zoom, resize and reopening", async ({ page }) => {
  test.setTimeout(90_000); const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await open(page, 12); await go(page, 6);
  await page.getByLabel("PDF 页面滚动区").hover(); await page.mouse.wheel(0, 1); await settled(page);
  await page.getByLabel("PDF 页面滚动区").evaluate((stage) => {
    const bounds = stage.querySelector('.pdf-page-shell[data-page="6"]')!.getBoundingClientRect();
    stage.scrollTo({ top: stage.scrollTop + bounds.top - stage.getBoundingClientRect().top + bounds.height * 0.4, behavior: "instant" });
  });
  await settled(page); const readingPoint = await offset(page, 6, 64);
  for (let index = 0; index < 8; index++) await page.getByRole("button", { name: "按比例放大 PDF", exact: true }).click();
  await expect(page.getByLabel("PDF 显示比例 140%")).toBeVisible();
  await expect.poll(async () => Math.abs(await offset(page, 6, 64) - readingPoint)).toBeLessThan(0.01);
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(async () => Math.abs(await offset(page, 6, 64) - readingPoint)).toBeLessThan(0.01);
  const savedOffset = await offset(page, 6);
  await expect.poll(() => page.evaluate(() => new Promise<number | undefined>((resolve, reject) => {
    const request = indexedDB.open("liteasy.objects.v1"); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction("records").objectStore("records").getAll();
      read.onsuccess = () => { db.close(); resolve(read.result.find((row) => row.key === "reader-state/pdf/manual-das24a-preview")?.value.topRatio); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }))).toBeCloseTo(savedOffset, 2);
  await page.reload(); await expect(page.getByLabel("当前页码")).toHaveValue("6", { timeout: 30_000 });
  await expect(page.locator('.pdf-page-shell[data-page="6"] .pdf-text-layer')).toContainText("PAGE 6");
  await expect.poll(async () => Math.abs(await offset(page, 6) - savedOffset)).toBeLessThan(0.015);
  await go(page, 10); await page.setViewportSize({ width: 1350, height: 900 });
  await expect(page.getByLabel("当前页码")).toHaveValue("10"); expect(errors).toEqual([]);
});

test("a distant target in a 180-page PDF becomes readable within the canvas budget", async ({ page }) => {
  test.setTimeout(60_000); await open(page, 180); await go(page, 170);
  await expect.poll(() => page.locator('.pdf-page-shell[data-page="1"] canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBe(0);
  expect(await page.locator(".pdf-page-canvas").evaluateAll((canvases) => canvases.filter((canvas) => (canvas as HTMLCanvasElement).width > 1).length)).toBeLessThanOrEqual(6);
  await go(page, 3); await go(page, 178); await expect(page.getByLabel("当前页码")).toHaveValue("178");
});

test("a large wheel scroll followed by resize keeps the newly visible page", async ({ page }) => {
  test.setTimeout(60_000); await open(page, 12);
  await page.getByLabel("PDF 页面滚动区").hover(); await page.mouse.wheel(0, 6000);
  const input = page.getByLabel("当前页码"); await expect(input).not.toHaveValue("1");
  const current = Number(await input.inputValue());
  const readingPoint = await offset(page, current, 64);
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(async () => Math.abs(await offset(page, current, 64) - readingPoint)).toBeLessThan(0.015);
  await expect(input).toHaveValue(String(current));
});


test("closing the reader tab and reopening from the library restores the page and offset", async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, 12, "#importable");
  await go(page, 6);
  await page.getByLabel("PDF 页面滚动区").hover(); await page.mouse.wheel(0, 1);
  await page.getByLabel("PDF 页面滚动区").evaluate((stage) => {
    const bounds = stage.querySelector('.pdf-page-shell[data-page="6"]')!.getBoundingClientRect();
    stage.scrollTo({ top: stage.scrollTop + bounds.top - stage.getBoundingClientRect().top + bounds.height * 0.4, behavior: "instant" });
  });
  await settled(page);
  const savedOffset = await offset(page, 6);
  await page.getByRole("button", { name: "关闭 das24a.pdf", exact: true }).click();
  await expect(page.getByLabel("PDF 页面滚动区")).toHaveCount(0);
  await page.getByRole("button", { name: "文献库", exact: true }).dblclick();
  await page.getByRole("button", { name: "das24a.pdf", exact: true }).dblclick();
  await expect(page.getByLabel("当前页码")).toHaveValue("6", { timeout: 30_000 });
  await expect.poll(async () => Math.abs(await offset(page, 6) - savedOffset)).toBeLessThan(0.015);
  await page.reload();
  await expect(page.getByLabel("当前页码")).toHaveValue("6", { timeout: 30_000 });
  await expect.poll(async () => Math.abs(await offset(page, 6) - savedOffset)).toBeLessThan(0.015);
});


test("closing an evidence jump consumes its target before ordinary reopening", async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, 12, "#importable");
  const editor = page.getByPlaceholder("输入你的问题或命令");
  await editor.fill("@das24a"); await editor.press("Tab");
  await page.locator(".assistant-input-highlight .resource-reference-link").click();
  const preview = page.getByLabel("引用内容预览", { exact: true });
  await expect(preview.getByRole("region", { name: "原始 PDF 预览" })).toHaveAttribute("aria-busy", "false");
  await preview.getByRole("button", { name: "下一页", exact: true }).click();
  await preview.getByRole("button", { name: "打开原文件", exact: true }).click();
  await expect(page.getByLabel("当前页码")).toHaveValue("2");
  await page.keyboard.press("Escape");
  await expect(page.locator('.pdf-page-shell[data-page="2"] .pdf-text-layer')).toContainText("PAGE 2");
  await page.getByLabel("PDF 页面滚动区").hover(); await page.mouse.wheel(0, 4000);
  await expect(page.getByLabel("当前页码")).not.toHaveValue("2");
  await settled(page);
  const savedPage = await page.getByLabel("当前页码").inputValue();
  await page.getByRole("button", { name: "关闭 das24a.pdf", exact: true }).click();
  await page.getByRole("button", { name: "文献库", exact: true }).dblclick();
  await page.getByRole("button", { name: "das24a.pdf", exact: true }).dblclick();
  await expect(page.getByLabel("当前页码")).toHaveValue(savedPage, { timeout: 30_000 });
});


test("wheel-only reading saves before a quick tab close without a page-number action", async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, 12, "#importable");
  await page.getByLabel("PDF 页面滚动区").hover(); await page.mouse.wheel(0, 5500);
  await expect(page.getByLabel("当前页码")).not.toHaveValue("1");
  const close = page.getByRole("button", { name: "关闭 das24a.pdf", exact: true });
  // Capture the visible PDF point in the actual close event. Lazy page sizing and
  // native scroll anchoring may still change geometry between Playwright commands.
  await close.evaluate(button => button.addEventListener("click", () => {
    const stage = document.querySelector<HTMLElement>('[aria-label="PDF 页面滚动区"]')!;
    const top = stage.getBoundingClientRect().top + stage.clientTop;
    const bottom = top + stage.clientHeight;
    const pages = Array.from(stage.querySelectorAll<HTMLElement>(".pdf-page-shell"), element => {
      const bounds = element.getBoundingClientRect();
      return { page: Number(element.dataset.page), offset: (top - bounds.top) / bounds.height,
        visible: Math.max(0, Math.min(bounds.bottom, bottom) - Math.max(bounds.top, top)) };
    });
    const position = pages.reduce((best, current) => current.visible > best.visible ? current : best);
    (window as Window & { closingPdfPosition?: { page: number; offset: number } }).closingPdfPosition = position;
  }, { capture: true, once: true }));
  await close.click();
  const saved = await page.evaluate(() => (window as Window & { closingPdfPosition?: { page: number; offset: number } }).closingPdfPosition!);
  expect(saved.page).toBeGreaterThan(1);
  const savedPage = String(saved.page), savedOffset = saved.offset;
  await page.getByRole("button", { name: "文献库", exact: true }).dblclick();
  await page.getByRole("button", { name: "das24a.pdf", exact: true }).dblclick();
  await expect(page.getByLabel("当前页码")).toHaveValue(savedPage, { timeout: 30_000 });
  await expect.poll(async () => Math.abs(await offset(page, Number(savedPage)) - savedOffset)).toBeLessThan(0.015);
});
