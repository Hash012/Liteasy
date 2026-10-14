import { canonicalResourceJson } from "../resource-filesystem/resourceFileContent";
import { createArtifactResourceProvider } from "../resource-filesystem/artifactResourceProvider";
import type { AgentArtifactResult, ArtifactTab } from "../artifacts/artifact.types";
import type { ArtifactResultClient } from "../artifacts/artifactResultClient";
import { isArtifactResult } from "../artifacts/artifactResultClient";
import { hashText } from "../context/objectContext";
import { researchDocumentMarkdown, type ResearchDocument } from "./researchDocument";

export function researchArtifact(document: ResearchDocument, artifactId: string, createdAt: string): AgentArtifactResult {
  const owner = document.invocation.destination;
  return { version: "liteasy.agent-artifact/v1", artifactId, artifactType: "research_document", researchDocument: document,
    title: document.draft.title, answer: researchDocumentMarkdown(document), createdAt, citations: [],
    papers: [{ id: owner.paperId, title: owner.title }], sourceContextRefs: document.sources.map(source => source.ref),
    agent: { apiVersion: "liteasy.skill-invocation/v1", runId: document.invocation.requestId, sessionId: document.invocation.origin.parentConversationId ?? document.invocation.requestId, status: "completed" } };
}
export function researchArtifactTab(document: AgentArtifactResult, resultPath?: string): ArtifactTab {
  return { ...document, type: "research_document", agentRunId: document.agent.runId, resultPath };
}
/** The saved artifact is the commit receipt and projection outbox. Its owner and bytes are immutable. */
export async function commitResearchDocument(input: {
  document: AgentArtifactResult; client: ArtifactResultClient; assertOwner: () => Promise<void>;
  assertSession: () => void; project: (document: AgentArtifactResult) => Promise<void>;
}): Promise<{ path: string; projectionPending: boolean }> {
  if (!isArtifactResult(input.document) || !input.document.researchDocument) throw new Error("待保存文档校验失败");
  input.assertSession();
  const payload = canonicalResourceJson(input.document);
  const digest = await hashText(payload);
  const reconcile = async () => {
    const saved = (await input.client.list()).find(item => item.artifactId === input.document.artifactId);
    input.assertSession();
    if (!saved) return false;
    if (await hashText(canonicalResourceJson(saved)) !== digest) throw new Error("同一任务已有不同内容，不能覆盖已保存版本");
    return true;
  };
  let path = `liteasy-local://agent-artifacts/${input.document.artifactId}.json`;
  if (!await reconcile()) {
    await input.assertOwner();
    input.assertSession();
    try {
      const provider = createArtifactResourceProvider({ client: input.client, scope: { id: input.document.researchDocument.invocation.scopeId, kind: "device" } });
      path = (await provider.saveArtifact(input.document)).resultPath;
    }
    catch (error) { if (!await reconcile()) throw error; }
  }
  input.assertSession();
  try { await input.project(input.document); return { path, projectionPending: false }; }
  catch { return { path, projectionPending: true }; }
}
