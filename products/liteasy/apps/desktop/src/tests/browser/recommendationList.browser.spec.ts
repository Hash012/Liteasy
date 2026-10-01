import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) test(`recommendations support browsing, source details and a chosen download directory in ${theme}`, async ({ page }, testInfo) => {
  await page.route(/https:\/\/api\.(crossref|openalex|semanticscholar)\.org\//, (route) => route.fulfill({ status: 404 }));
  await page.route("https://doi.org/**", (route) => route.fulfill({ status: 404 }));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`/src/tests/browser/fixtures/recommendation-list.html?${theme}`);
  const list = page.getByRole("list", { name: "推荐论文" });
  const row = list.getByRole("button", { name: /^查看推荐/ }).first();
  await expect(row).toBeVisible();
  expect((await row.boundingBox())!.height).toBeGreaterThan(65);
  expect(await list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(list).toContainText("2024-06");
  await row.click();
  await expect(page.getByLabel("文件状态栏", { exact: true })).toContainText("Researcher A");
  await expect(page.getByRole("region", { name: "推荐论文详情", exact: true })).toHaveCount(0);
  await row.dblclick();
  const detail = page.getByRole("region", { name: "推荐论文详情", exact: true });
  await expect(detail.getByRole("heading", { level: 1 })).toContainText("Larimar");
  await expect(detail).toContainText("episodic memory");
  await expect(detail.getByRole("link", { name: "打开论文网站" })).toHaveAttribute("href", "https://doi.org/10.1234/example");
  await expect(page.getByLabel("已下载文件", { exact: true })).toHaveText("");
  await list.getByRole("button", { name: /^查看推荐/ }).nth(1).click();
  await expect(page.getByLabel("文件状态栏", { exact: true })).toContainText("Cicada");
  await expect(detail.getByRole("heading", { level: 1 })).toContainText("Larimar");
  await detail.getByRole("combobox", { name: "论文保存目录" }).selectOption("D:/Library/Memory");
  await detail.getByRole("textbox", { name: "新建论文保存子目录" }).fill("Papers");
  await detail.getByRole("button", { name: "下载 PDF 并保存" }).click();
  await expect(detail.getByRole("status").last()).toContainText("D:/Library/Memory/Papers");
  await page.screenshot({ path: testInfo.outputPath(`recommendations-${theme}.png`), animations: "disabled" });
  await page.getByRole("textbox", { name: "搜索推荐论文" }).fill("database");
  await expect(list.getByRole("button", { name: /^查看推荐/ })).toHaveCount(1);
  await page.getByRole("checkbox", { name: "可下载 PDF" }).check();
  await expect(page.getByText(/暂未发现符合筛选条件的全文链接/)).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(list.getByRole("button", { name: /^查看推荐/ })).toHaveCount(3);
  await page.setViewportSize({ width: 400, height: 760 });
  expect(await list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`recommendations-narrow-${theme}.png`), animations: "disabled" });
});


test("full-text filter discovers missing OpenAlex links before excluding recommendations", async ({ page }) => {
  await page.route(/https:\/\/api\.(crossref|semanticscholar)\.org\//, (route) => route.fulfill({ status: 404 }));
  await page.route("https://api.openalex.org/**", (route) => route.fulfill({ json: { doi: "https://doi.org/10.1234/example", locations: [{ pdf_url: "https://repository.test/paper.pdf" }] } }));
  await page.route("https://repository.test/paper.pdf", (route) => route.fulfill({ body: "%PDF-1.7\nverified prefix", contentType: "application/pdf" }));
  await page.route("https://doi.org/**", (route) => route.fulfill({ status: 404 }));
  await page.goto("/src/tests/browser/fixtures/recommendation-list.html");
  await page.getByRole("checkbox", { name: "可下载 PDF" }).check();
  const row = page.getByRole("button", { name: "查看推荐 Memory and transactions in modern database systems" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("PDF 已验证");
  await expect(page.getByText("3 / 3 篇")).toBeVisible();
});
