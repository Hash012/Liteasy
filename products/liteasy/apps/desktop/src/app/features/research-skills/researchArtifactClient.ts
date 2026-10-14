import type { ArtifactResultClient } from "../artifacts/artifactResultClient";
/** Research documents use the local durable backend in M1, including when inference uses a cloud model. */
export function withLocalResearchDocuments(input: { current(): ArtifactResultClient; local: ArtifactResultClient; scope(): string }): ArtifactResultClient {
  const visible = (document: Awaited<ReturnType<ArtifactResultClient["list"]>>[number]) => !document.researchDocument || document.researchDocument.invocation.scopeId === input.scope();
  async function localResearch(id: string) {
    const document = (await input.local.list()).find(document => document.artifactId === id && document.artifactType === "research_document");
    if (document && !visible(document)) throw new Error("科研文档不属于当前账号");
    return document;
  }
  return {
    getReadStatus: () => input.current().getReadStatus?.() ?? { issueCount: 0, readOnly: false },
    async list(signal) {
      const current = input.current();
      const results = await current.list(signal);
      const local = current === input.local ? [] : (await input.local.list(signal)).filter(document => document.artifactType === "research_document");
      return [...results, ...local].filter(visible);
    },
    save(document, signal) {
      if (!visible(document)) return Promise.reject(new Error("科研文档不属于当前账号"));
      return (document.artifactType === "research_document" ? input.local : input.current()).save(document, signal);
    },
    async delete(id) { return (await localResearch(id) ? input.local : input.current()).delete(id); },
    async rename(id, title) { return (await localResearch(id) ? input.local : input.current()).rename(id, title); }
  };
}
