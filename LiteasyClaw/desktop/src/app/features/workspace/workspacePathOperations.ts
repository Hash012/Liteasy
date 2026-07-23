import type { Paper } from "./workspace.types";

export function normalizeWorkspacePath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/");
  if (normalized === "/") {
    return normalized;
  }
  return normalized.replace(/\/+$/, "");
}

export function getWorkspacePathName(path: string) {
  const normalized = normalizeWorkspacePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function getWorkspaceParentPath(path: string) {
  const normalized = normalizeWorkspacePath(path);
  const separatorIndex = normalized.lastIndexOf("/");
  if (separatorIndex < 0) {
    return "";
  }
  return separatorIndex === 0 ? "/" : normalized.slice(0, separatorIndex);
}

export function joinWorkspacePath(parentPath: string, name: string) {
  const parent = normalizeWorkspacePath(parentPath);
  if (!parent) {
    return name;
  }
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

export function validateWorkspaceEntryName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/\u0000-\u001f]/.test(trimmed)) {
    throw new Error("名称不能为空，且不能包含斜杠或控制字符。");
  }
  return trimmed;
}

export function buildRenamedPaper(paper: Paper, requestedName: string): Paper {
  const validatedName = validateWorkspaceEntryName(requestedName);
  const title = validatedName.replace(/\.pdf$/i, "");
  const sourcePath = paper.sourcePath
    ? joinWorkspacePath(
        getWorkspaceParentPath(paper.sourcePath),
        `${title}${paper.sourcePath.toLowerCase().endsWith(".pdf") ? ".pdf" : ""}`
      )
    : paper.sourcePath;
  return { ...paper, sourcePath, title };
}

export function buildMovedPaper(paper: Paper, targetFolderPath: string): Paper {
  if (!paper.sourcePath) {
    throw new Error("该条目没有可移动的源路径。");
  }
  const targetFolder = normalizeWorkspacePath(targetFolderPath);
  if (!targetFolder) {
    throw new Error("目标目录不能为空。");
  }
  return {
    ...paper,
    sourcePath: joinWorkspacePath(targetFolder, getWorkspacePathName(paper.sourcePath))
  };
}

export function buildRenamedFolderPath(folderPath: string, requestedName: string) {
  const name = validateWorkspaceEntryName(requestedName);
  return joinWorkspacePath(getWorkspaceParentPath(folderPath), name);
}

export function buildMovedFolderPath(folderPath: string, targetFolderPath: string) {
  const source = normalizeWorkspacePath(folderPath);
  const targetFolder = normalizeWorkspacePath(targetFolderPath);
  if (!source || source === "/" || !targetFolder) {
    throw new Error("源目录和目标目录必须有效。");
  }
  if (targetFolder === source || targetFolder.startsWith(`${source}/`)) {
    throw new Error("不能把目录移动到自身或其子目录中。");
  }
  return joinWorkspacePath(targetFolder, getWorkspacePathName(source));
}

export function replaceWorkspacePathPrefix(path: string, sourcePrefix: string, targetPrefix: string) {
  const normalizedPath = normalizeWorkspacePath(path);
  const source = normalizeWorkspacePath(sourcePrefix);
  const target = normalizeWorkspacePath(targetPrefix);
  if (normalizedPath === source) {
    return target;
  }
  if (!normalizedPath.startsWith(`${source}/`)) {
    return normalizedPath;
  }
  return `${target}${normalizedPath.slice(source.length)}`;
}

export function isWorkspacePathWithinRoot(path: string, rootPath: string) {
  const normalizedPath = normalizeWorkspacePath(path);
  const normalizedRoot = normalizeWorkspacePath(rootPath);
  return (
    normalizedRoot.startsWith("/") &&
    (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`))
  );
}
