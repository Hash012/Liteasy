import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("default public recommendations refresh without login or explicit local-mode configuration", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  let requests = 0;
  await page.route("https://api.crossref.org/works?**", (route) => {
    requests += 1;
    return route.fulfill({ json: { message: { items: [{ DOI: "10.1234/public", title: ["Public API Research"], author: [{ given: "Alice", family: "Smith" }] }] } } });
  });
  const pdf = await readFile(new URL("../../../../../../../development/test-data/pdf-selection/glyph-boundaries.pdf", import.meta.url));
  await page.route("**/manual-preview/das24a.pdf", (route) => route.fulfill({ body: pdf, contentType: "application/pdf" }));
  await page.goto("/?pdf-highlight-fixture#importable");
  await page.getByRole("region", { name: "本地文献库", exact: true }).getByRole("button", { name: "das24a.pdf", exact: true }).click();
  await page.getByRole("checkbox", { name: "选择 das24a.pdf", exact: true }).check();
  const recommendations = page.getByRole("region", { name: "关联推荐", exact: true });
  await expect(recommendations.getByText("Public API Research", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("liteasy.local-literature.v1"))).toBeNull();
  const previous = requests;
  await recommendations.getByRole("button", { name: "刷新推荐" }).click();
  await expect.poll(() => requests).toBeGreaterThan(previous);
  await expect(recommendations.getByText("Public API Research", { exact: true })).toBeVisible();
  await expect(recommendations.getByText(/云端服务当前不可用/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("retrieving metadata for the real das24a PDF renames its library display to Larimar", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  const bibliography = await readFile(new URL("../../../../../../../development/test-data/literature/larimar-pmlr.bib", import.meta.url));
  let lookups = 0;
  await page.route("https://proceedings.mlr.press/v235/assets/bib/bibliography.bib", (route) => {
    lookups++;
    return route.fulfill({ body: bibliography, contentType: "text/plain" });
  });
  await page.goto("/?pdf-highlight-fixture#importable");
  // This browser fixture has no Tauri artifact store. Keep that native boundary
  // in memory while exercising the real PDF, recognition controller and library UI.
  await page.evaluate(async () => {
    const modulePath = "/src/app/features/paper-identity/literatureMetadataRepository.ts";
    const { literatureMetadataRepository } = await import(/* @vite-ignore */ modulePath);
    const records = new Map();
    literatureMetadataRepository.load = async (id: string) => records.get(id);
    literatureMetadataRepository.save = async (id: string, record: unknown) => { records.set(id, record); };
  });
  const library = page.getByRole("region", { name: "本地文献库", exact: true });
  await library.getByRole("button", { name: "das24a.pdf", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "获取元数据", exact: true }).click();
  await expect(library.getByRole("button", { name: "Larimar: Large Language Models with Episodic Memory Control", exact: true })).toBeVisible({ timeout: 30_000 });
  expect(lookups).toBe(1);
});
