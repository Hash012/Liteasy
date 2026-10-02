import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";

// Synthetic six-page document. No user files, native grants, or network transport.
function fixturePdf() {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R 9 0 R 11 0 R 13 0 R] /Count 6 >>"];
  for (let page = 1; page <= 6; page += 1) {
    const text = `BT /F1 24 Tf 50 730 Td (Synthetic PDF page ${page}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 15 0 R >> >> /Contents ${2 * page + 2} 0 R >>`, `<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let data = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(data.length); data += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = data.length;
  data += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { data += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  return Buffer.from(`${data}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`).toString("base64");
}
const moduleId = "virtual:pdf-position-fixture";
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { PdfReader } from "/src/app/features/pdf/PdfReader.tsx";
import { ObjectWorkbenchContext } from "/src/app/features/objects/objectWorkbenchPort.ts";
import { buildOriginalReaderPaper } from "/src/app/features/original-files/originalFileService.ts";
import "/src/app/styles/app.css";
const bytes=Uint8Array.from(atob(${JSON.stringify(fixturePdf())}), character=>character.charCodeAt(0));
const paper=await buildOriginalReaderPaper({id:crypto.randomUUID(),path:"/synthetic/manual.pdf",fileName:"manual.pdf",format:"pdf",sizeBytes:bytes.length,modifiedUnixMs:1},bytes);
const loadPdfSource=async()=>bytes.slice();
const style=document.createElement("style");style.textContent="html,body,#root{height:100%;margin:0}.position-fixture{height:100vh;display:flex}.position-fixture>.pdf-reader{flex:1;height:100%;min-height:0}";document.head.append(style);
createRoot(document.getElementById("root")).render(React.createElement(FluentProvider,{theme:webLightTheme},React.createElement(ObjectWorkbenchContext.Provider,{value:{scopeId:"local"}},React.createElement("div",{className:"position-fixture"},React.createElement(PdfReader,{selectedPapers:[paper],zoom:100,loadPdfSource})))));
`;
let browser;
const server = await createServer({
  configFile: false, root: fileURLToPath(new URL("../", import.meta.url)), appType: "custom", logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
  plugins: [react(), {
    name: "pdf-position-synthetic-fixture",
    resolveId: (id) => id === moduleId ? `\0${moduleId}` : undefined,
    load: (id) => id === `\0${moduleId}` ? source : undefined,
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url !== "/__position") return next();
        try {
          const html = await vite.transformIndexHtml("/__position", '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@id/virtual:pdf-position-fixture"></script></body></html>');
          response.setHeader("Content-Type", "text/html"); response.end(html);
        } catch (error) { next(error); }
      });
    }
  }]
});
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__position`);
  await page.getByLabel("共 6 页", { exact: true }).waitFor({ timeout: 60000 });
  const pageNumber = page.getByRole("spinbutton", { name: "当前页码" });
  await pageNumber.fill("4"); await pageNumber.press("Enter");
  // Wait until the requested navigation has visibly finished, then verify its durable checkpoint.
  await page.waitForFunction(() => {
    const stage = document.querySelector(".pdf-stage"), target = document.querySelector('[data-page="4"]');
    return stage.scrollTop > 0 && Math.abs(target.getBoundingClientRect().top - stage.getBoundingClientRect().top) < 35;
  });
  await expect(pageNumber).toHaveValue("4");
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("liteasy.objects.v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise((resolve) => { const request = db.transaction("records").objectStore("records").getAll(); request.onsuccess = () => resolve(request.result.some((row) => row.key.startsWith("reader-state/pdf/") && row.value.page === 4)); }); }
    finally { db.close(); }
  });
  await page.reload(); await page.getByLabel("共 6 页", { exact: true }).waitFor();
  await expect(pageNumber).toHaveValue("4");
  await page.waitForFunction(() => {
    const stage = document.querySelector(".pdf-stage"), target = document.querySelector('[data-page="4"]');
    return stage.scrollTop > 0 && Math.abs(target.getBoundingClientRect().top - stage.getBoundingClientRect().top) < 35;
  });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ status: "passed", transport: "browser IndexedDB; synthetic grant", page: 4, scrollTop: await page.locator(".pdf-stage").evaluate((element) => element.scrollTop), pageErrors: errors }));
} finally { await browser?.close(); await server.close(); }
