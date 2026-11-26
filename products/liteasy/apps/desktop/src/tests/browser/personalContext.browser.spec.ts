import { expect, test } from "@playwright/test";
test("personal context keeps a conflicted edit and shows source availability", async ({ page }) => {
  const entry = { schemaVersion: "liteasy.context-entry/v1", id: "11111111-1111-4111-8111-000000000001", revision: 1, owner: "synthetic-user", actor: "desktop", scopeKey: "personal", kind: "understanding", title: "压缩态检索的适用条件", bodyMarkdown: "## 我的理解\n压缩算子需要满足访问条件。\n\n## 待确认\n尚未运行真实 GPU 基准。", basis: "user_authored", status: "active", tags: [], sourceRefs: [{ provider: "liteasy", origin: "local", locator: "https://example.invalid/source", availability: "local_only" }], attributes: {}, createdAt: "2026-11-26T00:00:00Z", updatedAt: "2026-11-26T00:00:00Z" };
  const requests: Record<string, unknown>[] = [];
  await page.route("**/v1/context/**", async (route) => {
    if (route.request().method() === "POST") {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: { schemaVersion: "liteasy.context-api/v1", error: { code: "context_revision_conflict", currentRevision: 2, retryable: false } } });
    }
    return route.fulfill({ json: { schemaVersion: "liteasy.context-api/v1", entries: [entry], nextCursor: null } });
  });
  await page.goto("/src/tests/browser/fixtures/personal-context.html");
  await page.getByRole("button", { name: "载入条目" }).click();
  await page.getByRole("button", { name: entry.title }).click();
  await expect(page.getByText(/来源仅在原设备可用/)).toBeVisible();
  await page.getByLabel("正文 Markdown").fill("我的修正：限制条件仍保留。");
  await page.getByRole("button", { name: "保存修正" }).click();
  await expect(page.getByRole("alert")).toContainText("当前编辑仍保留");
  await expect(page.getByLabel("正文 Markdown")).toHaveValue("我的修正：限制条件仍保留。");
  expect(requests[0]).toMatchObject({ action: "update", expectedRevision: 1, entry: { bodyMarkdown: "我的修正：限制条件仍保留。", scopeKey: "personal" } });
  await page.screenshot({ path: "test-results/personal-context.png", fullPage: true });
});
