import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { LocalTesseractRasterOcr } from "./visualizationRasterOcr.mjs";

const glyphs = {
  C: ["1111", "1000", "1000", "1000", "1000", "1000", "1111"],
  E: ["1111", "1000", "1000", "1110", "1000", "1000", "1111"],
  L: ["1000", "1000", "1000", "1000", "1000", "1000", "1111"]
};

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return output;
}

function textPng(text) {
  const width = 640;
  const height = 200;
  const scale = 18;
  const raw = Buffer.alloc((width * 4 + 1) * height, 255);
  for (let y = 0; y < height; y += 1) raw[y * (width * 4 + 1)] = 0;
  let originX = 90;
  const originY = 35;
  for (const character of text) {
    const glyph = glyphs[character];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const offset = (originY + row * scale + dy) * (width * 4 + 1) + 1 +
              (originX + column * scale + dx) * 4;
            raw.fill(0, offset, offset + 3);
            raw[offset + 3] = 255;
          }
        }
      }
    }
    originX += 5 * scale;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

test("verifies bundled language data and performs real local OCR without network access", async () => {
  const ocr = new LocalTesseractRasterOcr();
  assert.deepEqual(await ocr.assertConfigured(), {
    engine: "tesseract.js/6.0.1-local",
    languages: ["eng", "chi_sim"]
  });
  const result = await ocr.recognize(textPng("CELL"), { labels: ["CELL"] });
  assert.match(result.text.replace(/[^A-Z]/giu, "").toUpperCase(), /CELL/);
});

test("selects Chinese data from typed labels and terminates the worker on cancellation", async () => {
  let selectedLanguage;
  let terminated = 0;
  let recognizeStarted;
  const started = new Promise((resolve) => { recognizeStarted = resolve; });
  const ocr = new LocalTesseractRasterOcr({
    createWorkerImpl: async (language) => {
      selectedLanguage = language;
      return {
        async recognize() {
          recognizeStarted();
          return new Promise(() => {});
        },
        async setParameters() {},
        async terminate() { terminated += 1; }
      };
    },
    languageData: {
      chi_sim: { code: "chi_sim", gzip: true, langPath: "/fixture/chi_sim" },
      eng: { code: "eng", gzip: true, langPath: "/fixture/eng" }
    }
  });
  const controller = new AbortController();
  const pending = ocr.recognize(new Uint8Array([1]), { labels: ["细胞"], signal: controller.signal });
  await started;
  controller.abort(new DOMException("cancelled", "AbortError"));

  await assert.rejects(pending, (error) => error?.name === "AbortError");
  assert.equal(selectedLanguage, "chi_sim");
  assert.ok(terminated >= 1);
});
