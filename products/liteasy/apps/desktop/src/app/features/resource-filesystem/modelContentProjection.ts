import type { AgentAssetRead } from "./agentAsset.types";
import { contentBlocks } from "../markdown/contentStructure";
/** Model delivery is an explicit projection; display-only expansion is never implied read coverage. */
export function modelContentProjection(read: AgentAssetRead, maxCharacters: number) {
  const { content, ...metadata } = read;
  if (!content) return { ...metadata, contentFormat: "legacy-unknown", deliveryRanges: [{ start: read.offset, end: read.offset + read.text.length, unit: "utf16" as const }] };
  if (content.integrity !== "budget-exceeded" && content.integrity !== "incomplete-snapshot") {
    if (content.viewContext.text.length <= maxCharacters) {
      return { ...metadata, text: content.viewContext.text, contentFormat: content.profile,
        deliveryRanges: content.viewContext.ranges, requestedRange: content.exactSelection.ranges,
        notice: content.viewContext.materialBeyondSelection ? "本次模型输入明确包含完整父块/定义；原始选区另行记录。" : undefined };
    }
    // Keep complete blocks plus definitions within the actual request budget. Never send half a table/fence.
    const blocks = contentBlocks(content.viewContext.text);
    const definitions = blocks.filter(block => ["definition", "footnoteDefinition"].includes(block.type));
    let cost = definitions.reduce((total, block) => total + block.end - block.start + 2, 0);
    const chosen = blocks.filter(block => {
      if (definitions.includes(block)) return false;
      const size = block.end - block.start + 2;
      if (cost + size > maxCharacters) return false;
      cost += size;
      return true;
    });
    if (chosen.length && content.viewContext.segments) {
      const selected = [...chosen, ...definitions].sort((a, b) => a.start - b.start);
      const deliveryRanges = selected.flatMap(block => content.viewContext.segments!.flatMap(segment => {
        const start = Math.max(block.start, segment.outputStart), end = Math.min(block.end, segment.outputEnd);
        return end > start ? [{ start: segment.sourceRange.start + start - segment.outputStart,
          end: segment.sourceRange.start + end - segment.outputStart, unit: "utf16" as const }] : [];
      }));
      return { ...metadata, text: selected.map(block => content.viewContext.text.slice(block.start, block.end)).join("\n\n"),
        contentFormat: content.profile, deliveryRanges, requestedRange: content.exactSelection.ranges,
        notice: "本次预算仅容纳部分完整结构及其定义；实际送入模型的范围已单独记录，不能视为读完来源。" };
    }
  }
  if (content.profile === "literal/v1") return { ...metadata, contentFormat: "literal/v1", deliveryRanges: content.exactSelection.ranges };
  return { ...metadata, text: "", contentFormat: "metadata-only", deliveryRanges: [],
    notice: "完整结构超过本次预算或来源结构不完整；本次未提供正文，请缩小结构选区或请用户查看原文。" };
}
