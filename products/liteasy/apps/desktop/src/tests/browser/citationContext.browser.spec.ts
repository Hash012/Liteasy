import { expect, test } from "@playwright/test";
const work = (id: number, refs: number[] = []) => ({ id: `https://openalex.org/W${id}`, doi: `https://doi.org/10.1234/${id}`, title: `Database paper ${id}`, cited_by_count: id * 10, referenced_works: refs.map((id) => `https://openalex.org/W${id}`), authorships: [{ author: { display_name: "Research Author" } }], publication_year: 2024 });
for (const theme of ["light", "dark"]) test(`visible thumbnails and directed citation exploration: ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("https://api.openalex.org/works?**", async (route) => {
    const filter = new URL(route.request().url()).searchParams.get("filter")!;
    const results = filter.startsWith("doi:") ? [work(1, [2, 3]), work(2)] : filter.startsWith("cites:") ? [work(4, [1])] : [work(3)];
    await route.fulfill({ json: { results, meta: { count: results.length } } });
  });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/src/tests/browser/fixtures/citation-context.html?theme=${theme}`);
  await page.getByRole("button", { name: "添加图片上下文" }).click();
  for (const name of ["实验结果图", "模型结构图", "向量插图"]) {
    const thumbnail = page.getByRole("img", { name: `${name} 缩略图` });
    await expect(thumbnail).toBeVisible(); expect(await thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByRole("checkbox", { name: "选择 实验结果图" })).not.toBeChecked();
  await page.screenshot({ path: info.outputPath(`thumbnails-${theme}.png`) });
  await page.getByRole("button", { name: "返回对话", exact: true }).first().click();
  await page.getByRole("button", { name: "打开文献引用图" }).click();
  await page.getByRole("button", { name: "加载引用关系", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已匹配 2 篇");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.getByRole("button", { name: "向外搜索一圈" }).click();
  await expect(page.getByRole("status")).toContainText("发现 2 篇");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  const first = page.locator('.react-flow__node[data-id="W1"]');
  const before = await first.getAttribute("style");
  const box = await first.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 8); await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 55, box!.y + 40, { steps: 10 }); await page.mouse.up();
  await expect(first).not.toHaveAttribute("style", before!);
  expect(await page.locator(".citation-graph-canvas").evaluate((element) => element.clientHeight)).toBeGreaterThan(250);
  await page.screenshot({ path: info.outputPath(`citation-graph-${theme}.png`) });
  await page.getByRole("list", { name: "引用图论文列表" }).getByRole("button", { name: /Database paper 4/ }).dblclick();
  await expect(page.locator("output")).toHaveText("发现：Database paper 4");
  expect(errors).toEqual([]);
});
