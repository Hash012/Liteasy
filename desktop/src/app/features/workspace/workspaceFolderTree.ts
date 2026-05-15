import type { Paper } from "./workspace.types";

export type WorkspaceFolderGroup = {
  folder: string;
  papers: Paper[];
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
