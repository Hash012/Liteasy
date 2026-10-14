import { vi } from "vitest";
import { listResearchSkills, loadResearchSkill, validateResearchSkillFiles } from "../app/features/research-skills/researchSkillCatalog";
import { generateResearchDocument, validateResearchDraft } from "../app/features/research-skills/researchDocumentGeneration";
import { researchDocumentMarkdown, type ResearchSkillInvocation } from "../app/features/research-skills/researchDocument";
import { commitResearchDocument, researchArtifact } from "../app/features/research-skills/researchDocumentCommit";
import { isResearchSkillPosition, parseResearchSkillCommand } from "../app/features/research-skills/researchSkillCommand";
import { hashText, type ContextSnapshot } from "../app/features/context/objectContext";
import { executeWorkflowSkill } from "../app/features/skills/workflowSkillRegistry";
const methods = listResearchSkills().filter(method => method.ref);
async function fixture(id = "research-read") {
  const skill = await loadResearchSkill(methods.find(method => method.id === id)!.ref!);
  const refs = Array.from({ length: Math.max(1, skill.adapter.inputs.minimumDistinctPrimaryObjects) }, (_, index) => ({ objectId: `paper-${index}`, revision: "1" }));
  const snapshot: ContextSnapshot = { snapshotId: "snapshot", scopeId: "scope", purpose: id, createdAt: new Date().toISOString(), tokens: 20,
    entries: await Promise.all(refs.map(async ref => ({ ref, title: ref.objectId, text: "Synthetic evidence: the reported sample has 12 observations.", sha256: await hashText("Synthetic evidence: the reported sample has 12 observations."), tokens: 20, origin: "explicit", trustLabel: "source", extractor: "liteasy.text/v1" }))) };
  const invocation: ResearchSkillInvocation = { schema: "liteasy.skill-invocation/v1", requestId: "run-one", scopeId: "scope", sessionGeneration: "generation", skill: skill.ref, prompt: "研究这个问题", preset: { parameters: {} }, inputs: [{ role: skill.adapter.inputs.roles[0].id, refs }], destination: { kind: "entry-child", canonicalEntryId: "owner-B", paperId: "paper-B", scopeId: "scope", title: "Paper B" }, origin: { kind: "conversation_action", entryPoint: "test", initiatedBy: { type: "user", id: "user" } }, modelBindingId: "binding", contextSnapshotId: "snapshot", budget: { inputTokens: 32000, outputTokens: 4000, repairAttempts: 1 } };
  const draft = { schema: "liteasy.research-draft/v1", title: "Synthetic research document", documentKind: skill.adapter.output.documentKind, sections: skill.adapter.output.requiredSections.map(id => ({ id, markdown: "Synthetic section [S1]", sourceIds: ["S1"] })), claims: [{ id: "C1", sectionId: skill.adapter.output.requiredSections[0], text: "The sample has 12 observations.", kind: "source_assertion", citations: [{ sourceId: "S1", quote: "12 observations" }], conditions: [] }], limitations: ["Synthetic fixture only"], nextActions: ["Human review"] };
  const generate = vi.fn().mockResolvedValue({ answer: JSON.stringify(draft), terminal: "completed", trace: { mode: "live" } });
  return { skill, snapshot, invocation, draft, generate, provider: "test", model: "test-model", signal: new AbortController().signal };
}

test("catalog has ten executable adapters and fourteen unavailable future capabilities", () => {
  expect(methods).toHaveLength(10); expect(listResearchSkills()).toHaveLength(24);
});
for (const method of methods) {
  test(`${method.id}: produces a schema validated document and canonical Markdown`, async () => {
    const input = await fixture(method.id);
    const document = await generateResearchDocument(input);
    expect(document.validation.semanticStatus).toBe("unverified");
    expect(document.invocation.destination.paperId).toBe("paper-B");
    expect(researchDocumentMarkdown(document)).toContain("[S1]");
    expect(input.generate).toHaveBeenCalledTimes(1);
    expect(input.generate.mock.calls[0][0].prompt).toContain("Synthetic evidence");
  });
  test(`${method.id}: repairs one invalid answer on the same model`, async () => {
    const input = await fixture(method.id);
    input.generate.mockResolvedValueOnce({ answer: JSON.stringify({ ...input.draft, destination: "attacker" }) });
    const document = await generateResearchDocument(input);
    expect(document.model.requests).toBe(2);
    expect(input.generate.mock.calls.every(([request]) => request.model === "test-model")).toBe(true);
  });
  test(`${method.id}: rejects fabricated citations after bounded repair`, async () => {
    const input = await fixture(method.id);
    input.draft.claims[0].citations[0].quote = "fabricated quote";
    input.generate.mockResolvedValue({ answer: JSON.stringify(input.draft) });
    await expect(generateResearchDocument(input)).rejects.toThrow("未保存");
    expect(input.generate).toHaveBeenCalledTimes(2);
  });
}

test.each(["$x$", "$$math$$", "\\$research-read", "`$research-read`", "```\n$research-read\n```", "$research-read$", "$5", "正文 $research-read"]) ("does not execute prose/code/math %s", input => {
  expect(parseResearchSkillCommand(input)).toBeUndefined();
});
test("recognizes only a registered explicit command", () => {
  expect(parseResearchSkillCommand("$research-read explain")?.prompt).toBe("explain");
  expect(() => parseResearchSkillCommand("$research-unknown")).toThrow("不可用");
});
test("rejects stale versions and package tampering", async () => {
  const ref = methods[0].ref!;
  await expect(loadResearchSkill({ ...ref, version: "0.0.0" })).rejects.toThrow("旧方法版本");
  await expect(validateResearchSkillFiles(ref, { "../script.sh": "bad" })).rejects.toThrow("未授权");
});
test("uses existing workflow runtime and bound skill identity", async () => {
  const input = await fixture();
  const runResearchDocument = vi.fn().mockResolvedValue({ artifactId: "artifact", resourceUri: "liteasy-local://artifact", message: "已保存" });
  await executeWorkflowSkill({ skillId: input.skill.ref.id, version: input.skill.ref.version, input: { requestId: "run-one" } }, { runResearchDocument });
  expect(runResearchDocument).toHaveBeenCalledWith({ requestId: "run-one", skillId: "research-read", skillVersion: "0.1.0" });
});
test("budget overflow sends no model requests", async () => {
  const input = await fixture(); input.invocation.budget.inputTokens = 10;
  await expect(generateResearchDocument(input)).rejects.toThrow("超出预算"); expect(input.generate).not.toHaveBeenCalled();
});
test("derived sources cannot become source assertions", async () => {
  const input = await fixture(); const document = await generateResearchDocument(input);
  document.sources[0].trustLabel = "derived";
  expect(() => validateResearchDraft(input.draft, input.skill, document.sources)).toThrow("原文依据");
});
test("commit reconciles lost responses and retries projections without another model request", async () => {
  const input = await fixture(); const body = researchArtifact(await generateResearchDocument(input), "research-one", "2026-10-14T00:00:00.000Z");
  let saved: typeof body | undefined;
  const client = { list: vi.fn(async () => saved ? [saved] : []), save: vi.fn(async document => { saved = structuredClone(document); throw new Error("lost response"); }), delete: vi.fn(), rename: vi.fn() };
  const project = vi.fn().mockRejectedValueOnce(new Error("projection unavailable")).mockResolvedValue(undefined);
  const assertOwner = vi.fn().mockResolvedValue(undefined);
  const request = { document: body, client, project, assertOwner, assertSession: () => {} };
  expect((await commitResearchDocument(request)).projectionPending).toBe(true);
  expect((await commitResearchDocument(request)).projectionPending).toBe(false);
  expect(client.save).toHaveBeenCalledTimes(1); expect(input.generate).toHaveBeenCalledTimes(1); expect(assertOwner).toHaveBeenCalledTimes(1);
  await expect(commitResearchDocument({ ...request, document: { ...body, createdAt: "2026-10-15T00:00:00.000Z" } })).rejects.toThrow("不能覆盖");
});
test("deleted owners and stale sessions cannot commit", async () => {
  const input = await fixture(); const body = researchArtifact(await generateResearchDocument(input), "research-one", "2026-10-14T00:00:00.000Z");
  const client = { list: vi.fn(async () => []), save: vi.fn(), rename: vi.fn(), delete: vi.fn() };
  const request = { document: body, client, project: vi.fn(), assertOwner: vi.fn(async () => { throw new Error("owner deleted"); }), assertSession: () => {} };
  await expect(commitResearchDocument(request)).rejects.toThrow("owner deleted");
  await expect(commitResearchDocument({ ...request, assertSession: () => { throw new Error("account changed"); } })).rejects.toThrow("account changed");
  expect(client.save).not.toHaveBeenCalled();
});

test.each(["```ts\n$research-read", "~~~\n$research-read", "`code $research-read", "$$formula $research-read"]) ("does not offer an executable picker inside literal text: %s", input => {
  expect(isResearchSkillPosition(input, input.lastIndexOf("$research-read"))).toBe(false);
});
