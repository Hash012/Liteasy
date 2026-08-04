import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MinerU } from "mineru-open-sdk";
import { analyzeMineruFigures } from "./mineruFigureAnalysis.mjs";
import { fetchWithConfiguredProxy } from "./providers/proxyFetch.mjs";

const maximumImageCount = 16;
const maximumImageBytes = 8 * 1024 * 1024;
let mineruFetchQueue = Promise.resolve();

async function withProxyAwareMineruFetch(action) {
  // The SDK uses global fetch internally and offers no transport injection. Serialize
  // this narrow compatibility shim so concurrent requests never restore each other's
  // global fetch implementation.
  const previous = mineruFetchQueue;
  let release;
  mineruFetchQueue = new Promise((resolve) => { release = resolve; });
  await previous;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = fetchWithConfiguredProxy;
  try {
    return await action();
  } finally {
    globalThis.fetch = nativeFetch;
    release();
  }
}

function textFromContentItem(item) {
  if (!item || typeof item !== "object") return "";
  const values = [item.text, item.content, item.latex, item.html, item.table_body]
    .filter((value) => typeof value === "string");
  return values.join("\n").replace(/\s+/g, " ").trim();
}

function pageFromContentItem(item) {
  if (!item || typeof item !== "object") return 1;
  const raw = item.page_idx ?? item.page ?? item.page_id;
  const page = Number(raw);
  return Number.isFinite(page) && page >= 0 ? Math.floor(page) + 1 : 1;
}

function contentPages(contentList, fallbackMarkdown) {
  const pages = new Map();
  for (const item of Array.isArray(contentList) ? contentList : []) {
    const text = textFromContentItem(item);
    if (!text) continue;
    const page = pageFromContentItem(item);
    pages.set(page, [...(pages.get(page) ?? []), text]);
  }
  if (pages.size === 0 && typeof fallbackMarkdown === "string" && fallbackMarkdown.trim()) {
    pages.set(1, [fallbackMarkdown]);
  }
  return [...pages.entries()]
    .sort(([left], [right]) => left - right)
    .map(([page, parts]) => ({ page, text: parts.join("\n\n"), textExtraction: "mineru" }));
}

function mediaType(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export function normalizeMineruAssetPath(value) {
  if (typeof value !== "string") return "";
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const segments = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/").toLowerCase();
}

function suffixPathMatch(left, right) {
  if (!left || !right) return false;
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function contentItemAssetPaths(item) {
  if (!item || typeof item !== "object") return [];
  return [item.img_path, item.image_path, item.path]
    .map((value) => normalizeMineruAssetPath(value))
    .filter(Boolean);
}

export function findMatchingContentItemForImagePath(contentList, imagePath) {
  const normalizedImagePath = normalizeMineruAssetPath(imagePath);
  if (!normalizedImagePath || !Array.isArray(contentList)) return null;
  for (const item of contentList) {
    if (contentItemAssetPaths(item).some((value) => suffixPathMatch(normalizedImagePath, value))) {
      return item;
    }
  }
  return null;
}

export function figureAssets(images, contentList) {
  const figures = [];
  let remaining = maximumImageBytes;
  for (const image of Array.isArray(images) ? images : []) {
    if (figures.length >= maximumImageCount) break;
    if (!(image?.data instanceof Uint8Array)) continue;
    if (image.data.byteLength > remaining) continue;
    remaining -= image.data.byteLength;
    const matchingItem = findMatchingContentItemForImagePath(contentList, image.path);
    figures.push({
      alt: `MinerU 提取图表 ${figures.length + 1}`,
      dataUrl: `data:${mediaType(image.name)};base64,${Buffer.from(image.data).toString("base64")}`,
      id: `mineru-figure-${figures.length + 1}`,
      page: pageFromContentItem(matchingItem),
      sourcePath: image.path
    });
  }
  return figures;
}

export async function extractPdfWithMineru({
  bytes,
  filename,
  modelConfig,
  token
}) {
  if (!token) {
    throw new Error("MinerU 未配置。请在 dev-cloud/.env.local 设置 MINERU_TOKEN。");
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "liteasy-mineru-"));
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.pdf$/i, "") || "document";
  const pdfPath = path.join(directory, `${safeFilename}.pdf`);
  try {
    await writeFile(pdfPath, bytes, { mode: 0o600 });
    const result = await withProxyAwareMineruFetch(() => new MinerU(token).extract(pdfPath, {
      formula: true,
      language: "en",
      model: "vlm",
      ocr: true,
      table: true,
      timeout: 600
    }));
    if (result.state !== "done" || !result.markdown) {
      throw new Error(result.error || "MinerU 未返回可用的解析结果。");
    }
    const extractedFigures = figureAssets(result.images, result.contentList);
    let figureAnalysis = { status: "skipped" };
    let figures = extractedFigures;
    if (modelConfig?.apiKey && extractedFigures.length > 0) {
      try {
        const analyzed = await analyzeMineruFigures({
          apiBaseUrl: modelConfig.apiBaseUrl,
          apiKey: modelConfig.apiKey,
          figures: extractedFigures,
          model: modelConfig.model,
          paperTitle: filename.replace(/\.pdf$/i, ""),
          reasoningEffort: modelConfig.reasoningEffort
        });
        figures = analyzed.figures;
        figureAnalysis = {
          selectedFigureIds: analyzed.selectedFigureIds ?? [],
          status: analyzed.status
        };
      } catch (error) {
        // Extraction is still useful if a compatible model endpoint does not yet accept
        // image inputs. Preserve every original figure and surface the limited state.
        figureAnalysis = {
          message: error instanceof Error ? error.message : "图表视觉理解暂时不可用。",
          status: "unavailable"
        };
      }
    }
    return {
      figureAnalysis,
      figures,
      markdown: result.markdown,
      pages: contentPages(result.contentList, result.markdown)
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
