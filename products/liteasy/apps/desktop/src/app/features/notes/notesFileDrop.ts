import type { ImportedNoteFile } from "../note-files/noteFileService";

/** Read browser/desktop HTML drag entries synchronously before awaiting file IO. */
export function readNotesFileDrop(
  data: Pick<DataTransfer, "files" | "items">,
): Promise<ImportedNoteFile[]> | undefined {
  const entries = Array.from(data.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (!entries.length) {
    const files = Array.from(data.files ?? []);
    if (!files.length) return;
    return Promise.all(
      files.map(async (file) => {
        if (!/\.(md|markdown)$/i.test(file.name))
          throw new Error("请选择 Markdown 文件（.md 或 .markdown）。");
        if (file.size > 8 * 1024 * 1024)
          throw new Error(`文件过大：${file.name}`);
        return {
          name: file.name,
          path: file.webkitRelativePath || file.name,
          text: await file.text(),
        };
      }),
    );
  }
  return (async () => {
    const documents: ImportedNoteFile[] = [];
    async function walk(entry: FileSystemEntry, parent: string, depth: number) {
      if (depth > 64 || documents.length >= 10000)
        throw new Error("文件夹过大，请分批导入。");
      if (entry.name.startsWith(".")) return;
      const path = `${parent}${entry.name}`;
      if (entry.isFile) {
        if (!/\.(md|markdown)$/i.test(entry.name)) {
          if (depth === 0)
            throw new Error("请选择 Markdown 文件（.md 或 .markdown）。");
          return;
        }
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
        if (file.size > 8 * 1024 * 1024)
          throw new Error(`文件过大：${file.name}`);
        documents.push({ name: entry.name, path, text: await file.text() });
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        while (true) {
          const children = await new Promise<FileSystemEntry[]>(
            (resolve, reject) => reader.readEntries(resolve, reject),
          );
          if (!children.length) break;
          for (const child of children)
            await walk(child, `${path}/`, depth + 1);
        }
      }
    }
    for (const entry of entries) await walk(entry, "", 0);
    return documents;
  })();
}
