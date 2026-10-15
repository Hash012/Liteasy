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
  await page.getByRole("button", { name: "展开推荐元信息" }).click();
  await expect(page.getByRole("region", { name: "推荐文献元信息" })).toContainText("Researcher A");
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
  await detail.getByRole("combobox", { name: "论文保存目录" }).click();
  await page.getByRole("option", { name: /Memory/ }).click();
  await detail.getByRole("textbox", { name: "新建论文保存子目录" }).fill("Papers");
  await detail.getByRole("button", { name: "下载 PDF 并保存" }).click();
  await expect(detail.getByRole("status").last()).toContainText("D:/Library/Memory/Papers");
  await page.screenshot({ path: testInfo.outputPath(`recommendations-${theme}.png`), animations: "disabled" });
  await page.getByRole("textbox", { name: "搜索推荐论文" }).fill("database");
  await expect(list.getByRole("button", { name: /^查看推荐/ })).toHaveCount(1);
  await page.getByRole("button", { name: "推荐筛选" }).click();
  await page.getByRole("checkbox", { name: "可下载 PDF" }).check();
  await expect(page.getByText(/暂未发现符合筛选条件的全文链接/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(list.getByRole("button", { name: /^查看推荐/ })).toHaveCount(3);
  await page.setViewportSize({ width: 400, height: 760 });
  expect(await list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`recommendations-narrow-${theme}.png`), animations: "disabled" });
});


test("full-text filtering stays local until explicit OpenAlex link verification", async ({ page }) => {
  let requests = 0;
  await page.route(/https:\/\/api\.(crossref|semanticscholar)\.org\//, (route) => route.fulfill({ status: 404 }));
  await page.route("https://api.openalex.org/**", (route) => { requests++; return route.fulfill({ json: { doi: "https://doi.org/10.1234/example", locations: [{ pdf_url: "https://repository.test/paper.pdf" }] } }); });
  await page.route("https://repository.test/paper.pdf", (route) => route.fulfill({ body: "%PDF-1.7\nverified prefix", contentType: "application/pdf" }));
  await page.route("https://doi.org/**", (route) => route.fulfill({ status: 404 }));
  await page.goto("/src/tests/browser/fixtures/recommendation-list.html");
  await page.getByRole("button", { name: "推荐筛选" }).click();
  await page.getByRole("checkbox", { name: "可下载 PDF" }).check();
  expect(requests).toBe(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "检查全文链接" }).click();
  const row = page.getByRole("button", { name: "查看推荐 Memory and transactions in modern database systems" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("PDF 已验证");
  await expect(page.getByText("3 / 3 篇")).toBeVisible();
});


for (const theme of ["light", "dark"]) test(`recommendation actions and evidence never overlap at 300–600px in ${theme}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1300, height: 1100 });
  for (const width of [300, 400, 600]) {
    await page.goto(`/src/tests/browser/fixtures/recommendation-list.html?${theme}&width=${width}`);
    const list = page.getByRole("list", { name: "推荐论文" });
    const card = list.locator(".recommendation-compact-item").first();
    const title = card.getByRole("button", { name: /^查看推荐/ });
    const menu = card.getByRole("button", { name: /^推荐操作 / });
    const reason = card.locator(".recommendation-reason");
    const disclosure = card.getByRole("button", { name: "推荐详情", exact: true });
    await expect(title).toBeVisible();
    await expect(title).toContainText("Researcher A");
    await expect(reason).toContainText("可补充方法设计与实证比较");
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const cardBox = (await card.boundingBox())!;
    const boxes = [];
    for (const control of [title, menu, reason, disclosure]) {
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!; boxes.push(box);
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(cardBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);
    }
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const left = boxes[a], right = boxes[b];
      const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
      const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
      expect(overlapX > 1 && overlapY > 1).toBe(false);
    }
    await menu.click();
    await expect(page.getByRole("menuitem", { name: "解释为什么推荐" })).toBeVisible();
    await page.getByRole("menuitemcheckbox", { name: "太基础", exact: true }).click();
    await expect(page.locator(".recommendation-notice")).toContainText("已用于下次精选");
    await expect(page.getByLabel("最近推荐操作", { exact: true })).toHaveText("feedback:paper-0:too_basic");
    await page.getByRole("button", { name: "更多推荐操作" }).click();
    await page.getByRole("menuitem", { name: "应用反馈" }).click();
    await expect(page.getByLabel("最近推荐操作", { exact: true })).toHaveText("apply-feedback");
    await page.locator("aside").screenshot({ path: testInfo.outputPath(`recommendation-column-${width}-${theme}.png`), animations: "disabled" });
  }
});
