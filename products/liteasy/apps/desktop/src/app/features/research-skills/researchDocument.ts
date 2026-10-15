import { researchSkillDisplayTitle } from "./researchSkillDisplay";
import { z } from "zod";
import { contextRefSchema } from "../context/objectContext";
import { assistantOriginSchema } from "../assistant/assistantSessionContracts";

const text = (max: number) => z.string().trim().min(1).max(max);
const sourceId = z.string().regex(/^S[1-9][0-9]*$/);
export const researchDocumentKinds = ["paper_brief", "concept_note", "comparison", "literature_packet", "hypothesis_cards", "risk_vector", "evaluation_plan", "falsification", "claim_audit", "manuscript_draft"] as const;
export const researchSkillRefSchema = z.strictObject({ id: text(120), version: z.string().regex(/^\d+\.\d+\.\d+$/), packageDigest: z.string().regex(/^[a-f0-9]{64}$/) });
export type ResearchSkillRef = z.infer<typeof researchSkillRefSchema>;
export const researchDestinationSchema = z.strictObject({ kind: z.literal("entry-child"), canonicalEntryId: text(512), paperId: text(512), scopeId: text(512), title: text(1000), expectedOwnerRevision: z.string().optional() });
export type ResearchDestination = z.infer<typeof researchDestinationSchema>;
export const researchSelectionSchema = z.strictObject({ skill: researchSkillRefSchema, destination: researchDestinationSchema.optional(), preset: z.strictObject({ id: z.string().max(100).optional(), parameters: z.record(z.string().max(100), z.union([z.string().max(2000), z.number(), z.boolean()])) }), roles: z.record(z.string().max(2000), z.string().max(100)) });
export type ResearchSkillSelection = z.infer<typeof researchSelectionSchema>;
export const researchSkillInvocationSchema = z.strictObject({
  schema: z.literal("liteasy.skill-invocation/v1"), requestId: text(120), scopeId: text(300), sessionGeneration: text(200),
  skill: researchSkillRefSchema, prompt: z.string().max(12000), preset: researchSelectionSchema.shape.preset,
  inputs: z.array(z.strictObject({ role: text(100), refs: z.array(contextRefSchema).min(1).max(100) })).max(16),
  destination: researchDestinationSchema, origin: assistantOriginSchema, modelBindingId: text(200), contextSnapshotId: text(200),
  budget: z.strictObject({ inputTokens: z.number().int().min(1).max(200000), outputTokens: z.number().int().min(1).max(32000), repairAttempts: z.union([z.literal(0), z.literal(1)]) })
});
export type ResearchSkillInvocation = z.infer<typeof researchSkillInvocationSchema>;
export const researchDraftSchema = z.strictObject({
  schema: z.literal("liteasy.research-draft/v1"), title: text(160), documentKind: z.enum(researchDocumentKinds),
  sections: z.array(z.strictObject({ id: z.string().regex(/^[a-z_]+$/), markdown: text(30000), sourceIds: z.array(sourceId).max(100) })).min(1).max(32),
  claims: z.array(z.strictObject({ id: z.string().regex(/^C[1-9][0-9]*$/), sectionId: z.string().regex(/^[a-z_]+$/), text: text(2000),
    kind: z.enum(["source_assertion", "inference", "hypothesis", "general_explanation"]),
    citations: z.array(z.strictObject({ sourceId, quote: text(2000).nullable().optional() })).max(30), conditions: z.array(z.string().max(2000)).max(30) })).max(200),
  limitations: z.array(text(2000)).max(50), nextActions: z.array(text(2000)).max(12)
});
export type ResearchDraft = z.infer<typeof researchDraftSchema>;
export const researchSourceSchema = z.strictObject({ id: sourceId, ref: contextRefSchema, role: text(100), title: text(1000), text: z.string().max(800000), sha256: z.string().regex(/^[a-f0-9]{64}$/), trustLabel: z.enum(["source", "derived", "description"]), coverage: z.enum(["full", "partial", "omitted"]) });
export const researchDocumentSchema = z.strictObject({
  schema: z.literal("liteasy.research-document/v1"), draft: researchDraftSchema, invocation: researchSkillInvocationSchema,
  sources: z.array(researchSourceSchema).max(100), templateDigest: z.string().regex(/^[a-f0-9]{64}$/), presetDigest: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.strictObject({ bindingId: text(200), provider: text(120), model: text(200), requests: z.number().int().min(1).max(2) }),
  validation: z.strictObject({ structure: z.literal("valid"), citations: z.literal("locatable"), semanticStatus: z.literal("unverified") })
}).superRefine((document, context) => {
  const invalid = (message: string) => context.addIssue({ code: "custom", message });
  if (document.invocation.scopeId !== document.invocation.destination.scopeId || document.model.bindingId !== document.invocation.modelBindingId) invalid("文档归属或模型绑定不一致");
  const sources = new Map(document.sources.map(source => [source.id, source]));
  const sections = new Set(document.draft.sections.map(section => section.id));
  if (sources.size !== document.sources.length || sections.size !== document.draft.sections.length || new Set(document.draft.claims.map(claim => claim.id)).size !== document.draft.claims.length) invalid("文档编号重复");
  for (const source of document.sources) if (!document.invocation.inputs.some(input => input.role === source.role && input.refs.some(ref => JSON.stringify(ref) === JSON.stringify(source.ref)))) invalid("文档来源不属于任务输入");
  for (const section of document.draft.sections) if (section.sourceIds.some(id => !sources.has(id))) invalid("文档来源编号不存在");
  for (const claim of document.draft.claims) {
    if (!sections.has(claim.sectionId)) invalid("主张章节不存在");
    if (claim.kind === "source_assertion" && !claim.citations.length) invalid("来源主张缺少依据");
    for (const citation of claim.citations) {
      const source = sources.get(citation.sourceId);
      if (!source || citation.quote && !source.text.includes(citation.quote) || claim.kind === "source_assertion" && source.trustLabel !== "source") invalid("文档引文无法定位");
    }
  }
});
export type ResearchDocument = z.infer<typeof researchDocumentSchema>;
const sectionNames: Record<string, string> = { scope: "读取范围", problem: "研究问题", method: "方法", claims_evidence: "主张与依据", limitations: "局限", next_step: "下一步",
  alternatives: "其他方向", analysis: "分析", baselines: "对照基线", chosen_vector: "选择的研究方向", claim_table: "主张核对表", consensus: "共识", contradictions: "矛盾", counterexamples: "反例", criteria: "比较标准", decision_rule: "判断规则", definition: "定义", disagreements: "分歧", draft: "草稿", evidence_gaps: "证据缺口", example: "示例", failure_cases: "失败情况", falsifiers: "可证伪条件", gaps: "研究缺口", hypotheses: "假设", implications: "启示", incomparability: "不可直接比较之处", intuition: "直观理解", limits: "适用边界", map: "文献关系", matrix: "对比矩阵", minimal_test: "最小验证", outline: "提纲", prior_work: "相关工作", protocol: "评估步骤", revisions: "修改建议", risks: "风险", self_check: "自查", source_alignment: "来源对应", stopping: "停止条件", unresolved: "待解决问题", variables: "变量"
};
const claimNames = { source_assertion: "来源主张", inference: "推断", hypothesis: "假设", general_explanation: "一般说明" };
/** All display/export/object representations derive from the same validated body. */
export function researchDocumentMarkdown(document: ResearchDocument) {
  const { draft } = document;
  return [`# ${draft.title}`, ...draft.sections.map(section => `## ${sectionNames[section.id] ?? section.id}\n\n${section.markdown}\n\n${section.sourceIds.map(id => `[${id}]`).join(" ")}`),
    draft.claims.length ? "## 主张与依据\n\n" + draft.claims.map(claim => `- ${claim.text}（${claimNames[claim.kind]}）${claim.citations.map(c => `[${c.sourceId}]${c.quote ? `「${c.quote}」` : ""}`).join(" ")}${claim.conditions.length ? `\n  条件：${claim.conditions.join("；")}` : ""}`).join("\n") : "",
    draft.limitations.length ? `## 待核对与局限\n\n${draft.limitations.map(item => `- ${item}`).join("\n")}` : "",
    draft.nextActions.length ? `## 后续行动\n\n${draft.nextActions.map(item => `- ${item}`).join("\n")}` : "",
    `## 来源与方法\n\n${document.sources.map(source => `- [${source.id}] ${source.title} · ${source.trustLabel === "derived" ? "派生资料" : "来源材料"} · ${source.coverage === "full" ? "所选内容完整载入" : "部分内容"}`).join("\n")}\n\n方法：${researchSkillDisplayTitle(document.invocation.skill)} ${document.invocation.skill.version}。结构与引用定位已检查，科研结论未经独立验证。`
  ].filter(Boolean).join("\n\n");
}
