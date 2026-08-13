import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeMineruFigures } from "./mineruFigureAnalysis.mjs";

export const maximumMineruPdfBytes = 24 * 1024 * 1024;
export const maximumMineruRequestBytes = 34 * 1024 * 1024;

const maximumImageBytes = 8 * 1024 * 1024;
const maximumImageCount = 16;

export class MineruPdfError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "MineruPdfError";
    this.code = code;
    this.status = status;
  }
}

function validateRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).some((key) => !new Set(["bytesBase64", "filename"]).has(key))) {
    throw new MineruPdfError("invalid_mineru_pdf_request");
  }
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const bytesBase64 = typeof body.bytesBase64 === "string" ? body.bytesBase64.trim() : "";
  if (!filename || filename.length > 180 || !/\.pdf$/i.test(filename) ||
    /[\u0000-\u001f/\\]/.test(filename) || !bytesBase64 || bytesBase64.length > 33_554_432 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bytesBase64)) {
    throw new MineruPdfError("invalid_mineru_pdf_request");
  }
  const bytes = Buffer.from(bytesBase64, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maximumMineruPdfBytes ||
    bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new MineruPdfError("invalid_mineru_pdf_content", 413);
  }
  return { bytes, filename };
}

function textFromContentItem(item) {
  if (!item || typeof item !== "object") return "";
  return [item.text, item.content, item.latex, item.html, item.table_body]
    .filter((value) => typeof value === "string")
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function pageFromContentItem(item) {
  const page = Number(item?.page_idx ?? item?.page ?? item?.page_id);
  return Number.isFinite(page) && page >= 0 ? Math.floor(page) + 1 : 1;
}

function contentPages(contentList, markdown) {
  const pages = new Map();
  for (const item of Array.isArray(contentList) ? contentList : []) {
    const text = textFromContentItem(item);
    if (!text) continue;
    const page = pageFromContentItem(item);
    pages.set(page, [...(pages.get(page) ?? []), text]);
  }
  if (pages.size === 0 && typeof markdown === "string" && markdown.trim()) pages.set(1, [markdown]);
  return [...pages.entries()]
    .sort(([left], [right]) => left - right)
    .map(([page, parts]) => ({ page, text: parts.join("\n\n"), textExtraction: "mineru" }));
}

function normalizeAssetPath(value) {
  if (typeof value !== "string") return "";
  const segments = [];
  for (const segment of value.trim().replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/").toLowerCase();
}

function matchingContentItem(contentList, imagePath) {
  const normalized = normalizeAssetPath(imagePath);
  return (Array.isArray(contentList) ? contentList : []).find((item) => (
    [item?.img_path, item?.image_path, item?.path].some((candidate) => {
      const value = normalizeAssetPath(candidate);
      return value && (value === normalized || value.endsWith(`/${normalized}`) || normalized.endsWith(`/${value}`));
    })
  ));
}

function imageMediaType(name = "") {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function figureAssets(images, contentList) {
  const figures = [];
  let remainingBytes = maximumImageBytes;
  for (const image of Array.isArray(images) ? images : []) {
    if (figures.length >= maximumImageCount) break;
    if (!(image?.data instanceof Uint8Array) || image.data.byteLength > remainingBytes) continue;
    remainingBytes -= image.data.byteLength;
    figures.push({
      alt: `MinerU extracted figure ${figures.length + 1}`,
      dataUrl: `data:${imageMediaType(image.name)};base64,${Buffer.from(image.data).toString("base64")}`,
      id: `mineru-figure-${figures.length + 1}`,
      page: pageFromContentItem(matchingContentItem(contentList, image.path)),
      sourcePath: typeof image.path === "string" ? image.path.slice(0, 500) : ""
    });
  }
  return figures;
}

async function defaultExtract({ pdfPath, timeoutSeconds, token }) {
  const { MinerU } = await import("mineru-open-sdk");
  return new MinerU(token).extract(pdfPath, {
    formula: true,
    language: "en",
    model: "vlm",
    ocr: true,
    table: true,
    timeout: timeoutSeconds
  });
}

async function extractToPublicResult(input, config, extractImpl, analyzeFiguresImpl) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "liteasy-mineru-"));
  const pdfPath = path.join(directory, "document.pdf");
  try {
    await writeFile(pdfPath, input.bytes, { mode: 0o600 });
    const result = await extractImpl({
      filename: input.filename,
      pdfPath,
      timeoutSeconds: Math.ceil(config.timeoutMs / 1_000),
      token: config.token
    });
    if (result?.state !== "done" || typeof result.markdown !== "string" || !result.markdown.trim()) {
      throw new Error("MinerU did not return a completed extraction");
    }
    const extractedFigures = figureAssets(result.images, result.contentList);
    let figureAnalysis = { status: "skipped" };
    let figures = extractedFigures;
    if (config.model?.apiKey && extractedFigures.length > 0) {
      try {
        const analyzed = await analyzeFiguresImpl({
          fetchImpl: config.modelFetch,
          figures: extractedFigures,
          modelConfig: config.model,
          paperTitle: input.filename.replace(/\.pdf$/i, ""),
          timeoutMs: Math.min(config.timeoutMs, 300_000)
        });
        figureAnalysis = {
          selectedFigureIds: analyzed.selectedFigureIds ?? [],
          status: analyzed.status
        };
        figures = analyzed.figures;
      } catch {
        figureAnalysis = {
          message: "Figure understanding is temporarily unavailable; original extracted figures are preserved.",
          status: "unavailable"
        };
      }
    }
    return {
      cache: "miss",
      figureAnalysis,
      figures,
      markdown: result.markdown,
      pages: contentPages(result.contentList, result.markdown)
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export class MineruPdfService {
  constructor(config = {}, {
    analyzeFiguresImpl = analyzeMineruFigures,
    extractImpl = defaultExtract,
    logger = console
  } = {}) {
    this.config = config;
    this.extractImpl = extractImpl;
    this.analyzeFiguresImpl = analyzeFiguresImpl;
    this.logger = logger;
    this.active = 0;
    this.inFlight = new Map();
  }

  get configured() {
    return Boolean(this.config.token);
  }

  reconfigure(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("mineru_configuration_invalid");
    }
    this.config = config;
  }

  async extract(body, context = {}) {
    if (!this.configured) throw new MineruPdfError("mineru_not_configured", 503);
    const input = validateRequest(body);
    const contentHash = createHash("sha256").update(input.bytes).digest("hex");
    const existing = this.inFlight.get(contentHash);
    if (existing) return { ...await existing, cache: "shared" };
    if (this.active >= (this.config.maximumConcurrency ?? 2)) {
      throw new MineruPdfError("mineru_capacity_exceeded", 503);
    }
    this.active += 1;
    const operation = extractToPublicResult(input, this.config, this.extractImpl, this.analyzeFiguresImpl)
      .catch((error) => {
        this.logger.error?.("[mineru] extraction failed", {
          errorName: error?.name ?? "Error",
          subjectId: context.subjectId,
          traceId: context.traceId
        });
        throw new MineruPdfError("mineru_extraction_failed", 502);
      })
      .finally(() => {
        this.active -= 1;
        this.inFlight.delete(contentHash);
      });
    this.inFlight.set(contentHash, operation);
    return operation;
  }
}
