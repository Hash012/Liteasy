import { expect, test, type Locator } from "@playwright/test";

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

const corners = "/src/tests/browser/fixtures/ui-corners.html";

async function enlargeModalText(dialog: Locator) {
  // Dialog portals have their own provider: apply the scale to the actual surface.
  await dialog.evaluate(element => {
    element.style.setProperty("--fontSizeBase300", "21px");
    element.style.setProperty("--lineHeightBase300", "30px");
  });
}

for (const theme of ["浅色", "深色"]) test(`corners: modal forms retain focus, pending guards and exact submissions (${theme})`, async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(corners);
  await page.getByRole("button", { name: theme, exact: true }).click();
  await page.locator(".fluent-app-root:not([data-portal-node])").evaluate(element => {
    element.style.setProperty("--fontSizeBase300", "21px");
    element.style.setProperty("--lineHeightBase300", "30px");
  });
  for (const [trigger, title, field, value, submit] of [
    ["创建组织", "创建组织", "组织名称", "  可核查研究组  ", "创建组织"],
    ["加入组织", "加入组织", "邀请令牌", "  orginv_abcdefghijklmnopqrstuvwxyz0123456789  ", "加入组织"],
    ["邀请成员", "邀请成员确认", "账号主体 ID", "  researcher-id  ", "创建邀请"],
  ]) {
    await page.getByRole("navigation", { name: "审核弹窗" }).getByRole("button", { name: trigger, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await enlargeModalText(dialog);
    await expect(dialog.getByRole("textbox", { name: field, exact: true })).toHaveCSS("font-size", "21px");
    await dialog.getByRole("textbox", { name: field, exact: true }).fill(value);
    if (trigger === "邀请成员") {
      await dialog.getByRole("combobox", { name: "组织角色" }).click();
      await page.getByRole("option", { name: "管理员", exact: true }).click();
    }
    await expect(dialog.getByRole("button", { name: submit, exact: true })).toBeInViewport();
    await dialog.getByRole("button", { name: submit, exact: true }).click();
    await expect(page.getByTestId("corner-events")).toContainText(value.trim());
    if (trigger === "邀请成员") await expect(page.getByTestId("corner-events")).toContainText('"role":"admin"');
    await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("ui-review-finish")));
    await expect(dialog.getByRole("textbox", { name: field, exact: true })).toHaveValue(value);
    await expect(dialog.getByRole("status")).toContainText("已填写内容会保留");
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await dialog.screenshot({ path: info.outputPath(`corners-${theme}-${trigger}.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "审核弹窗" }).getByRole("button", { name: trigger, exact: true })).toBeFocused();
  }
  await page.getByRole("navigation", { name: "审核弹窗" }).getByRole("button", { name: "登录", exact: true }).click();
  const login = page.getByRole("dialog", { name: "轻量登录面板" });
  await enlargeModalText(login);
  await login.getByRole("button", { name: "创建账号", exact: true }).click();
  await login.getByLabel("昵称", { exact: true }).fill("  Ada  ");
  await login.getByLabel("邮箱", { exact: true }).fill("ada@example.invalid");
  await login.getByLabel("密码或密码短语（至少 12 位）", { exact: true }).fill("fixture-password-123");
  await login.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByTestId("corner-events")).toContainText('"displayName":"Ada","email":"ada@example.invalid","password":"fixture-password-123"');
  await expect(login.getByRole("button", { name: "请稍候…", exact: true })).toBeDisabled();
  await expect(login.getByRole("button", { name: "跳过，进入本地阅读器" })).toBeInViewport();
  await login.getByRole("button", { name: "跳过，进入本地阅读器" }).click();
  for (const [trigger, title, action, event] of [
    ["退出组织", "退出组织确认", "退出组织", "leave"],
    ["查看档案", "学术档案页面", "导出学术档案", "export"],
    ["清空档案", "清空学术档案确认", "确认清空学术档案", "clear"],
  ]) {
    await page.getByRole("navigation", { name: "审核弹窗" }).getByRole("button", { name: trigger, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await enlargeModalText(dialog);
    await expect(dialog.getByRole("button", { name: action, exact: true })).toBeInViewport();
    await dialog.getByRole("button", { name: action, exact: true }).click();
    await expect(page.getByTestId("corner-events")).toContainText(event);
    if (event === "leave") await page.evaluate(() => window.dispatchEvent(new Event("ui-review-finish")));
    if (event !== "clear") await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  }
});

test("corners: model advanced fields, failed requests and readonly replies remain usable in a narrow card", async ({ page }, info) => {
  let calls = 0;
  await page.route("https://api.example.invalid/v1/chat/completions", async route => {
    const body = route.request().postDataJSON();
    expect(body.model).toBe("review-model");
    expect(body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "user", content: expect.stringContaining("准备好帮助阅读论文") })]));
    calls++;
    if (calls === 1) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "fixture service unavailable" } }) });
    else await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta: { content: "已准备好，测试回复。" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n` });
  });
  await page.goto(corners);
  const pane = page.getByTestId("corner-pane");
  await pane.evaluate(element => { element.style.width = "320px"; });
  await pane.getByLabel("API key", { exact: true }).fill("fixture-review-key");
  await pane.getByRole("button", { name: "高级设置", exact: true }).click();
  await pane.getByRole("combobox", { name: "结构化输出" }).click();
  await page.getByRole("option", { name: "JSON 模式", exact: true }).click();
  await pane.getByRole("button", { name: "保存并测试", exact: true }).click();
  await expect(pane.getByRole("alert")).toBeVisible();
  await pane.getByRole("button", { name: "保存并测试", exact: true }).click();
  await expect(pane.getByRole("textbox", { name: "测试响应", exact: true })).toHaveValue("已准备好，测试回复。");
  await expect(pane.getByRole("textbox", { name: "测试响应", exact: true })).toHaveAttribute("readonly", "");
  expect(calls).toBe(2);
  expect(await pane.locator(".settings-card-content").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await pane.screenshot({ path: info.outputPath("corners-model-320.png") });
});

for (const width of [320, 520]) test(`corners: reading and workflow layouts follow a ${width}px pane inside a wide window`, async ({ page }, info) => {
  await page.goto(corners);
  const pane = page.getByTestId("corner-pane");
  await pane.evaluate((element, value) => { element.style.width = `${value}px`; }, width);
  for (const view of ["解析图表", "翻译对照", "电子书", "薄读", "工作流", "认知图"]) {
    await page.getByRole("navigation", { name: "审核页面" }).getByRole("button", { name: view, exact: true }).click();
    if (view === "翻译对照") {
      await pane.getByRole("button", { name: "查看译文", exact: true }).click();
      await pane.getByRole("button", { name: "左右对照", exact: true }).click();
      const boxes = await pane.locator(".paper-resource-tab__reading-pane").evaluateAll(elements => elements.map(e => e.getBoundingClientRect().toJSON()));
      expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom);
    }
    if (view === "解析图表") {
      const figure = pane.locator(".paper-resource-tab__figure").first();
      const caption = (await figure.locator("figcaption").boundingBox())!;
      const media = (await figure.locator("img").boundingBox())!;
      expect(caption.y).toBeGreaterThanOrEqual(media.y + media.height);
    }
    if (view === "电子书") {
      await expect(pane.getByRole("complementary", { name: "阅读目录" })).toHaveCSS("position", "absolute");
      await pane.getByRole("button", { name: "发现", exact: true }).click();
      await pane.getByRole("button", { name: "目录", exact: true }).click();
      await expect(pane.getByRole("heading", { name: "发现", exact: true })).toBeVisible();
    }
    if (view === "薄读") await expect(pane.locator(".thin-reading__body")).toHaveCSS("display", "block");
    if (view === "工作流") {
      await pane.getByRole("button", { name: /整理阅读来源 · 失败/ }).click();
      await expect(pane.getByRole("heading", { name: "整理阅读来源", exact: true })).toBeVisible();
      const nav = (await pane.getByRole("navigation", { name: "工作流运行" }).boundingBox())!;
      const detail = (await pane.locator(".workflow-run-layout > article").boundingBox())!;
      expect(detail.y).toBeGreaterThanOrEqual(nav.y + nav.height);
    }
    if (view === "认知图") {
      const canvas = (await pane.locator(".layered-graph-canvas").boundingBox())!;
      const detail = (await pane.locator(".layered-graph-detail").boundingBox())!;
      expect(detail.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
      await pane.getByRole("button", { name: "深入一层", exact: true }).click();
      await expect(page.getByTestId("corner-events")).toContainText('"expand":"root"');
    }
    expect(await pane.evaluate(element => element.scrollWidth - element.clientWidth), `${view} outer overflow`).toBeLessThanOrEqual(1);
    await pane.screenshot({ path: info.outputPath(`corners-${view}-${width}.png`) });
  }
});

test("corners: metadata validation and citation detail fit a small window", async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(corners);
  await page.getByRole("button", { name: "分类标签", exact: true }).click();
  const metadata = page.getByRole("dialog", { name: "编辑资产分类与标签" });
  await metadata.getByRole("textbox", { name: "资产年份" }).fill("abc");
  await metadata.getByRole("button", { name: "保存", exact: true }).click();
  await expect(metadata.getByRole("alert")).toContainText("四位数字");
  await expect(metadata.getByRole("button", { name: "保存", exact: true })).toBeInViewport();
  await metadata.getByRole("textbox", { name: "资产年份" }).fill("2026");
  await metadata.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("corner-events")).toContainText('"year":2026');
  await page.getByRole("button", { name: "引用图", exact: true }).click();
  const graph = page.getByRole("dialog", { name: "文献引用图" });
  await expect(graph).toBeVisible();
  await graph.getByRole("button", { name: "加载引用关系", exact: true }).click();
  await expect(graph).toContainText("已匹配 0 篇论文");
  expect(await graph.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await graph.screenshot({ path: info.outputPath("corners-citation-360.png") });
  await graph.getByRole("button", { name: "关闭文献引用图", exact: true }).click();
});
