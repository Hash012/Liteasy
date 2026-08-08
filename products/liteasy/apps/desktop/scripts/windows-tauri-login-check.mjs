import { chromium } from "@playwright/test";

const endpoint = process.env.LITEASY_TAURI_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const email = process.env.LITEASY_ACCEPTANCE_ACCOUNT_EMAIL;
const password = process.env.LITEASY_ACCEPTANCE_ACCOUNT_PASSWORD;

if (!email || !password) {
  throw new Error("LITEASY_ACCEPTANCE_ACCOUNT_EMAIL and LITEASY_ACCEPTANCE_ACCOUNT_PASSWORD are required");
}

const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts().flatMap((context) => context.pages())[0];
if (!page) throw new Error("No WebView2 page is attached to the Tauri process.");

const failures = [];
page.on("requestfailed", (request) => {
  failures.push({
    error: request.failure()?.errorText ?? "unknown",
    method: request.method(),
    url: request.url()
  });
});

const dialog = page.getByRole("dialog", { name: "轻量登录面板" });
await dialog.waitFor({ state: "visible" });
await dialog.getByLabel("邮箱").fill(email);
await dialog.getByLabel("密码").fill(password);
await dialog.getByRole("button", { name: "登录", exact: true }).click();

let outcome = "authenticated";
try {
  await dialog.waitFor({ state: "hidden", timeout: 15_000 });
} catch {
  outcome = "failed";
}

const result = {
  failures,
  outcome,
  pageText: await page.locator("body").innerText()
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await browser.close();

if (outcome !== "authenticated") process.exitCode = 1;
