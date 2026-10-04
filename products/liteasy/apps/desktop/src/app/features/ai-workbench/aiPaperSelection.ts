import type { LocalLibrarySnapshot } from "../library/localLibrary.types";
import { libraryFolderKey } from "../library/libraryFolderMembership";
import type { Paper } from "../workspace/workspace.types";
import { compileSearchQuery, type SearchMetadata } from "../search/searchQuery";
import { catalogSearchMetadata } from "../search/searchMetadata";
import { inferAssetType } from "../library/libraryAssetMetadata";

export type AiPaperFolder = { id: string; name: string; children: AiPaperFolder[]; papers: Paper[] };

export function aiPaperMatches(paper: Paper, query: string, metadata?: SearchMetadata) {
  const text = [paper.title, paper.authors, paper.sourcePath, paper.doi, paper.literature?.authors?.join(" ")].join(" ");
  return compileSearchQuery(query).matches(text, metadata ?? catalogSearchMetadata({ id: paper.id, title: paper.title, format: "pdf", subjects: paper.literature?.subjects, assetType: inferAssetType("pdf", paper.literature?.documentType) }));
}

export function buildAiPaperFolders(papers: Paper[], snapshot: LocalLibrarySnapshot | null, query: string, metadata?: ReadonlyMap<string, SearchMetadata>): AiPaperFolder {
  const compiled = compileSearchQuery(query);
  const root: AiPaperFolder = { id: "root", name: "文献库", children: [], papers: [] };
  const folders = new Map<string, AiPaperFolder>();
  for (const folder of snapshot?.folders ?? []) folders.set(libraryFolderKey(folder.path), { id: folder.path, name: folder.name, children: [], papers: [] });
  for (const folder of snapshot?.folders ?? []) {
    const parent = folder.parentPath ? folders.get(libraryFolderKey(folder.parentPath)) : root;
    (parent ?? root).children.push(folders.get(libraryFolderKey(folder.path))!);
  }
  const paths = new Map(snapshot?.entries.map((entry) => [entry.id, entry.path]));
  for (const paper of papers) {
    const path = libraryFolderKey(paths.get(paper.id) ?? paper.sourcePath ?? "");
    const parent = folders.get(path.slice(0, path.lastIndexOf("/"))) ?? root;
    parent.papers.push(paper);
  }
  function filter(folder: AiPaperFolder, inheritedMatch = false): AiPaperFolder {
    const matchesFolder = !compiled.advanced && (inheritedMatch || Boolean(query.trim() && compiled.textMatches(folder.name)));
    return { ...folder,
      papers: folder.papers.filter((paper) => matchesFolder || aiPaperMatches(paper, query, metadata?.get(paper.id))),
      children: folder.children.map((child) => filter(child, matchesFolder)).filter((child) => !query || child.papers.length || child.children.length)
    };
  }
  return filter(root);
}
