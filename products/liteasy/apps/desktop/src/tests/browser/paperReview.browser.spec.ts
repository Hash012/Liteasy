import { expect, test } from "@playwright/test";

test("paper review share controls fit the reader sidebar and revoke the snapshot", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="review-fixture"></div>';
    const url = "/src/tests/fixtures/paperReviewBrowserFixture.tsx";
    const fixture = await import(url);
    fixture.mountPaperReviewBrowserFixture(document.getElementById("review-fixture")!);
  });
  await page.getByText("ChatGPT 评论 Review", { exact: true }).click();
  await expect(page.getByRole("button", { name: "共享本篇评论" })).toBeEnabled();
  await page.getByRole("button", { name: "共享本篇评论" }).click();
  await expect(page.getByRole("button", { name: "停止共享" })).toBeVisible();
  const snapshot = await page.evaluate(async () => {
    const url = "/src/app/features/pdf/paperReviewShare.ts";
    return (await import(url)).paperReviewShareStore.read({ operation: "current" });
  });
  expect(snapshot.totalComments).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/paper-review-share.png", fullPage: true });
  await page.getByRole("button", { name: "停止共享" }).click();
  await expect(page.getByRole("button", { name: "共享本篇评论" })).toBeVisible();
});
