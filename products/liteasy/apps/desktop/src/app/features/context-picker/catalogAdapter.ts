import type { AssistantComposerSuggestion } from "../assistant/assistant.types";
import type { ObjectEnvelope } from "../objects/object.types";
import type { PaperProject, PaperProjectAsset } from "../paper-projects/paperProjectRepository";
import { parseLiteasyPath } from "../resource-filesystem/liteasyPath";
import type { ArtifactTab } from "../artifacts/artifact.types";
import type { CatalogRelation } from "./catalogPort";

/** Relationships come from registered sources, never from matching display titles. */
export function contextCatalogRelations(input: { scope: string; suggestions: readonly AssistantComposerSuggestion[];
  projects?: readonly { project: PaperProject; assets: PaperProjectAsset[] }[]; objects?: readonly ObjectEnvelope[]; artifacts?: readonly ArtifactTab[];
}): CatalogRelation[] {
  const projects = new Map((input.projects ?? []).filter(item => item.project.scopeId === input.scope).map(item => [item.project.projectId, item]));
  const objects = new Map((input.objects ?? []).filter(item => item.scopeId === input.scope).map(item => [item.objectId, item]));
  const papersByObject = new Map<string, Set<string>>(), revisions = new Map<string, string>(), pages = new Map<string, Set<number>>();
  for (const { project, assets } of projects.values()) for (const asset of assets) if (asset.ref) {
    const ids = papersByObject.get(asset.ref.objectId) ?? new Set<string>(); ids.add(project.paperId); papersByObject.set(asset.ref.objectId, ids); revisions.set(asset.ref.objectId, asset.ref.revision); if (asset.page) { const key = JSON.stringify([asset.ref.objectId, asset.ref.revision]); const values = pages.get(key) ?? new Set<number>(); values.add(asset.page); pages.set(key, values); }
  }
  const artifacts = new Map((input.artifacts ?? []).map(item => [item.artifactId, item]));
  return input.suggestions.map(asset => {
    const ids = new Set<string>();
    const project = asset.projectId ? projects.get(asset.projectId) : undefined;
    if (project) ids.add(project.project.paperId);
    let revision: string | undefined, createdAt: string | undefined, page: number | undefined, ownerPaperId: string | undefined;
    try {
      const target = parseLiteasyPath((asset.resourcePath ?? "").split("#")[0], input.scope);
      if (target.kind === "paper" || target.kind === "pdf-annotation") ids.add(target.paperId);
      if (target.kind === "artifact" || target.kind === "artifact-annotation") for (const paper of artifacts.get(target.artifactId)?.papers ?? []) ids.add(paper.id);
      if (target.kind === "object") {
        for (const id of papersByObject.get(target.ref.objectId) ?? []) ids.add(id);
        const candidate = objects.get(target.ref.objectId);
        const object = target.followLatest || candidate?.revision === target.ref.revision ? candidate : undefined; const member = project?.assets.find(member => member.ref?.objectId === target.ref.objectId && member.ref.revision === target.ref.revision);
        const knownPages = member?.page ? new Set([member.page]) : pages.get(JSON.stringify([target.ref.objectId, target.ref.revision]));
        page = knownPages?.size === 1 ? [...knownPages][0] : undefined;
        revision = target.followLatest ? object?.revision ?? revisions.get(target.ref.objectId) : target.ref.revision;
        createdAt = object?.createdAt;
        if (object?.kind === "source.document") { ids.add(object.content.payload.paperId); ownerPaperId = object.content.payload.paperId;
          const recorded = [...new Set(object.paperAnchors?.flatMap(anchor => anchor.source.paperId === ownerPaperId && anchor.locator.page ? [anchor.locator.page] : []) ?? object.content.payload.pages?.map(value => value.page) ?? [])];
          page = recorded.length === 1 ? recorded[0] : recorded.length ? undefined : page;
        }
        if (object?.kind === "content.fragment") {
          page = object.content.payload.anchors.find(anchor => anchor.type === "pdf")?.page ?? page;
          for (const ref of object.provenance.sourceRefs) for (const id of papersByObject.get(ref.objectId) ?? []) ids.add(id);
        }
      }
    } catch { /* Unknown relationships remain reachable in the all-assets entry. */ }
    return { assetId: asset.id, paperIds: [...ids], ownerPaperId, revision, createdAt, page };
  });
}
