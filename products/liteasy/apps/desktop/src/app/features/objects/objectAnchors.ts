import type { ObjectAnchor, ObjectRef } from "./object.types";
export type AnchorResolution =
  | { status: "resolved"; start?: number; end?: number; page?: number }
  | { status: "unresolved" | "ambiguous" | "version_changed"; reason: string };
export function resolveObjectAnchor(
  anchor: ObjectAnchor,
  source: {
    ref: ObjectRef;
    text: string;
    blockId?: string;
    page?: number;
    documentHash?: string;
  },
): AnchorResolution {
  if (
    anchor.sourceRef.objectId !== source.ref.objectId ||
    anchor.sourceRef.revision !== source.ref.revision ||
    (anchor.type === "pdf" &&
      anchor.documentHash &&
      anchor.documentHash !== source.documentHash)
  )
    return {
      status: "version_changed",
      reason: "来源版本已变化，保留原摘录。",
    };
  if (anchor.type !== "pdf" && anchor.type !== "text")
    return { status: "unresolved", reason: "需要专业内容定位器。" };
  if (
    (anchor.type === "pdf" && source.page !== anchor.page) ||
    (anchor.type === "text" && source.blockId !== anchor.blockId)
  )
    return { status: "unresolved", reason: "来源位置不可用。" };
  if (anchor.type === "pdf" && anchor.precision === "page")
    return { status: "unresolved", reason: "旧摘录仅保存页码，无法精确高亮。" };
  const matches: number[] = [];
  let offset = 0;
  while (offset <= source.text.length) {
    const found = source.text.indexOf(anchor.quote.exact, offset);
    if (found < 0) break;
    if (
      (!anchor.quote.prefix ||
        source.text.slice(0, found).endsWith(anchor.quote.prefix)) &&
      (!anchor.quote.suffix ||
        source.text
          .slice(found + anchor.quote.exact.length)
          .startsWith(anchor.quote.suffix))
    )
      matches.push(found);
    offset = found + Math.max(1, anchor.quote.exact.length);
  }
  if (
    anchor.range &&
    anchor.range.end > anchor.range.start &&
    source.text.slice(anchor.range.start, anchor.range.end) ===
      anchor.quote.exact &&
    matches.includes(anchor.range.start)
  )
    return {
      status: "resolved",
      start: anchor.range.start,
      end: anchor.range.end,
      page: anchor.type === "pdf" ? anchor.page : undefined,
    };
  if (matches.length > 1)
    return { status: "ambiguous", reason: "原文出现多次，无法确定唯一位置。" };
  if (matches.length === 0)
    return { status: "unresolved", reason: "没有找到原文，摘录快照仍可阅读。" };
  return {
    status: "resolved",
    start: matches[0],
    end: matches[0] + anchor.quote.exact.length,
    page: anchor.type === "pdf" ? anchor.page : undefined,
  };
}
