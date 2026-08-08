import type { RetrievalChunk } from "../retrieval/retrieval.types";
import { normalizeMineruAssetPath } from "./mineruImageSources";

export type TranslationAnchor = {
  id: string;
  label: string;
  source: string;
};

export type AnchoredTranslationDocument = {
  anchors: TranslationAnchor[];
  markedSource: string;
};

export type TranslationAnchorAudit = {
  duplicateIds: string[];
  emptyIds: string[];
  expectedIds: string[];
  foundIds: string[];
  hasUnanchoredPrefix: boolean;
  malformedMarkers: string[];
  missingIds: string[];
  outOfOrder: boolean;
  unexpectedIds: string[];
  valid: boolean;
};

export type AnchoredTranslationBatch = {
  anchorIds: string[];
  markedSource: string;
};

const markerPattern = /<!--\s*liteasy-anchor:([a-z0-9-]+)\s*-->/gi;
const canonicalMarkerPattern = /<!-- liteasy-anchor:([a-z0-9-]+) -->/g;
const htmlCommentPattern = /<!--[\s\S]*?-->/g;
const markdownImagePattern = /!\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+["'][^)\n]*["'])?\s*\)/g;
const targetBlockSize = 3_600;

function splitLongBlock(value: string) {
  const blocks: string[] = [];
  let remaining = value.trim();
  while (remaining.length > targetBlockSize) {
    const boundary = Math.max(
      remaining.lastIndexOf("\n", targetBlockSize),
      remaining.lastIndexOf("。", targetBlockSize),
      remaining.lastIndexOf(". ", targetBlockSize)
    );
    const end = boundary > targetBlockSize * .45 ? boundary + 1 : targetBlockSize;
    blocks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) blocks.push(remaining);
  return blocks;
}

function splitMarkdown(markdown: string) {
  const pieces = markdown.trim().split(/\n{2,}/).filter(Boolean);
  const groups: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > targetBlockSize) {
      groups.push(...splitLongBlock(current));
      current = "";
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) groups.push(...splitLongBlock(current));
  return groups;
}

function marker(anchorId: string) {
  return `<!-- liteasy-anchor:${anchorId} -->`;
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function findAnchorLikeComments(value: string) {
  return [...value.matchAll(htmlCommentPattern)]
    .map((match) => match[0])
    .filter((comment) => /liteasy-anchor:/i.test(comment));
}

function findCanonicalMarkers(value: string) {
  return [...value.matchAll(canonicalMarkerPattern)].map((match) => ({
    id: match[1],
    index: match.index ?? 0,
    marker: match[0]
  }));
}

function markdownImages(value: string) {
  return [...value.matchAll(markdownImagePattern)].map((match) => ({
    source: normalizeMineruAssetPath(match[1] ?? match[2] ?? ""),
    token: match[0]
  })).filter(({ source }) => source.length > 0);
}

function anchoredSegments(value: string) {
  const markers = findCanonicalMarkers(value);
  return markers.map((entry, index) => ({
    content: value.slice(entry.index + entry.marker.length, markers[index + 1]?.index ?? value.length).trim(),
    id: entry.id
  }));
}

export function restoreMissingMarkdownImages(source: string, translated: string) {
  const existingSources = new Set(markdownImages(translated).map(({ source: imageSource }) => imageSource));
  const missingTokens = markdownImages(source)
    .filter(({ source: imageSource }) => !existingSources.has(imageSource))
    .map(({ token }) => token);
  return [translated.trim(), ...missingTokens].filter(Boolean).join("\n\n");
}

/**
 * Images are source-owned document assets just like synchronization anchors.
 * Once anchor integrity is valid, deterministically restore any image reference
 * the model omitted or rewrote inside the corresponding source anchor.
 */
export function restoreMissingTranslationImages(markedSource: string, translation: string) {
  const sourceByAnchor = new Map(anchoredSegments(markedSource).map((segment) => [segment.id, segment.content]));
  const translated = anchoredSegments(translation);
  if (sourceByAnchor.size === 0 || translated.length === 0) return translation;
  return translated.map((segment) => {
    const content = restoreMissingMarkdownImages(sourceByAnchor.get(segment.id) ?? "", segment.content);
    return `${marker(segment.id)}${content ? `\n${content}` : ""}`;
  }).join("\n\n");
}

/**
 * Anchor boundaries come only from MinerU source text. The model is asked to
 * preserve the resulting comments verbatim, making synchronized reading
 * independent from an AI-generated paragraph segmentation.
 */
export function buildAnchoredTranslationDocument(chunks: readonly RetrievalChunk[]): AnchoredTranslationDocument {
  const ordered = [...chunks].sort((left, right) => left.page - right.page);
  const sourceMarkdown = ordered.find((chunk) => chunk.sourceMarkdown?.trim())?.sourceMarkdown?.trim();
  const rawAnchors = sourceMarkdown
    ? splitMarkdown(sourceMarkdown).map((source, index) => ({ label: `原文第 ${index + 1} 节`, source }))
    : ordered.flatMap((chunk, index) => splitLongBlock(chunk.snippet).map((source, blockIndex) => ({
      label: `第 ${chunk.page} 页${blockIndex > 0 ? ` · 第 ${blockIndex + 1} 段` : ""}`,
      source,
      sort: `${String(chunk.page).padStart(5, "0")}-${String(index).padStart(4, "0")}-${blockIndex}`
    }))).sort((left, right) => (left.sort ?? "").localeCompare(right.sort ?? ""));
  const anchors = rawAnchors
    .filter((anchor) => anchor.source.trim())
    .map((anchor, index) => ({
      id: `segment-${String(index + 1).padStart(3, "0")}`,
      label: anchor.label,
      source: anchor.source.trim()
    }));
  return {
    anchors,
    markedSource: anchors.map((anchor) => `${marker(anchor.id)}\n${anchor.source}`).join("\n\n")
  };
}

export function splitTranslationByAnchor(translation: string, anchors: readonly TranslationAnchor[]) {
  const positions = [...translation.matchAll(markerPattern)].map((match) => ({
    id: match[1].toLowerCase(),
    index: match.index ?? 0,
    markerLength: match[0].length
  }));
  const byId = new Map<string, string>();
  positions.forEach((position, index) => {
    const end = positions[index + 1]?.index ?? translation.length;
    byId.set(position.id, translation.slice(position.index + position.markerLength, end).trim());
  });
  return anchors.map((anchor, index) => ({
    anchor,
    translated: byId.get(anchor.id) ?? (index === 0 && positions.length === 0 ? translation.trim() : "")
  }));
}

/**
 * Model output is accepted only when every source-owned marker is reproduced
 * verbatim, once, and in source order. This is deliberately stricter than the
 * tolerant reader alignment above: alignment remains resilient for historical
 * documents, while new translations cannot silently drift out of sync.
 */
export function auditTranslationAnchors(
  translation: string,
  expectedAnchors: readonly Pick<TranslationAnchor, "id">[] | readonly string[]
): TranslationAnchorAudit {
  const expectedIds = expectedAnchors.map((anchor) => (
    typeof anchor === "string" ? anchor : anchor.id
  ));
  const markers = findCanonicalMarkers(translation);
  const foundIds = markers.map(({ id }) => id);
  const counts = new Map<string, number>();
  foundIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  const duplicateIds = unique(foundIds.filter((id) => (counts.get(id) ?? 0) > 1));
  const missingIds = unique(expectedIds.filter((id) => !foundIds.includes(id)));
  const unexpectedIds = unique(foundIds.filter((id) => !expectedIds.includes(id)));
  const malformedMarkers = unique(findAnchorLikeComments(translation).filter((comment) => (
    !markers.some(({ marker: canonical }) => canonical === comment)
  )));
  const expectedOrder = expectedIds.filter((id) => foundIds.includes(id));
  const foundExpectedOrder = foundIds.filter((id) => expectedIds.includes(id));
  const outOfOrder = foundExpectedOrder.some((id, index) => id !== expectedOrder[index]);
  const hasUnanchoredPrefix = markers.length === 0
    ? translation.trim().length > 0
    : translation.slice(0, markers[0].index).trim().length > 0;
  const emptyIds = markers.flatMap((entry, index) => {
    const end = markers[index + 1]?.index ?? translation.length;
    return translation.slice(entry.index + entry.marker.length, end).trim() ? [] : [entry.id];
  });
  const valid = (
    expectedIds.length > 0 &&
    duplicateIds.length === 0 &&
    emptyIds.length === 0 &&
    !hasUnanchoredPrefix &&
    malformedMarkers.length === 0 &&
    missingIds.length === 0 &&
    !outOfOrder &&
    unexpectedIds.length === 0 &&
    foundIds.length === expectedIds.length
  );

  return {
    duplicateIds,
    emptyIds: unique(emptyIds),
    expectedIds: [...expectedIds],
    foundIds,
    hasUnanchoredPrefix,
    malformedMarkers,
    missingIds,
    outOfOrder,
    unexpectedIds,
    valid
  };
}

/**
 * Packs complete anchored segments into bounded model requests. Anchors are
 * never split across requests because that would make exact reconstruction
 * ambiguous.
 */
export function buildAnchoredTranslationBatches(
  markedSource: string,
  maximumCharacters = 24_000
): AnchoredTranslationBatch[] {
  if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters < 1) {
    throw new Error("翻译批次字符上限必须是正整数。");
  }
  const markers = findCanonicalMarkers(markedSource);
  if (markers.length === 0) {
    throw new Error("翻译原文缺少同步锚点。");
  }
  const expectedIds = markers.map(({ id }) => id);
  const sourceAudit = auditTranslationAnchors(markedSource, expectedIds);
  if (!sourceAudit.valid) {
    throw new Error("翻译原文的同步锚点格式无效，请重新载入论文提取内容。");
  }
  const segments = markers.map((entry, index) => ({
    anchorId: entry.id,
    value: markedSource.slice(entry.index, markers[index + 1]?.index ?? markedSource.length).trim()
  }));
  const oversized = segments.find(({ value }) => value.length > maximumCharacters);
  if (oversized) {
    throw new Error(`同步段落 ${oversized.anchorId} 超过单批字符上限，无法安全拆分。`);
  }

  const batches: AnchoredTranslationBatch[] = [];
  let anchorIds: string[] = [];
  let values: string[] = [];
  for (const segment of segments) {
    const nextValue = [...values, segment.value].join("\n\n");
    if (values.length > 0 && nextValue.length > maximumCharacters) {
      batches.push({ anchorIds, markedSource: values.join("\n\n") });
      anchorIds = [];
      values = [];
    }
    anchorIds.push(segment.anchorId);
    values.push(segment.value);
  }
  if (values.length > 0) {
    batches.push({ anchorIds, markedSource: values.join("\n\n") });
  }
  return batches;
}
