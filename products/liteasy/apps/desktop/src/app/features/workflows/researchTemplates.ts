import { compileWorkflow } from "./workflowDefinition";

export const researchTemplates = [
  { id: "intuition-definition", title: "先直觉后定义", prompts: ["用自己的话写出直觉", "核对作者的定义与符号", "列出适用边界和反例"] },
  { id: "evidence-audit", title: "证据审计", prompts: ["记录待核查的作者陈述", "核对直接证据与推理之间的距离", "记录证据不足或相互分歧之处"] },
  { id: "method-compare", title: "方法、假设与指标比较", prompts: ["方法", "假设", "指标与测量条件", "局限与分歧"] },
  { id: "derivation-check", title: "理论推导核对", prompts: ["记录前提、定义与符号", "逐步核查等式或逻辑变换", "检查边界条件与反例"] },
  { id: "book-excerpt", title: "跨版本书籍摘录", prompts: ["记录版本与章节位置", "并列摘录有差异的原文", "记录语境、译法与解释上的分歧"] }
] as const;

export type ResearchTemplateId = typeof researchTemplates[number]["id"];

/** Offline worksheets use the existing bounded read/create and pure comparison runtime. */
export function researchTemplateWorkflow(id: ResearchTemplateId) {
  const template = researchTemplates.find((item) => item.id === id)!;
  const literal = (value: unknown) => ({ source: "literal", value });
  const node = (nodeId: string, path = "") => ({ source: "node", nodeId, path });
  return compileWorkflow({ schema: "liteasy.workflow/v2", id, version: "1.0.0", title: template.title,
    inputSchema: { type: "object", properties: {
      selection: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8, default: [] },
      question: { type: "string", title: "阅读问题", maxLength: 2000, default: "" },
      userComment: { type: "string", title: "我的初步评论", maxLength: 4000, default: "" }
    }, required: ["selection", "question", "userComment"], additionalProperties: false },
    outputSchema: { type: "object", properties: { path: { type: "string" }, title: { type: "string" }, kind: { type: "string" }, revision: { type: "string" }, capabilities: { type: "array", items: { type: "string" } }, relatedPaperIds: { type: "array", items: { type: "string" } },
      sourceResolution: { type: "string", enum: ["unavailable"] },
      sourceReferences: { type: "array", items: { type: "object", properties: {
        scopeType: { type: "string", enum: ["user", "organization"] }, scopeId: { type: "string" }, paperId: { type: "string" }, documentId: { type: "string" }, revision: { type: "number" }
      }, required: ["scopeType", "scopeId", "paperId"], additionalProperties: false } }
    }, required: ["path", "title"], additionalProperties: false },
    nodes: [
      { id: "evidence", title: "读取选中来源", operation: { id: "resources.read", version: "1.0.0" }, input: { maxCharacters: literal(4000) }, map: { items: { source: "input", path: "selection" }, itemField: "path", maxItems: 8 } },
      { id: "template", title: "选择阅读方式", operation: { id: "core.value", version: "1.0.0" }, input: { value: literal({ schema: "liteasy.research-template/v1", template: id }) } },
      { id: "question", title: "记录阅读问题", operation: { id: "core.value", version: "1.0.0" }, input: { value: { source: "input", path: "question" } } },
      { id: "userComment", title: "记录用户评论", operation: { id: "core.value", version: "1.0.0" }, input: { value: { source: "input", path: "userComment" } } },
      { id: "request", title: "整理阅读要求", operation: { id: "core.join", version: "1.0.0" }, input: {} },
      { id: "worksheet", title: "整理来源与待核查项", operation: { id: "core.comparison", version: "1.0.0" }, input: {
        value: node("request"), evidence: node("evidence"), cardType: literal({ id: "plugin.paper-lens/reasoning-card", version: "1.0.0" })
      } },
      { id: "save", title: "保存新的阅读笔记", operation: { id: "resources.create", version: "1.0.0" }, input: { kind: literal("note"), title: literal(template.title), text: node("worksheet", "text") } },
      { id: "open", title: "打开阅读笔记", operation: { id: "ui.open", version: "1.0.0" }, input: { path: node("save", "path") } }
    ], output: node("save"), edges: [{ from: "template", to: "request" }, { from: "question", to: "request" }, { from: "userComment", to: "request" }], budget: { maxMilliseconds: 120000, maxOperations: 16, maxModelCalls: 0, maxTokens: 0, concurrency: 1 }, layout: {}
  }).definition;
}
