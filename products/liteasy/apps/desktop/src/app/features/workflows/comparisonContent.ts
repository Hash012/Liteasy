import { z } from "zod";
import { researchTemplateContent } from "./researchTemplateContent";
const section = z.strictObject({ title: z.string().min(1).max(120), text: z.string().min(1).max(12000), sources: z.array(z.string().max(8192)).max(8) });
export const comparisonSchema = z.strictObject({ sections: z.array(section).length(4) });
/** Citations are checked against actual read results, never against model-invented IDs. */
export function comparisonContent(value: unknown, evidence: unknown[], cardType: { id: string; version: string }) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const fields = value as Record<string, unknown>;
    const request = fields.template && typeof fields.template === "object" && !Array.isArray(fields.template)
      ? { ...fields.template as Record<string, unknown>, question: fields.question, userComment: fields.userComment } : fields;
    if (request.schema === "liteasy.research-template/v1") return researchTemplateContent(request, evidence, cardType);
  }
  const analysis = comparisonSchema.parse(value);
  const sources = evidence.map((entry) => z.object({ asset: z.object({ path: z.string(), title: z.string() }), text: z.string(), truncated: z.boolean().optional() }).parse(entry));
  const allowed = new Map(sources.map((source) => [source.asset.path, source]));
  const safeTitle = (title: string) => title.replace(/[\[\]\\\n\r]/g, " ");
  const sections = analysis.sections.map((section) => {
    for (const path of section.sources) { const source = allowed.get(path); if (!source || !source.text.trim()) throw new Error(`未读取到可核验来源：${path}`); }
    if (sources.some((source) => source.text.trim()) && !section.sources.length) throw new Error(`“${section.title}”需要至少一条实际读取的来源；资料不足时应明确说明。`);
    for (const match of section.text.matchAll(/liteasy:\/\/[^\s)<>]+/g)) if (!allowed.has(match[0])) throw new Error("分析包含未读取的引用，未保存结果。");
    return { title: section.title, text: section.text, references: section.sources.map((path) => `[${safeTitle(allowed.get(path)!.asset.title)}](${path})`).join(" · ") };
  });
  const missing = sources.filter((source) => !source.text.trim()).map((source) => source.asset.title);
  const coverage = `仅根据本轮已读取片段进行比较，未声明阅读完整论文。${missing.length ? `缺少正文：${missing.join("、")}。` : ""}`;
  return { text: [coverage, ...sections.map((section) => `## ${section.title}\n\n${section.text}\n\n${section.references}`)].join("\n\n"), cards: sections.map((section) => ({ title: section.title, type: cardType, data: { text: section.text, evidence: `${section.references}\n\n${coverage}` } })) };
}
