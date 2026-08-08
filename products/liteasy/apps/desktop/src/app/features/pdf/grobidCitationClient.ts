import {
  attributeReferencesToAnchor,
  type AnchorLocalReferences,
  type AnchorTextPosition,
  type CitationMarker,
  type ReferenceEntry
} from "./citationAttribution";

export const grobidCitationParserVersion = 1;

export type GrobidCitationSnapshot = {
  contentFingerprint: string;
  markers: CitationMarker[];
  parser: "grobid";
  parserVersion: number;
  references: ReferenceEntry[];
};

export type GrobidCitationTransport = (request: {
  body: ArrayBuffer;
  headers: Record<string, string>;
  method: "POST";
  signal?: AbortSignal;
  url: string;
}) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
}>;

function normalizedText(value: string | null | undefined) {
  return value?.replace(/\s+/gu, " ").trim() ?? "";
}

function structuredElementText(element: Element) {
  const parts: string[] = [];
  function visit(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizedText(node.nodeValue);
      if (text) parts.push(text);
      return;
    }
    if (node instanceof Element && node.localName === "date") {
      const when = normalizedText(node.getAttribute("when"));
      if (when && !normalizedText(node.textContent)) parts.push(when);
    }
    node.childNodes.forEach(visit);
  }
  visit(element);
  return normalizedText(parts.join(" "));
}

function localNameElements(parent: Document | Element, localName: string) {
  return Array.from(parent.getElementsByTagNameNS("*", localName));
}

function xmlId(element: Element) {
  return element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id") ??
    element.getAttribute("xml:id") ?? "";
}

function pageFromCoordinates(value: string | null) {
  const page = Number(value?.split(";", 1)[0]?.split(",", 1)[0]);
  return Number.isInteger(page) && page > 0 ? page : undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function locateLabel(pageText: string, label: string, from: number) {
  const direct = pageText.indexOf(label, from);
  if (direct >= 0) return { end: direct + label.length, start: direct };
  const tokens = label.split(/\s+/gu).filter(Boolean);
  if (tokens.length === 0) return null;
  const pattern = new RegExp(tokens.map(escapeRegExp).join("\\s*"), "gu");
  pattern.lastIndex = from;
  const match = pattern.exec(pageText) ?? (() => {
    pattern.lastIndex = 0;
    return pattern.exec(pageText);
  })();
  return match?.index === undefined
    ? null
    : { end: match.index + match[0].length, start: match.index };
}

/** Converts GROBID's TEI structure into the same positional primitives as the local fallback. */
export function parseGrobidCitationTei(
  tei: string,
  pageTexts: Readonly<Record<number, string>>
): Pick<GrobidCitationSnapshot, "markers" | "references"> {
  const document = new DOMParser().parseFromString(tei, "application/xml");
  if (localNameElements(document, "parsererror").length > 0 ||
    localNameElements(document, "TEI").length === 0) {
    throw new Error("GROBID TEI 格式无效。");
  }

  const numberByTarget = new Map<string, number>();
  const references = localNameElements(document, "biblStruct").flatMap((element, index) => {
    const id = xmlId(element);
    const text = structuredElementText(element);
    if (!id || !text) return [];
    const number = index + 1;
    numberByTarget.set(`#${id}`, number);
    return [{ number, text }];
  });

  const cursorByPage = new Map<number, number>();
  const markers: CitationMarker[] = [];
  for (const element of localNameElements(document, "ref")) {
    if (element.getAttribute("type") !== "bibr") continue;
    const numbers = normalizedText(element.getAttribute("target"))
      .split(/\s+/gu)
      .map((target) => numberByTarget.get(target))
      .filter((number): number is number => number !== undefined);
    const label = normalizedText(element.textContent);
    const page = pageFromCoordinates(element.getAttribute("coords"));
    if (numbers.length === 0 || !label || !page || typeof pageTexts[page] !== "string") continue;
    const located = locateLabel(pageTexts[page], label, cursorByPage.get(page) ?? 0);
    if (!located) continue;
    cursorByPage.set(page, located.end);
    markers.push({ ...located, numbers: [...new Set(numbers)], page });
  }
  return { markers, references };
}

export function readGrobidCitationSnapshot(value: unknown): GrobidCitationSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Partial<GrobidCitationSnapshot>;
  if (snapshot.parser !== "grobid" || snapshot.parserVersion !== grobidCitationParserVersion ||
    typeof snapshot.contentFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(snapshot.contentFingerprint) ||
    !Array.isArray(snapshot.markers) || !Array.isArray(snapshot.references)) {
    return null;
  }
  return snapshot as GrobidCitationSnapshot;
}

/** Reuses the established anchor-local attribution rule after GROBID resolves citation targets. */
export function buildGrobidAnchorLocalReferenceIndex(input: {
  anchors: readonly AnchorTextPosition[];
  pageTexts: Readonly<Record<number, string>>;
  snapshot: GrobidCitationSnapshot;
}): AnchorLocalReferences[] {
  return input.anchors.map((anchor) => attributeReferencesToAnchor(anchor, input.snapshot.markers, {
    pageText: input.pageTexts[anchor.page],
    references: input.snapshot.references
  }));
}

async function defaultTransport(request: Parameters<GrobidCitationTransport>[0]) {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method,
    signal: request.signal
  });
}

export function createGrobidCitationClient(input: {
  endpoint: string;
  transport?: GrobidCitationTransport;
}) {
  return async (request: {
    pageTexts: Readonly<Record<number, string>>;
    pdfBytes: Uint8Array;
    signal?: AbortSignal;
  }): Promise<GrobidCitationSnapshot> => {
    const body = request.pdfBytes.buffer.slice(
      request.pdfBytes.byteOffset,
      request.pdfBytes.byteOffset + request.pdfBytes.byteLength
    ) as ArrayBuffer;
    const response = await (input.transport ?? defaultTransport)({
      body,
      headers: { "Content-Type": "application/pdf" },
      method: "POST",
      signal: request.signal,
      url: `${input.endpoint.replace(/\/+$/u, "")}/v1/research/parse-pdf`
    });
    const payload = await response.json();
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "message" in payload &&
        typeof payload.message === "string"
        ? payload.message
        : `结构解析失败（${response.status}）。`;
      throw new Error(message);
    }
    if (!payload || typeof payload !== "object" || !("tei" in payload) ||
      typeof payload.tei !== "string" || !("contentFingerprint" in payload) ||
      typeof payload.contentFingerprint !== "string" || !("parserVersion" in payload) ||
      payload.parserVersion !== grobidCitationParserVersion) {
      throw new Error("结构解析服务返回格式无效。");
    }
    return {
      contentFingerprint: payload.contentFingerprint,
      parser: "grobid",
      parserVersion: payload.parserVersion,
      ...parseGrobidCitationTei(payload.tei, request.pageTexts)
    };
  };
}
