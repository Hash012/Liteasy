import { createHash } from "node:crypto";

export const grobidParserVersion = 1;

export class GrobidParseError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "GrobidParseError";
    this.code = code;
    this.status = status;
  }
}

function isPdf(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export class GrobidParseService {
  constructor({ endpoint, fetchImpl = fetch, maximumPdfBytes = 32 * 1024 * 1024, repository, timeoutMs = 180_000 }) {
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.maximumPdfBytes = maximumPdfBytes;
    this.repository = repository;
    this.timeoutMs = timeoutMs;
    this.inFlight = new Map();
  }

  get configured() {
    return typeof this.endpoint === "string" && this.endpoint.length > 0;
  }

  async assertConfigured() {
    if (!this.configured) return { configured: false };
    let response;
    try {
      response = await this.fetchImpl(`${this.endpoint}/api/isalive`, {
        method: "GET",
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 10_000))
      });
    } catch {
      throw new Error("grobid_readiness_failed");
    }
    if (!response.ok) throw new Error("grobid_readiness_failed");
    return { configured: true };
  }

  async #parseUpstream(pdfBytes) {
    const form = new FormData();
    form.set("input", new Blob([pdfBytes], { type: "application/pdf" }), "paper.pdf");
    // Keep parsing self-contained: citation consolidation would disclose citation text to Crossref.
    form.set("consolidateCitations", "0");
    form.set("includeRawCitations", "1");
    for (const coordinate of ["ref", "biblStruct", "note"]) form.append("teiCoordinates", coordinate);
    let response;
    try {
      response = await this.fetchImpl(`${this.endpoint}/api/processFulltextDocument`, {
        body: form,
        method: "POST",
        signal: combinedSignal(undefined, this.timeoutMs)
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new GrobidParseError("grobid_timeout", 504);
      }
      throw new GrobidParseError("grobid_unavailable", 503);
    }
    if (!response.ok) throw new GrobidParseError("grobid_upstream_error", 503);
    let tei;
    try {
      tei = await response.text();
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new GrobidParseError("grobid_timeout", 504);
      }
      throw new GrobidParseError("grobid_unavailable", 503);
    }
    if (!tei.includes("<TEI") || Buffer.byteLength(tei) > 24 * 1024 * 1024) {
      throw new GrobidParseError("grobid_response_invalid", 502);
    }
    return tei;
  }

  async parse(pdfBytes, context) {
    if (!this.configured) throw new GrobidParseError("grobid_not_configured", 503);
    if (!isPdf(pdfBytes) || pdfBytes.byteLength > this.maximumPdfBytes) {
      throw new GrobidParseError("grobid_pdf_invalid", 400);
    }
    const contentFingerprint = createHash("sha256").update(pdfBytes).digest("hex");
    const cached = await this.repository.get(contentFingerprint);
    if (cached?.parserVersion === grobidParserVersion) {
      await this.repository.recordReuse({
        contentFingerprint,
        parserVersion: grobidParserVersion,
        subjectId: context.subjectId,
        traceId: context.traceId
      });
      return { ...cached, parser: "grobid", reused: true };
    }
    let pending = this.inFlight.get(contentFingerprint);
    if (!pending) {
      pending = this.#parseUpstream(pdfBytes).finally(() => {
        this.inFlight.delete(contentFingerprint);
      });
      this.inFlight.set(contentFingerprint, pending);
    }
    const tei = await Promise.race([
      pending,
      new Promise((_, reject) => context.signal?.addEventListener("abort", () => {
        reject(new GrobidParseError("grobid_request_aborted", 499));
      }, { once: true }))
    ]);
    const stored = await this.repository.save({
      contentFingerprint,
      parserVersion: grobidParserVersion,
      subjectId: context.subjectId,
      tei,
      traceId: context.traceId
    });
    return { ...stored, parser: "grobid", reused: false };
  }
}
