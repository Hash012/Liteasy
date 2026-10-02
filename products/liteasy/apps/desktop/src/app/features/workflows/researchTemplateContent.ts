import { z } from "zod";
import { describeResourceIdentity } from "../resource-filesystem/resourceIdentity";
import { liteasyPath, parseLiteasyPath } from "../resource-filesystem/liteasyPath";
import { researchTemplates } from "./researchTemplates";

export const researchTemplateRequestSchema = z.object({
  schema: z.literal("liteasy.research-template/v1"), template: z.enum(researchTemplates.map((item) => item.id)),
  question: z.string().max(2000).default(""), userComment: z.string().max(4000).default("")
});
const readSchema = z.object({
  asset: z.object({ path: z.string().max(8192), title: z.string().max(1000), kind: z.string(), revision: z.string().optional() }),
  text: z.string().max(80000), offset: z.number().nonnegative().default(0), truncated: z.boolean().default(false),
  evidence: z.object({ kind: z.enum(["source", "user", "derived", "metadata"]), coverage: z.enum(["partial", "unknown"]), reason: z.string().optional() }).optional()
});
const inline = (value: string) => value.replace(/[\r\n]/g, " ").replace(/([\\`*_[\]<>|])/g, "\\$1");
const quote = (value: string) => value.split(/\r?\n/).map((line) => `> ${line}`).join("\n");

/** No model interpretation or inferred page numbers: build a worksheet from recorded reads. */
export function researchTemplateContent(value: unknown, evidence: unknown[], cardType: { id: string; version: string }) {
  const request = researchTemplateRequestSchema.parse(value);
  const template = researchTemplates.find((item) => item.id === request.template)!;
  const sources = z.array(readSchema).min(1).max(8).parse(evidence).map((read, index) => {
    const scope = new URL(read.asset.path).searchParams.get("scope");
    if (!scope) throw new Error("来源未记录账号范围。");
    const target = parseLiteasyPath(read.asset.path, scope);
    if (target.kind === "object" && !target.followLatest && read.asset.revision && target.ref.revision !== read.asset.revision) throw new Error("来源版本与读取回执不一致。");
    const pinned = target.kind === "object" && read.asset.revision
      ? { ...target, ref: { ...target.ref, revision: read.asset.revision }, followLatest: false } : target;
    const identity = describeResourceIdentity(scope, pinned, { revision: read.asset.revision });
    const kind = read.evidence?.kind ?? (read.asset.kind === "content.note" ? "user" : "metadata");
    const available = kind !== "metadata" && !!read.text.trim();
    const page = kind === "source" && pinned.kind === "object" && /^page:[1-9]\d*$/.test(pinned.ref.selectorId ?? "")
      ? Number(pinned.ref.selectorId!.slice(5)) : undefined;
    const location = page ? `PDF 物理页：${page}；原文页标签未记录。` : "页码/章节未记录；未推断精确位置。";
    const quality = !available ? "仅元信息 / 证据不足" : read.truncated || read.offset > 0 || read.evidence?.coverage === "partial"
      ? "片段覆盖，未核实全文" : "覆盖范围未知，未核实全文";
    const provenance = kind === "source" ? "来源原文；作者陈述仍需核查" : kind === "user" ? "用户笔记；不等同作者陈述" : kind === "derived" ? "既有推断/派生产物；不等同作者陈述" : "仅元信息";
    return { read, id: `S${index + 1}`, identity, available, location, quality, provenance,
      link: `[${inline(read.asset.title)}](${liteasyPath(scope, pinned)})`, pinned: pinned.kind === "object" && !pinned.followLatest };
  });
  const prompts = template.prompts.map((prompt) => `### ${prompt}\n\n| 来源 | 待核查记录 | 状态 |\n| --- | --- | --- |\n${sources.map((source) => `| ${source.id} · ${source.link} | ${source.available ? "未填写；请核对摘录后记录" : "证据不足；不得补全"} | 待核查 |`).join("\n")}`).join("\n\n");
  const appendix = sources.map((source) => [
    `### ${source.id} · ${inline(source.read.asset.title)}`,
    `- 回到来源：${source.link}${source.pinned ? "（固定版本）" : "（当前资源入口，不保证仍是此版本）"}`,
    `- 内容修订：${inline(source.identity.revision ?? "未记录；无法固定版本")}`,
    `- 来源类型：${source.provenance}`,
    `- 位置：${source.location}`,
    `- 来源质量：${source.quality}`,
    source.read.evidence?.reason ? `- 可用性说明：${inline(source.read.evidence.reason)}` : "",
    `- 原始入口：\`${source.read.asset.path}\``,
    source.available ? `\n本轮读取摘录（字符偏移 ${source.read.offset}；未替换为模型解释）：\n\n${quote(source.read.text)}` : "\n未记录可用正文摘录。"
  ].filter(Boolean).join("\n")).join("\n\n");
  const text = [
    `# ${template.title}`, "仅整理本轮实际读取的资料。以下空项需要人工核查；阅读进度不代表掌握程度。",
    `## 阅读问题\n\n${request.question ? quote(request.question) : "未填写。"}`,
    `## 作者陈述与来源核查\n\n${prompts}`,
    "## 模型推断\n\n模型推断：未生成。请将后续推断与来源原文分开记录，并注明依据。",
    `## 用户评论\n\n${request.userComment ? quote(request.userComment) : "未填写。"}`,
    "## 核查状态\n\n- [ ] 待核查\n- [ ] 证据不足\n- [ ] 存在分歧（记录双方依据，不自动裁定）\n- [ ] 已人工核查（说明范围与剩余问题）",
    `## 来源说明与摘录（离线可读）\n\n原文页标签、PDF 物理页、电子书章节位置分别记录；未提供的信息保持未知。\n\n${appendix}`
  ].join("\n\n");
  return { text, cards: [{ title: template.title, type: cardType, data: { text, evidence: "此笔记保留本轮来源修订与摘录；核查状态由用户填写。" } }] };
}
