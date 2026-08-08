import { createHash } from "node:crypto";

export const grobidParserVersion = 1;

export class GrobidParseError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function fingerprintPdf(pdfBytes) {
  return createHash("sha256").update(pdfBytes).digest("hex");
}

export function isPdfBytes(pdfBytes) {
  return Buffer.isBuffer(pdfBytes) && pdfBytes.length >= 5 &&
    pdfBytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

export async function parsePdfWithGrobid(pdfBytes, options = {}) {
  if (!isPdfBytes(pdfBytes)) {
    throw new GrobidParseError("invalid_pdf", "上传内容不是有效的 PDF。", 400);
  }
  const endpoint = typeof options.endpoint === "string" && options.endpoint.trim()
    ? options.endpoint.replace(/\/+$/, "")
    : "http://127.0.0.1:8070";
  const form = new FormData();
  form.set("input", new Blob([pdfBytes], { type: "application/pdf" }), "paper.pdf");
  form.set("consolidateCitations", "1");
  form.set("includeRawCitations", "1");
  // GROBID models this as a repeated multipart field, not a comma-delimited value.
  form.append("teiCoordinates", "ref");
  form.append("teiCoordinates", "biblStruct");
  form.append("teiCoordinates", "note");

  let response;
  try {
    response = await (options.transport ?? fetch)(`${endpoint}/api/processFulltextDocument`, {
      body: form,
      method: "POST",
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000)
    });
  } catch (error) {
    throw new GrobidParseError(
      error?.name === "TimeoutError" ? "grobid_timeout" : "grobid_unavailable",
      error?.name === "TimeoutError" ? "结构解析服务超时，已保留本地解析结果。" : "结构解析服务不可用，已保留本地解析结果。",
      503
    );
  }
  if (!response?.ok) {
    throw new GrobidParseError(
      "grobid_upstream_error",
      `结构解析服务返回 HTTP ${response?.status ?? "unknown"}，已保留本地解析结果。`,
      503
    );
  }
  const tei = await response.text();
  if (!tei.includes("<TEI") || tei.length > (options.maximumTeiBytes ?? 24 * 1024 * 1024)) {
    throw new GrobidParseError(
      "invalid_grobid_tei",
      "结构解析服务返回了无效或过大的 TEI，已保留本地解析结果。",
      502
    );
  }
  return tei;
}
