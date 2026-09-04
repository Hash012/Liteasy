import type { LocalLibrarySnapshot } from "../../app/features/library/localLibrary.types";

export const fileWorkflowTestPaper = {
  contentHash: "891a3556b6c828b304d1bff0a63f96598970aa08091b4a679cf1133e5bf44755",
  id: "file-workflow-test-larimar",
  publicPath: "/file-workflow-test/larimar-episodic-memory.pdf",
  relativePath: "Larimar - Large Language Models with Episodic Memory Control.pdf",
  title: "Larimar: Large Language Models with Episodic Memory Control"
} as const;

let browserPdfSourcePromise: Promise<string> | null = null;

async function createVerifiedBrowserPdfSource() {
  const response = await fetch(new URL(fileWorkflowTestPaper.publicPath, window.location.origin));
  if (!response.ok) {
    throw new Error(`无法读取分支测试论文：HTTP ${response.status}`);
  }

  const bytes = await response.arrayBuffer();
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  const contentHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (contentHash !== fileWorkflowTestPaper.contentHash) {
    throw new Error("分支测试论文的 SHA-256 与注册值不一致。");
  }

  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

export async function loadFileWorkflowTestLibrary(): Promise<LocalLibrarySnapshot> {
  browserPdfSourcePromise ??= createVerifiedBrowserPdfSource();
  const sourcePath = await browserPdfSourcePromise;
  return {
    entries: [{
      contentHash: fileWorkflowTestPaper.contentHash,
      id: fileWorkflowTestPaper.id,
      path: sourcePath,
      relativePath: fileWorkflowTestPaper.relativePath,
      title: fileWorkflowTestPaper.title
    }],
    folders: [],
    libraryId: "file-workflow-test",
    revision: 1,
    rootPath: "Vite 文件工作流测试库",
    trashEntries: []
  };
}
