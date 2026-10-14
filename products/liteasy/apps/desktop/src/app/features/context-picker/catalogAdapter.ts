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
  const papersByObject = new Map<string, Set<string>>(), revisions = new Map<string, string>(), pages = new Map<string, number>();
  for (const { project, assets } of projects.values()) for (const asset of assets) if (asset.ref) {
    const ids = papersByObject.get(asset.ref.objectId) ?? new Set<string>(); ids.add(project.paperId); papersByObject.set(asset.ref.objectId, ids); revisions.set(asset.ref.objectId, asset.ref.revision); if (asset.page) pages.set(asset.ref.objectId, asset.page);
  }
  const artifacts = new Map((input.artifacts ?? []).map(item => [item.artifactId, item]));
  return input.suggestions.map(asset => {
    const ids = new Set<string>();
    const project = asset.projectId ? projects.get(asset.projectId) : undefined;
    if (project) ids.add(project.project.paperId);
    let revision: string | undefined, createdAt: string | undefined, page: number | undefined;
    try {
      const target = parseLiteasyPath((asset.resourcePath ?? "").split("#")[0], input.scope);
      if (target.kind === "paper" || target.kind === "pdf-annotation") ids.add(target.paperId);
      if (target.kind === "artifact" || target.kind === "artifact-annotation") for (const paper of artifacts.get(target.artifactId)?.papers ?? []) ids.add(paper.id);
      if (target.kind === "object") {
        for (const id of papersByObject.get(target.ref.objectId) ?? []) ids.add(id);
        const object = objects.get(target.ref.objectId); page = pages.get(target.ref.objectId);
        revision = target.followLatest ? object?.revision ?? revisions.get(target.ref.objectId) : target.ref.revision;
        createdAt = object?.createdAt;
        if (object?.kind === "source.document") ids.add(object.content.payload.paperId);
        if (object?.kind === "content.fragment") {
          page = object.content.payload.anchors.find(anchor => anchor.type === "pdf")?.page ?? page;
          for (const ref of object.provenance.sourceRefs) for (const id of papersByObject.get(ref.objectId) ?? []) ids.add(id);
        }
      }
    } catch { /* Unknown relationships remain reachable in the all-assets entry. */ }
    return { assetId: asset.id, paperIds: [...ids], revision, createdAt, page };
  });
}
