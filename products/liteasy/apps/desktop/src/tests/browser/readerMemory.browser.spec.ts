import { expect, test } from "@playwright/test";

function longPdf(count: number) {
  const text = "BT /F1 18 Tf 60 700 Td (A readable long document.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${5 + i} 0 R`).join(" ")}] /Count ${count} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    ...Array.from({ length: count }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>"),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test.use({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
test("long PDFs release distant pages while a Vault lists metadata and opens only the selected Markdown", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => {
      const vault = await (await navigator.storage.getDirectory()).getDirectoryHandle("Large Vault", { create: true });
      for (let i = 0; i < 300; i++) {
        const writer = await (await vault.getFileHandle(`note-${String(i).padStart(3, "0")}.md`, { create: true })).createWritable();
        await writer.write(`# Note ${i}\n\n` + "Research content.\n\n".repeat(5000)); await writer.close();
      }
      const config = await vault.getDirectoryHandle(".obsidian", { create: true });
      const writer = await (await config.getFileHandle("workspace.json", { create: true })).createWritable();
      await writer.write(JSON.stringify({ main: { type: "leaf", state: { type: "markdown", state: { file: "note-000.md", mode: "source" } } } })); await writer.close();
      return vault;
    } });
    const original = FileSystemFileHandle.prototype.getFile;
    const reads: string[] = []; Object.assign(window, { vaultBodyReads: reads });
    FileSystemFileHandle.prototype.getFile = function () { if (this.name.endsWith(".md")) reads.push(this.name); return original.call(this); };
  });
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: longPdf(180), contentType: "application/pdf" }));
  await page.goto("/?pdf-highlight-fixture");
  const pageOne = page.locator('.pdf-page-shell[data-page="1"]');
  await expect(pageOne.locator(".pdf-text-layer")).toContainText("readable");
  const liveCanvases = () => page.locator(".pdf-page-canvas").evaluateAll((nodes) => nodes.filter((node) => (node as HTMLCanvasElement).width > 1).length);
  expect(await liveCanvases()).toBeLessThanOrEqual(6);
  const input = page.getByLabel("当前页码"); await input.fill("170"); await input.press("Enter");
  await expect(page.locator('.pdf-page-shell[data-page="170"] .pdf-text-layer')).toContainText("readable");
  await expect.poll(() => pageOne.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBe(0);
  expect(await liveCanvases()).toBeLessThanOrEqual(6);
  await page.getByRole("navigation", { name: "左边栏导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await notes.getByRole("button", { name: "连接文件夹 / Obsidian Vault", exact: true }).click();
  await expect(notes.getByRole("button", { name: "查看笔记 note-000.md", exact: true })).toBeVisible({ timeout: 45_000 });
  expect(await page.evaluate(() => (window as unknown as { vaultBodyReads: string[] }).vaultBodyReads)).toEqual([]);
  await expect(notes.getByRole("listitem")).toHaveCount(100);
  await notes.getByRole("button", { name: "查看笔记 note-000.md", exact: true }).click();
  const editor = page.getByRole("region", { name: "Markdown 文件阅读与编辑" });
  await expect(editor).toContainText("Research content.");
  await expect(editor.getByRole("status").filter({ hasText: "Obsidian" })).toBeVisible();
  await editor.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Markdown 源码" })).toBeEditable();
  expect(await page.evaluate(() => [...new Set((window as unknown as { vaultBodyReads: string[] }).vaultBodyReads)])).toEqual(["note-000.md"]);
  expect(errors).toEqual([]);
});
