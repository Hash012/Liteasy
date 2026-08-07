import { chromium } from "@playwright/test";

const endpoint = process.env.LITEASY_TAURI_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts().flatMap((context) => context.pages())[0];

if (!page) {
  throw new Error("No WebView2 page is attached to the Tauri process.");
}

const result = await page.evaluate(async () => {
  const internals = window.__TAURI_INTERNALS__;
  if (typeof internals?.invoke !== "function") {
    throw new Error("The attached page is not a Tauri WebView.");
  }
  return {
    bodyText: document.body.innerText,
    internals: Object.keys(internals).sort(),
    localStorageKeys: Object.keys(localStorage).sort(),
    snapshot: await internals.invoke("load_local_library_snapshot"),
    title: document.title,
    url: location.href
  };
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
