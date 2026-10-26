import { expect, test } from "@playwright/test";

const fixture = "/src/tests/browser/fixtures/layout-regression.html";

for (const long of [false, true]) test(`Skill mentions preserve each glyph position${long ? " across wrapped lines" : " before a suffix"}`, async ({ page }) => {
  await page.goto(`${fixture}${long ? "?long" : ""}`);
  const input = page.getByPlaceholder("输入你的问题或命令");
  await expect(input).toHaveValue(/Before .* after\nNext line/);
  const mention = page.locator(".assistant-input-highlight .assistant-context-preview-trigger");
  await expect(mention).toBeVisible();
  for (const zoom of [1, 1.5, 2]) {
    await page.evaluate(value => { document.body.style.zoom = String(value); }, zoom);
    const result = await page.locator(".assistant-input-editor").evaluate(root => {
      const input = root.querySelector("textarea")!;
      const mirror = root.querySelector<HTMLElement>(".assistant-input-highlight")!;
      const trigger = mirror.querySelector<HTMLElement>(".assistant-context-preview-trigger")!;
      const inputStyle = getComputedStyle(input);
      // A plain text reference copies the native editor's metrics, not the mention's styles.
      const reference = document.createElement("div");
      const referenceStyle = reference.style;
      referenceStyle.position = "absolute";
      referenceStyle.inset = "0";
      referenceStyle.visibility = "hidden";
      for (const property of ["font", "line-height", "letter-spacing", "white-space", "overflow-wrap", "padding", "box-sizing", "tab-size"])
        referenceStyle.setProperty(property, inputStyle.getPropertyValue(property));
      reference.textContent = input.value;
      root.appendChild(reference);
      function glyphs(element: HTMLElement) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const boxes: { text: string; x: number; y: number; width: number; height: number }[] = [];
        while (walker.nextNode()) {
          const text = walker.currentNode as Text;
          for (let index = 0; index < text.length; index++) {
            const range = document.createRange();
            range.setStart(text, index); range.setEnd(text, index + 1);
            const rect = range.getBoundingClientRect();
            boxes.push({ text: text.data[index], x: rect.x, y: rect.y, width: rect.width, height: rect.height });
          }
        }
        return boxes;
      }
      const actual = glyphs(mirror).slice(0, input.value.length), expected = glyphs(reference);
      const triggerStyle = getComputedStyle(trigger);
      const fonts = { input: [inputStyle.fontFamily, inputStyle.fontSize, inputStyle.fontWeight, inputStyle.lineHeight, inputStyle.letterSpacing],
        mention: [triggerStyle.fontFamily, triggerStyle.fontSize, triggerStyle.fontWeight, triggerStyle.lineHeight, triggerStyle.letterSpacing] };
      reference.remove();
      return { actual, expected, fonts };
    });
    expect(result.fonts.mention).toEqual(result.fonts.input);
    expect(result.actual.map(glyph => glyph.text).join("")).toBe(result.expected.map(glyph => glyph.text).join(""));
    const errors = result.actual.flatMap((glyph, index) => glyph.text.trim()
      ? [Math.abs(glyph.x - result.expected[index].x), Math.abs(glyph.y - result.expected[index].y)] : []);
    expect(Math.max(...errors)).toBeLessThan(1);
  }
  await page.evaluate(() => { document.body.style.zoom = "1"; });
  await mention.focus();
  await page.keyboard.press("Enter");
  const preview = page.getByLabel("上下文预览", { exact: true });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: /移除上下文/ }).click();
  await expect(mention).toHaveCount(0);
});

test("reading sidebars follow their dock width and fit short panes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${fixture}?scenario=reading`);
  const host = page.getByTestId("reading-host");
  const body = host.locator(".paper-reading-body");
  const content = host.locator(".paper-reading-content");
  const contentHandle = await content.elementHandle();
  await expect(host.locator(".paper-reading-comments")).toBeVisible();
  async function expectStacked(side: string) {
    const boxes = await Promise.all([body.boundingBox(), content.boundingBox(), host.locator(side).boundingBox()]);
    const [bodyBox, contentBox, sideBox] = boxes;
    expect(Math.abs(contentBox!.width - bodyBox!.width)).toBeLessThan(1);
    expect(Math.abs(sideBox!.width - bodyBox!.width)).toBeLessThan(1);
    expect(sideBox!.y).toBeGreaterThanOrEqual(contentBox!.y + contentBox!.height - 1);
    expect(sideBox!.y + sideBox!.height).toBeLessThanOrEqual(bodyBox!.y + bodyBox!.height + 1);
    expect(contentBox!.height).toBeGreaterThan(20);
  }
  await expectStacked(".paper-reading-comments");
  await host.getByRole("button", { name: "阅读目录", exact: true }).click();
  await expectStacked(".paper-reading-navigation");
  await host.evaluate(element => { element.style.height = "360px"; });
  await expectStacked(".paper-reading-navigation");
  await host.evaluate(element => { element.style.width = "900px"; });
  await expect.poll(async () => (await content.boundingBox())!.width).toBeGreaterThan(600);
  expect((await host.locator(".paper-reading-navigation").boundingBox())!.width).toBe(240);
  expect(await contentHandle!.evaluate(element => element.isConnected)).toBe(true);
});

for (const region of ["main", "left", "right", "bar-test", "bottom"]) test(`immersive layout keeps the selected ${region} reader and restores its dock`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${fixture}?scenario=dock`);
  const frame = page.locator(".workspace-frame");
  const target = page.locator(`[data-region="${region}"]`);
  const draft = target.getByRole("textbox", { name: `Draft in ${region}` });
  const handle = await draft.elementHandle();
  await draft.fill(`Edited ${region}`);
  const before = await target.boundingBox();
  await target.getByRole("tab", { name: `Reader ${region}` }).click({ clickCount: 3 });
  await expect(frame).toHaveAttribute("data-reading-focus", "reading");
  await expect(frame).toHaveAttribute("data-reading-focus-region", region);
  await expect(target).toHaveAttribute("data-reading-focus-target", "true");
  const focused = await target.boundingBox();
  expect(focused!.width).toBeGreaterThan(1400);
  expect(focused!.height).toBeGreaterThan(780);
  await expect(draft).toBeVisible();
  await page.keyboard.press("F11");
  await expect(frame).toHaveAttribute("data-reading-focus", "fullscreen");
  await expect.poll(async () => (await target.boundingBox())!.height).toBeGreaterThan(890);
  await draft.click();
  await expect(draft).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(frame).toHaveAttribute("data-reading-focus", "off");
  expect(await target.boundingBox()).toEqual(before);
  expect(await handle!.evaluate(element => element.isConnected)).toBe(true);
  await expect(draft).toHaveValue(`Edited ${region}`);
});
