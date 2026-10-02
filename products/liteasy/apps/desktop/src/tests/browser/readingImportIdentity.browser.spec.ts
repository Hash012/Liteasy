import { expect, test } from "@playwright/test";

test("identical Markdown copies keep separate library entries and same-source reimport reuses its entry", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    localStorage.setItem("liteasy.local-literature.v1", JSON.stringify({ "papers.local_mode": true, "profile.local_enabled": true }));
  });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("/");
  const library = page.getByRole("region", { name: "本地文献库", exact: true });
  const bytes = Buffer.from("# Shared guide\n\nSynthetic evidence for independent source copies.");
  const first = { name: "copy-a.md", mimeType: "text/markdown", buffer: bytes };
  await library.getByLabel("选择文献库文件").setInputFiles([first, { ...first, name: "copy-b.md" }]);
  const files = library.getByRole("list", { name: "文献库文件" });
  await expect(files.getByRole("listitem")).toHaveCount(2);
  const search = page.getByRole("textbox", { name: "搜索文献资源" });
  for (const name of ["copy-a.md", "copy-b.md"]) {
    await search.fill(name);
    await expect(files.getByRole("listitem")).toHaveCount(1);
    await files.getByRole("button", { name: "选择文件 Shared guide", exact: true }).dblclick();
    const reader = page.getByRole("region", { name: "文件阅读器", exact: true });
    await expect(reader.getByText("Synthetic evidence for independent source copies.", { exact: true })).toBeVisible();
    await reader.getByRole("button", { name: "返回文献库", exact: true }).click();
  }
  await search.clear();
  await library.getByLabel("选择文献库文件").setInputFiles(first);
  await expect(page.getByText("已导入 0 个文件，跳过 1 个重复文件。", { exact: true })).toBeVisible();
  await expect(files.getByRole("listitem")).toHaveCount(2);
  await page.reload();
  await expect(files.getByRole("listitem")).toHaveCount(2);
});
