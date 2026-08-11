import { stat } from "node:fs/promises";
import chiSimData from "@tesseract.js-data/chi_sim";
import engData from "@tesseract.js-data/eng";
import { createWorker, OEM, PSM } from "tesseract.js";

const hanPattern = /\p{Script=Han}/u;

function abortError(signal) {
  return signal?.reason ?? new DOMException("OCR cancelled", "AbortError");
}

async function withAbort(promise, signal, onAbort) {
  if (!signal) return promise;
  if (signal.aborted) {
    await onAbort?.();
    throw abortError(signal);
  }
  let abort;
  const cancelled = new Promise((_resolve, reject) => {
    abort = () => {
      void Promise.resolve(onAbort?.()).finally(() => reject(abortError(signal)));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function languageForLabels(labels) {
  return Array.isArray(labels) && labels.some((label) => typeof label === "string" && hanPattern.test(label))
    ? "chi_sim"
    : "eng";
}

export class LocalTesseractRasterOcr {
  constructor({
    createWorkerImpl = createWorker,
    languageData = { chi_sim: chiSimData, eng: engData }
  } = {}) {
    if (typeof createWorkerImpl !== "function" || !languageData?.eng || !languageData?.chi_sim) {
      throw new Error("raster_ocr_configuration_invalid");
    }
    this.createWorker = createWorkerImpl;
    this.languageData = languageData;
    this.engine = "tesseract.js/6.0.1-local";
  }

  async assertConfigured() {
    const languages = [];
    for (const code of ["eng", "chi_sim"]) {
      const data = this.languageData[code];
      if (data?.code !== code || data.gzip !== true || typeof data.langPath !== "string") {
        throw new Error("raster_ocr_configuration_invalid");
      }
      const model = await stat(`${data.langPath}/${code}.traineddata.gz`);
      if (!model.isFile() || model.size < 1024 * 1024) throw new Error("raster_ocr_model_missing");
      languages.push(code);
    }
    return { engine: this.engine, languages };
  }

  async recognize(bytes, { labels = [], signal } = {}) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error("raster_ocr_input_invalid");
    const language = languageForLabels(labels);
    const data = this.languageData[language];
    let worker;
    const creating = Promise.resolve(this.createWorker(language, OEM.LSTM_ONLY, {
      cacheMethod: "readOnly",
      gzip: data.gzip,
      langPath: data.langPath
    }));
    creating.then((created) => {
      if (signal?.aborted) void created.terminate();
    }).catch(() => {});
    try {
      worker = await withAbort(creating, signal);
      await withAbort(worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        user_defined_dpi: "300"
      }), signal, () => worker.terminate());
      const result = await withAbort(
        worker.recognize(Buffer.from(bytes)),
        signal,
        () => worker.terminate()
      );
      const text = result?.data?.text;
      if (typeof text !== "string") throw new Error("raster_ocr_failed");
      return { text };
    } finally {
      await worker?.terminate().catch(() => {});
    }
  }
}
