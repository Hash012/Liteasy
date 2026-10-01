import { expect, test } from "@playwright/test";
import { passingEvidenceReview } from "../fixtures/thinReadingModelResponses";

for (const entry of ["workbench", "reader"] as const) {
test(`generates thin reading from ${entry} with a real PDF without library selection and reopens the saved paper child after reload`, async ({ page }) => {
  test.setTimeout(90_000);
  const summary = "Larimar 通过外部记忆支持语言模型的知识更新，使模型能够利用记忆中的信息调整生成内容。";
  const formats: string[] = [];
  await page.addInitScript(() => localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true"));
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.route("https://api.openai.com/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const prompt = body.messages.map((message: { content: string }) => message.content).join("\n");
    const format = body.response_format?.json_schema?.name ?? "text";
    formats.push(format);
    const evidenceId = prompt.match(/\[(evidence-[^\]]+)\]/)?.[1] ?? "evidence-1";
    let answer: string;
    if (format === "liteasy_thin_reading_evidence_plan") {
      answer = JSON.stringify({ focus: ["外部记忆与知识更新"], pageRequests: [1], searchQueries: [], selectedEvidenceIds: [evidenceId] });
    } else if (format === "liteasy_thin_reading_evidence_observation") {
      answer = JSON.stringify({ decision: "stop", focus: [], pageRequests: [], reason: "已具备测试所需的论文内证据。", searchQueries: [], selectedEvidenceIds: [] });
    } else if (format === "liteasy_thin_reading_evidence_review") {
      answer = JSON.stringify(passingEvidenceReview(prompt));
    } else if (format === "liteasy_thin_reading") {
      answer = JSON.stringify({
        anchors: [], claims: [{ evidenceIds: [evidenceId], status: "grounded", text: summary }],
        externalKnowledge: [], interactiveDemo: null, mermaid: "", omittedSections: [],
        paperEvidence: [evidenceId], paperType: "systems", recommendedFigures: [], summary,
        summarySentences: [{ evidenceIds: [evidenceId], externalKnowledge: [], status: "grounded", text: summary }],
        visualizationIntent: null, withinPaperClosure: true
      });
    } else {
      answer = prompt.includes("确认你已准备好") ? "连接测试响应。" : JSON.stringify({ verdict: "pass", score: 0.96, rationale: "浏览器流程测试。" });
    }
    await route.fulfill({
      status: 200, contentType: body.stream ? "text/event-stream" : "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: body.stream ? `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`
        : JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: "stop" }] })
    });
  });
  await page.goto("/?pdf-highlight-fixture#importable");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("AI 接入方式").selectOption("direct");
  await page.getByLabel("模型 ID", { exact: true }).fill("gpt-5-mini");
  await page.getByLabel("API key", { exact: true }).fill("browser-test-only-key");
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await expect(page.getByLabel("测试响应")).toHaveValue("连接测试响应。");
  await page.getByRole("tab", { name: "das24a.pdf", exact: true }).click();
  if (entry === "workbench") {
    await page.getByRole("toolbar", { name: "工作区命令栏" }).getByRole("button", { name: "AI 工作台" }).click();
    const ai = page.getByRole("dialog", { name: /论文工作台/ });
    await expect(ai.getByRole("checkbox", { name: /das24a.pdf/ })).toBeChecked();
    await ai.getByRole("button", { name: "确认选择", exact: true }).click();
    await ai.getByRole("button", { name: "薄读", exact: true }).click();
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    await expect(ai.getByRole("status")).not.toBeEmpty();
    await ai.getByRole("button", { name: "关闭 AI 工作台" }).click();
  } else {
    await page.getByRole("button", { name: "AI 薄读", exact: true }).click();
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
  }
  await expect(page.locator(".thin-reading").getByText(summary, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(formats).toContain("liteasy_thin_reading");
  expect(formats).not.toContain("liteasy_thin_reading_evidence_review");
  await expect(page.locator(".thin-reading__generation-status")).toHaveCount(0);
  await page.getByRole("button", { name: /展开 das24a.pdf 的 .* 个附件/ }).click();
  await expect(page.getByRole("button", { name: "打开论文文件：薄读", exact: true })).toBeVisible();
  const requestCount = formats.length;
  await page.reload();
  const paperRow = page.locator(".library-paper-node").filter({ hasText: "das24a.pdf" });
  const expand = paperRow.getByRole("button", { name: /展开 das24a.pdf 的 .* 个附件/ });
  await expand.click();
  await paperRow.getByRole("button", { name: "打开论文文件：薄读", exact: true }).click();
  await expect(page.locator(".thin-reading").getByText(summary, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `test-results/thin-reading-lifecycle-${entry}.png`, fullPage: true });
  expect(formats).toHaveLength(requestCount);
});
}
