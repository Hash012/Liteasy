import type { Paper } from "./workspace.types";

export type WorkspaceFolderGroup = {
  folder: string;
  papers: Paper[];
};

export type WorkspaceFolderNode = {
  children: WorkspaceFolderNode[];
  name: string;
  paperCount: number;
  papers: Paper[];
  path: string;
};

export function getWorkspacePaperFolder(paper: Paper) {
  if (!paper.sourcePath) {
    return "未归档文献";
  }

  const normalizedPath = paper.sourcePath.replace(/\\/g, "/");
  const lastSeparatorIndex = normalizedPath.lastIndexOf("/");
  if (lastSeparatorIndex <= 0) {
    return "未归档文献";
  }

  return normalizedPath.slice(0, lastSeparatorIndex);
}

export function groupWorkspacePapersByFolder(papers: Paper[]): WorkspaceFolderGroup[] {
  const groups = new Map<string, Paper[]>();

  papers.forEach((paper) => {
    const folder = getWorkspacePaperFolder(paper);
    groups.set(folder, [...(groups.get(folder) ?? []), paper]);
  });

  return Array.from(groups.entries()).map(([folder, folderPapers]) => ({
    folder,
    papers: folderPapers
  }));
}

function getFolderPathSegments(folder: string) {
  if (folder === "未归档文献") {
    return [{ name: folder, path: folder }];
  }

  const absolute = folder.startsWith("/");
  const segments = folder.split("/").filter(Boolean);
  return segments.map((name, index) => ({
    name,
    path: `${absolute ? "/" : ""}${segments.slice(0, index + 1).join("/")}`
  }));
}

/**
 * Builds a stable VS Code-style folder hierarchy while keeping papers attached
 * to their immediate parent folder. `groupWorkspacePapersByFolder` remains as
 * the small flat projection used by older callers.
 */
export function buildWorkspaceFolderTree(papers: Paper[]): WorkspaceFolderNode[] {
  const roots: WorkspaceFolderNode[] = [];

  groupWorkspacePapersByFolder(papers).forEach((group) => {
    let siblings = roots;
    let currentNode: WorkspaceFolderNode | undefined;

    getFolderPathSegments(group.folder).forEach((segment) => {
      currentNode = siblings.find((node) => node.path === segment.path);
      if (!currentNode) {
        currentNode = {
          children: [],
          name: segment.name,
          paperCount: 0,
          papers: [],
          path: segment.path
        };
        siblings.push(currentNode);
      }
      siblings = currentNode.children;
    });

    if (currentNode) {
      currentNode.papers.push(...group.papers);
    }
  });

  function finalize(nodes: WorkspaceFolderNode[]) {
    nodes.sort((left, right) => left.path.localeCompare(right.path));
    nodes.forEach((node) => {
      finalize(node.children);
      node.papers.sort((left, right) => left.title.localeCompare(right.title));
      node.paperCount =
        node.papers.length +
        node.children.reduce((total, child) => total + child.paperCount, 0);
    });
  }

  finalize(roots);
  return roots;
}
