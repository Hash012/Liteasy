import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createPaperProjectRepository } from "../app/features/paper-projects/paperProjectRepository";
import { contextCatalogRelations } from "../app/features/context-picker/catalogAdapter";
import { createContextCatalogPort } from "../app/features/context-picker/catalogPort";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import type { AssistantComposerSuggestion } from "../app/features/assistant/assistant.types";
import type { Paper } from "../app/features/workspace/workspace.types";

/** Production persistence → relationships → catalog. No synthetic #page fragments. */
export async function contextPickerSourceFixture() {
  const scope = `source-preview-${crypto.randomUUID()}`;
  const storage = createObjectStorage(scope, () => scope);
  const repository = createObjectRepository(storage, scope);
  const projects = createPaperProjectRepository(storage, scope);
  const paper = { id: "physical-pages", title: "101 页来源定位", sourcePath: "physical-pages.pdf", contentHash: "fixture-v1" } as Paper;
  const project = await projects.ensurePaperProject({ paperId: paper.id, title: paper.title });
  const assets = await Promise.all([1, 49, 50, 101].map(page => projects.registerSource(project.projectId, {
    paperId: paper.id, assetId: `page-${page}`, kind: "text", title: `${paper.title} · 第 ${page} 页`,
    text: `PHYSICAL PAGE ${page}`, page, documentHash: paper.contentHash,
  })));
  const suggestions: AssistantComposerSuggestion[] = assets.map(asset => ({
    id: asset.assetId, trigger: "@", label: asset.title, category: "原文", scopeId: scope,
    projectId: project.projectId, projectTitle: project.title,
    resourcePath: liteasyPath(scope, { kind: "object", ref: asset.ref! }),
    token: { id: asset.assetId, kind: "object", label: asset.title, prompt: "", contextRefs: [asset.ref!] },
  }));
  const objects = await Promise.all(assets.map(asset => repository.get(asset.ref!)));
  const relations = contextCatalogRelations({ scope, suggestions, projects: [{ project, assets }], objects });
  const catalog = createContextCatalogPort({ scope, revision: "fixture-v1", assets: suggestions, relations,
    entries: [{ id: paper.id, title: paper.title, format: "pdf" }], collections: [],
    inventories: { [paper.id]: { state: "ready", extraction: "ready", items: [] } },
  });
  return { scope, repository, projects, project, paper, assets, suggestions, objects, catalog };
}
