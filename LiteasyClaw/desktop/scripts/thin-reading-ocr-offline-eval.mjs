import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";

const fixturePath = resolve(process.cwd(), "public/papers/liteasy-ocr-scanned-fixture.pdf");
const bilingualFixturePath = resolve(process.cwd(), "public/papers/liteasy-ocr-bilingual-fixture.png");
const languageDataPath = resolve(process.cwd(), "public/ocr");
const expectedText = "Liteasy scanned evidence OCR must preserve this sentence.";

pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
  resolve(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")
).href;

const document = await pdfjsLib.getDocument(new Uint8Array(readFileSync(fixturePath))).promise;
async function createOfflineWorker(language) {
  return createWorker(language, 1, {
    cacheMethod: "none",
    gzip: true,
    langPath: languageDataPath
  });
}

async function recognize(language, image) {
  const worker = await createOfflineWorker(language);
  try {
    return (await worker.recognize(image)).data.text.replace(/\s+/g, " ").trim();
  } finally {
    await worker.terminate();
  }
}

try {
  const page = await document.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const recognizedText = await recognize("eng", canvas.toBuffer("image/png"));

  if (!recognizedText.includes(expectedText)) {
    throw new Error("扫描 PDF OCR 验收失败：识别结果未保留 fixture 的完整证据句。");
  }

  const bilingualImage = readFileSync(bilingualFixturePath);
  const chineseText = await recognize("chi_sim", bilingualImage);
  const bilingualText = await recognize("eng+chi_sim", bilingualImage);
  const compactChinese = chineseText.replace(/\s+/g, "");
  const compactBilingual = bilingualText.replace(/\s+/g, "");
  if (!compactChinese.includes("读证据") || !compactChinese.includes("Transformer")) {
    throw new Error("简体中文 OCR 验收失败：未保留中文证据主体与术语。");
  }
  if (!compactBilingual.includes("薄读证据") || !compactBilingual.includes("lateinteractionimprovesretrieval")) {
    throw new Error("中英混合 OCR 验收失败：未同时保留中文证据与英文句子。");
  }
  console.log("Offline English, Chinese, and bilingual OCR evaluation passed.");
} finally {
  await document.destroy();
}
