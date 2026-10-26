import { expect, test } from "@playwright/test";

const fixture = "/src/tests/browser/fixtures/ui-refinement.html";
test.use({ viewport: { width: 1600, height: 1000 } });

for (const theme of ["浅色", "深色"]) {
  test(`research cards keep inputs and actions reachable in narrow panes (${theme})`, async ({ page }, info) => {
    await page.goto(fixture);
    await page.getByRole("button", { name: theme, exact: true }).click();
    const research = page.getByRole("region", { name: "研究工作台", exact: true });
    for (const width of [320, 520, 800]) {
      await page.getByTestId("research-host").evaluate((element, value) => { element.style.width = `${value}px`; }, width);
      await page.locator(".fluent-app-root:not([data-portal-node])").evaluate((element, ratio) => {
        element.style.setProperty("--fontSizeBase300", `${14 * ratio}px`);
        element.style.setProperty("--lineHeightBase300", `${20 * ratio}px`);
        element.style.setProperty("--fontSizeBase200", `${12 * ratio}px`);
      }, width === 320 ? 1.5 : 1);
      const goal = research.getByRole("textbox", { name: "研究目标", exact: true });
      await expect(goal).toHaveCSS("font-size", width === 320 ? "21px" : "14px");
      await goal.fill(`检查窄面板 ${width} 的实际输入与任务创建`);
      await research.getByRole("button", { name: "创建研究任务", exact: true }).click();
      await expect(page.getByTestId("events")).toContainText(`create:检查窄面板 ${width} 的实际输入与任务创建`);
      const task = research.getByRole("button", { name: new RegExp(`检查窄面板 ${width}.*等待确认`) });
      await expect(task).toHaveAttribute("aria-pressed", "true");
      await task.click();
      await expect(page.getByTestId("events")).toContainText("open:task-one");
      const geometry = await research.evaluate(element => {
        const tasks = element.querySelector(".research-tasks")!.getBoundingClientRect();
        const connection = element.querySelector(".research-connection")!.getBoundingClientRect();
        return { overflow: element.scrollWidth - element.clientWidth, aligned: Math.abs(tasks.x - connection.x), gap: connection.top - tasks.bottom };
      });
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.aligned).toBeLessThanOrEqual(1);
      expect(geometry.gap).toBeGreaterThanOrEqual(12);
      await research.getByRole("button", { name: "假设分支", exact: true }).click();
      await expect(research.getByRole("textbox", { name: "问题", exact: true })).toBeVisible();
      await research.getByRole("button", { name: "来源与访问范围", exact: true }).click();
      await expect(research.getByRole("textbox", { name: "问题", exact: true })).toHaveCount(0);
      await research.evaluate(element => { element.scrollTop = 0; });
      await research.screenshot({ path: info.outputPath(`research-${theme}-${width}.png`) });
    }
  });
}

test("connection loading, cancellation, errors, dropdowns and advanced settings remain interactive", async ({ page }) => {
  await page.goto(fixture);
  const connection = page.getByRole("region", { name: "模型连接配置" });
  await expect(connection.getByRole("alert")).toContainText("无法读取 ChatGPT 连接信息");
  await expect(connection.getByRole("combobox", { name: "模型", exact: true })).toBeDisabled();
  await expect(connection.getByRole("button", { name: "验证所选模型" })).toBeDisabled();
  await connection.getByRole("button", { name: "Continue with ChatGPT" }).click();
  await expect(connection.getByRole("status")).toContainText("正在等待 ChatGPT 授权");
  await connection.getByRole("button", { name: "取消授权等待" }).click();
  await expect(page.getByTestId("events")).toContainText("cancel-login");
  await connection.getByRole("button", { name: "Continue with ChatGPT" }).click();
  await page.getByRole("button", { name: "授权失败", exact: true }).click();
  await expect(connection.getByRole("alert")).toContainText("无法读取 ChatGPT 连接信息");
  await connection.getByRole("button", { name: "连接诊断详情" }).click();
  await expect(connection.getByText("chatgpt_discovery_failed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "提供已授权账号" }).click();
  await connection.getByRole("combobox", { name: "模型", exact: true }).click();
  await page.getByRole("option", { name: "研究模型", exact: true }).click();
  await connection.getByRole("button", { name: "验证所选模型" }).click();
  await expect(page.getByTestId("events")).toContainText("verify:model-one");
  await connection.getByRole("button", { name: "研究引擎与校验服务", exact: true }).click();
  await connection.getByRole("textbox", { name: "研究引擎可执行文件" }).fill("C:\\Tools\\codex.exe");
  await connection.getByRole("button", { name: "模型连接", exact: true }).click();
  await connection.getByRole("button", { name: "模型连接", exact: true }).click();
  await expect(connection.getByRole("textbox", { name: "研究引擎可执行文件" })).toHaveValue("C:\\Tools\\codex.exe");
  await connection.getByRole("button", { name: "连接研究引擎", exact: true }).click();
  await expect(page.getByTestId("events")).toContainText("backend:C:");
  await connection.getByRole("button", { name: "断开并移除本机凭据" }).click();
  await expect(page.getByTestId("events")).toContainText("logout");
});

test("expanded library extraction and assistant home use the actual shared controls", async ({ page }, info) => {
  await page.goto(fixture);
  const library = page.getByTestId("library-host");
  await library.getByRole("button", { name: /^展开 .*的2 项关联内容$/ }).click();
  const children = library.locator(".library-paper-children");
  await children.getByRole("button", { name: "提取结果", exact: true }).click();
  const picker = children.getByRole("combobox", { name: "此文献的解析时机" });
  await picker.click();
  await page.getByRole("option", { name: "仅手动解析", exact: true }).click();
  await expect(page.getByTestId("events")).toContainText("policy:paper-one:manual");
  const prepare = children.getByRole("button", { name: "准备全文与图表", exact: true });
  await prepare.click();
  await expect(page.getByTestId("events")).toContainText("prepare:paper-one");
  await children.getByRole("button", { name: "打开论文文件：论文提取文本", exact: true }).click();
  await expect(page.getByTestId("events")).toContainText("child:paper-one:text");
  const p = (await picker.boundingBox())!, b = (await prepare.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(p.y + p.height);
  expect(await children.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  const home = page.getByRole("region", { name: "助手首页" });
  await home.getByRole("button", { name: "根据已选资料提问" }).click();
  await expect(page.getByTestId("events")).toContainText("ask:paper-one");
  await home.getByRole("button", { name: "打开会话：Liteasy 研究助手使用记录 1" }).click();
  await expect(page.getByTestId("events")).toContainText("session:session-1");
  await home.getByRole("button", { name: "查看全部", exact: true }).click();
  await expect(page.getByTestId("events")).toContainText("history");
  await expect(home.getByRole("button", { name: "查看全部", exact: true })).toHaveCSS("text-decoration-line", "none");
  await library.evaluate(element => { element.style.width = "420px"; });
  const year = library.locator(".resource-tag-year");
  await expect(year).toBeVisible();
  await expect(year).toHaveCSS("background-color", "rgb(241, 245, 249)");
  await page.screenshot({ path: info.outputPath("expanded-and-home-light.png") });
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(year).toHaveCSS("background-color", "rgb(43, 53, 68)");
  await page.screenshot({ path: info.outputPath("expanded-and-home-dark.png") });
  await page.getByRole("button", { name: "切换空状态" }).click();
  await expect(home).toContainText("暂无最近对话");
  await expect(home).toContainText("尚未添加资料");
});

test("native titlebar aligns AI and window controls at multiple window and font sizes", async ({ page }, info) => {
  await page.goto(fixture);
  const bar = page.getByRole("toolbar", { name: "工作区命令栏" });
  for (const width of [1954, 1280, 640, 400]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator(".fluent-app-root:not([data-portal-node])").evaluate(element => {
      element.style.setProperty("--fontSizeBase300", "21px");
      element.style.setProperty("--lineHeightBase300", "30px");
      element.style.setProperty("--fontSizeBase200", "18px");
    });
    await expect.poll(() => bar.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const bounds = (await bar.boundingBox())!;
    for (const name of ["AI 工作台", "最小化窗口", "最大化窗口", "关闭窗口"]) {
      const button = bar.getByRole("button", { name, exact: true });
      const box = (await button.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      expect(Math.abs(box.y + box.height / 2 - (bounds.y + (bounds.height - 1) / 2))).toBeLessThanOrEqual(1);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      if (name === "AI 工作台") expect(box.height).toBe(26);
    }
    await bar.getByRole("button", { name: "AI 工作台" }).click();
    await expect(page.getByTestId("events")).toContainText("ai");
    await bar.getByRole("button", { name: "最大化窗口", exact: true }).click();
    await bar.getByRole("button", { name: "还原窗口", exact: true }).click();
    await bar.screenshot({ path: info.outputPath(`titlebar-${width}.png`) });
  }
});
