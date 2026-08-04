import { readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const maximumPdfBytes = 256 * 1024 * 1024;

export class LocalLibraryPdfError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function readLocalLibraryPdfForBrowser(sourcePath, options = {}) {
  if (typeof sourcePath !== "string" || !sourcePath.trim()) {
    throw new LocalLibraryPdfError("缺少本地 PDF 路径。");
  }
  const root = await realpath(options.rootPath ?? path.join(os.homedir(), "LiteasyLibrary"));
  let resolved;
  try {
    resolved = await realpath(sourcePath);
  } catch {
    throw new LocalLibraryPdfError("本地文献库中找不到该 PDF。", 404);
  }
  if (!isPathInside(root, resolved)) {
    throw new LocalLibraryPdfError("只允许读取 LiteasyLibrary 中的 PDF。", 403);
  }
  if (path.extname(resolved).toLowerCase() !== ".pdf") {
    throw new LocalLibraryPdfError("本地资源不是 PDF 文件。");
  }
  const metadata = await stat(resolved);
  if (!metadata.isFile()) {
    throw new LocalLibraryPdfError("本地资源不是普通文件。");
  }
  if (metadata.size > maximumPdfBytes) {
    throw new LocalLibraryPdfError("PDF 超过 256 MB 的浏览器读取上限。", 413);
  }
  return readFile(resolved);
}
