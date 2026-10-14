import { z } from "zod";
import catalog from "../../../../../../packages/research-skills/catalog.json";
import { hashText } from "../context/objectContext";
import { loadWorkflowSkill, parseWorkflowSkillPackage, registerWorkflowSkill } from "../skills/workflowSkillRegistry";
import { researchDocumentKinds, type ResearchSkillRef } from "./researchDocument";

export const researchSkillAdapterSchema = z.strictObject({
  schema: z.literal("liteasy.skill-adapter/v1"), id: z.string().regex(/^research-[a-z-]+$/), version: z.literal("0.1.0"), availability: z.literal("adapter_required"),
  display: z.strictObject({ title: z.string().min(1).max(160), description: z.string().min(1).max(1000), group: z.enum(["读懂", "对照", "提出与验证", "写作"]), aliases: z.array(z.string().max(160)).max(30) }),
  instructions: z.literal("SKILL.md"), contract: z.literal("references/research-contract.md"), template: z.literal("assets/output-template.md"), workflow: z.literal("workflow.json"),
  execution: z.strictObject({ mode: z.literal("document"), operatorId: z.literal("liteasy.research.generate-document"), operatorVersion: z.literal("1.0.0"), maxGenerations: z.literal(1), maxRepairAttempts: z.literal(1), tools: z.tuple([]), permissions: z.tuple([z.literal("model.invoke"), z.literal("context.read"), z.literal("artifact.write")]) }),
  inputs: z.strictObject({ roles: z.array(z.strictObject({ id: z.string().regex(/^[a-z_]+$/), label: z.string().max(100), minRefs: z.number().int().min(0).max(100), maxRefs: z.number().int().min(1).max(100) })).min(1).max(16), minimumDistinctPrimaryObjects: z.number().int().min(0).max(2), requireProblemInPromptOrContext: z.boolean() }),
  output: z.strictObject({ artifactType: z.literal("research_document"), documentKind: z.enum(researchDocumentKinds), requiredSections: z.array(z.string().regex(/^[a-z_]+$/)).min(1).max(32) }),
  defaults: z.strictObject({ instruction: z.string().min(1).max(8000), language: z.literal("auto"), presetId: z.literal("default") })
});
export type ResearchSkillAdapter = z.infer<typeof researchSkillAdapterSchema>;
const adapters = import.meta.glob("../../../../../../packages/research-skills/skills/*/liteasy.json", { eager: true, import: "default" });
const files = import.meta.glob<string>("../../../../../../packages/research-skills/skills/**/*", { query: "?raw", import: "default" });
export type ResearchSkillSummary = { id: string; title: string; description: string; group: string; aliases: string[]; ref?: ResearchSkillRef; adapter?: ResearchSkillAdapter; unavailableReason?: string };
export function listResearchSkills(): ResearchSkillSummary[] {
  return catalog.entries.map(entry => {
    if (!entry.packagePath || !entry.version || !entry.packageDigest) return { id: entry.id, title: entry.title, description: entry.notes, group: "后续能力", aliases: [], unavailableReason: "尚未接通所需能力" };
    try {
      const adapter = researchSkillAdapterSchema.parse(adapters[`../../../../../../packages/research-skills/${entry.packagePath}/liteasy.json`]);
      if (adapter.id !== entry.id || adapter.version !== entry.version) throw new Error("方法包身份不匹配");
      return { id: entry.id, ...adapter.display, ref: { id: entry.id, version: entry.version, packageDigest: entry.packageDigest }, adapter };
    } catch { return { id: entry.id, title: entry.title, description: entry.notes, group: "不可用", aliases: [], unavailableReason: "方法包格式无效" }; }
  });
}
export type LoadedResearchSkill = { ref: ResearchSkillRef; adapter: ResearchSkillAdapter; instructions: string; contract: string; template: string; templateDigest: string };
export async function validateResearchSkillFiles(ref: ResearchSkillRef, content: Record<string, string>): Promise<LoadedResearchSkill> {
  const paths = Object.keys(content).sort();
  if (paths.length !== 5 || paths.some(path => !["SKILL.md", "liteasy.json", "workflow.json", "references/research-contract.md", "assets/output-template.md"].includes(path))) throw new Error("方法包包含未授权文件");
  if (paths.some(path => new TextEncoder().encode(content[path]).length > 128000)) throw new Error("方法包文件过大");
  const digest = await hashText((await Promise.all(paths.map(async path => `${path}\0${await hashText(content[path])}\n`))).join(""));
  if (digest !== ref.packageDigest) throw new Error("所选方法版本内容已变化，请重新确认版本");
  const adapter = researchSkillAdapterSchema.parse(JSON.parse(content["liteasy.json"]));
  if (adapter.id !== ref.id || adapter.version !== ref.version) throw new Error("方法包版本不匹配");
  const workflow = parseWorkflowSkillPackage({ manifest: JSON.parse(content[adapter.workflow]), instructions: content[adapter.instructions] });
  if (workflow.manifest.id !== ref.id || workflow.manifest.version !== ref.version || workflow.manifest.steps.length !== 1 || workflow.manifest.steps[0].operator.id !== adapter.execution.operatorId || JSON.stringify(workflow.manifest.permissions) !== JSON.stringify(adapter.execution.permissions)) throw new Error("方法包工作流绑定无效");
  let existing;
  try { existing = loadWorkflowSkill(ref.id, ref.version); } catch { /* Register only the validated bundled version. */ }
  if (existing && JSON.stringify(existing) !== JSON.stringify(workflow)) throw new Error("此方法版本已绑定不同工作流");
  if (!existing) registerWorkflowSkill(workflow);
  return { ref, adapter, instructions: content[adapter.instructions], contract: content[adapter.contract], template: content[adapter.template], templateDigest: await hashText(content[adapter.template]) };
}
export async function loadResearchSkill(ref: ResearchSkillRef) {
  const entry = catalog.entries.find(entry => entry.id === ref.id && entry.version === ref.version && entry.packageDigest === ref.packageDigest);
  if (!entry?.packagePath) throw new Error("旧方法版本不可用，请重新选择并确认，未自动换用最新版");
  const prefix = `../../../../../../packages/research-skills/${entry.packagePath}/`;
  const content = Object.fromEntries(await Promise.all(Object.entries(files).filter(([path]) => path.startsWith(prefix)).map(async ([path, read]) => [path.slice(prefix.length), await read()])));
  return validateResearchSkillFiles(ref, content);
}
