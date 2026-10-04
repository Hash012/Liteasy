import { expect, test } from "@playwright/test";

test("first-run spotlight teaches real controls, stays in the viewport and can replay from the manual", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.goto("/");
  await page.getByRole("button", { name: "开始导览", exact: true }).click();
  const tour = page.getByRole("dialog", { name: "Liteasy 新手导览" });
  await expect(tour).toBeVisible();
  await expect(tour.getByRole("button", { name: "上一步" })).toBeDisabled();
  const steps = ["library", "reader", "notes", "search", "settings", "assistant", "context", "runs", "finish"];
  for (const [index, id] of steps.entries()) {
    const ring = page.locator(`[data-tour-target="${id}"]`);
    await expect(ring).toBeVisible();
    await expect(tour.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(index + 1));
    await expect.poll(async () => {
      const box = await tour.boundingBox(); const viewport = page.viewportSize()!;
      return Boolean(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
    }).toBe(true);
    // Fluent's centered-dialog margins must not override the anchor positioning.
    await expect.poll(() => tour.evaluate(element => {
      const box = element.getBoundingClientRect();
      return Math.abs(box.x - Number.parseFloat(element.style.left)) + Math.abs(box.y - Number.parseFloat(element.style.top));
    })).toBeLessThan(2);
    expect(await ring.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe("none");
    if (index === 0) {
      await page.screenshot({ path: testInfo.outputPath("tour-library-light.png"), animations: "disabled" });
      await page.keyboard.press("Tab");
      expect(await tour.evaluate(element => element.contains(document.activeElement))).toBe(true);
      // Clicking the shade cannot accidentally abandon the tour or activate the app.
      await page.mouse.click(5, 5);
      await expect(tour).toBeVisible();
    }
    if (id === "search") {
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
      await page.setViewportSize({ width: 1024, height: 720 });
      await expect(ring).toHaveCSS("transition-duration", "0s");
      await expect(tour).toHaveCSS("transition-duration", "0s");
      await page.screenshot({ path: testInfo.outputPath("tour-search-dark.png"), animations: "disabled" });
    }
    if (id === "context") {
      await page.keyboard.press("ArrowLeft");
      await expect(page.locator('[data-tour-target="assistant"]')).toBeVisible();
      await page.keyboard.press("ArrowRight");
      await expect(ring).toBeVisible();
    }
    if (index < steps.length - 1) await tour.getByRole("button", { name: "下一步" }).click();
  }
  await tour.getByRole("button", { name: "开始使用", exact: true }).click();
  await expect(tour).toHaveCount(0);
  const layout = await page.evaluate(() => JSON.parse(localStorage.getItem("liteasy.ui.dock-layout.v3")!));
  expect(layout.regions.left.itemIds).toEqual(expect.arrayContaining(["library", "notes", "artifact-library"]));
  expect(layout.regions.right.itemIds).toContain("assistant");
  expect(layout.regions.bottom.itemIds).toContain("workflow-runs");
  await expect(page.locator('[data-region="bottom"]')).toBeVisible();
  await page.getByRole("button", { name: "收起左栏面板" }).click();
  await page.getByRole("button", { name: "播放新手导览", exact: true }).click();
  await expect(page.locator('[data-tour-target="library"]')).toBeVisible();
  await expect(page.locator('[data-region="left"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tour).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "开始导览", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("replay preserves an unsaved note while normalizing a moved help page", async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
    localStorage.setItem("liteasy.onboarding.v1", JSON.stringify({ version: 1, status: "dismissed" }));
    localStorage.setItem("liteasy.ui.dock-layout.v3", JSON.stringify({ version: 3,
      regions: { left: { itemIds: ["notes"], activeItemId: "notes" }, main: { itemIds: [], activeItemId: null }, right: { itemIds: ["help", "assistant"], activeItemId: "help" }, bottom: { itemIds: [], activeItemId: null } },
      horizontalOrder: ["right", "main", "left"], bottomOrder: ["bottom"], regionWidths: { left: 45, right: 35, main: 20 },
    }));
  });
  await page.goto("/");
  const notes = page.getByRole("region", { name: "笔记", exact: true });
  await notes.getByRole("button", { name: "新建笔记", exact: true }).click();
  await notes.getByRole("textbox", { name: "笔记正文" }).fill("不要丢掉的草稿\n\nThis is my own research.");
  await page.getByRole("button", { name: "播放新手导览", exact: true }).click();
  await expect(page.locator('[data-tour-target="library"]')).toBeVisible();
  await page.keyboard.press("Escape");
  const nav = page.getByRole("navigation", { name: "左边栏导航" });
  await nav.getByRole("button", { name: "笔记", exact: true }).click();
  const draft = notes.getByRole("textbox", { name: "笔记正文" });
  await expect(draft).toContainText("不要丢掉的草稿");
  await expect(draft).toContainText("This is my own research.");
  await expect(page.locator('[data-region="main"] [data-tour-page="help"]')).toBeVisible();
});
