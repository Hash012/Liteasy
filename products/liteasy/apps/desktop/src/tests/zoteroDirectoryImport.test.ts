import { beforeEach, expect, test, vi } from "vitest";
import type { LocalLibrarySnapshot } from "../app/features/library/localLibrary.types";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

import {
  createLocalLibraryPdfStream,
  persistPdfByteStream,
  persistZoteroPdfDirectory
} from "../app/features/library/libraryFileSystemClient";

const emptySnapshot: LocalLibrarySnapshot = {
  entries: [],
  folders: [],
  libraryId: "library-1",
  revision: 1,
  rootPath: "/library",
  trashEntries: []
};

function directoryFile(relativePath: string, body: string) {
  const file = new File([`%PDF-1.7\n${body}\n%%EOF`], relativePath.split("/").at(-1)!, {
    type: "application/pdf"
  });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

beforeEach(() => {
  invokeMock.mockReset();
});

test("imports Zotero PDFs sequentially while preserving relative hierarchy", async () => {
  const snapshots = [
    { ...emptySnapshot, revision: 3 },
    { ...emptySnapshot, revision: 5 }
  ];
  invokeMock.mockImplementation(async (command: string, input: Record<string, unknown>) => {
    if (command === "ensure_local_library_relative_folder") {
      return `/library/${input.relativePath}`;
    }
    if (command === "finish_local_library_pdf_import") {
      return {
        duplicates: [],
        snapshot: snapshots.shift(),
        status: "imported"
      };
    }
    return undefined;
  });

  const result = await persistZoteroPdfDirectory({
    files: [
      directoryFile("Zotero Export/Collection A/Paper A.pdf", "paper-a"),
      directoryFile("Zotero Export/Collection B/Subgroup/Paper B.pdf", "paper-b")
    ],
    snapshot: emptySnapshot
  });

  expect(result).toEqual(expect.objectContaining({ importedCount: 2, status: "imported" }));
  const folderCalls = invokeMock.mock.calls.filter(([command]) => command === "ensure_local_library_relative_folder");
  expect(folderCalls.map(([, input]) => input.relativePath)).toEqual([
    "Collection A",
    "Collection B/Subgroup"
  ]);
  const beginCalls = invokeMock.mock.calls.filter(([command]) => command === "begin_local_library_pdf_import");
  expect(beginCalls.map(([, input]) => input.targetFolderPath)).toEqual([
    "/library/Collection A",
    "/library/Collection B/Subgroup"
  ]);
  expect(beginCalls[0][1].name).toBe("Paper A.pdf");
  expect(beginCalls[1][1].name).toBe("Paper B.pdf");
  expect(invokeMock.mock.calls.filter(([command]) => command === "append_local_library_pdf_import"))
    .toHaveLength(2);
});

test("cancels a staged duplicate without publishing it", async () => {
  const file = directoryFile("Zotero Export/Paper.pdf", "same-paper");
  const onDuplicate = vi.fn(async () => false);
  invokeMock.mockImplementation(async (command: string, input: Record<string, unknown>) => {
    if (command !== "finish_local_library_pdf_import") return undefined;
    if (input.duplicateAction === "cancel") {
      return { duplicates: [], snapshot: emptySnapshot, status: "cancelled" };
    }
    return {
      duplicates: [{
        contentHash: "hash",
        existingDocumentIds: ["existing-paper"],
        name: "Paper.pdf"
      }],
      snapshot: emptySnapshot,
      status: "duplicate"
    };
  });
  const result = await persistZoteroPdfDirectory({
    files: [file],
    onDuplicate,
    snapshot: emptySnapshot
  });

  expect(result.status).toBe("cancelled");
  expect(result.importedCount).toBe(0);
  expect(onDuplicate).toHaveBeenCalledWith(expect.objectContaining({
    duplicates: [expect.objectContaining({ existingDocumentIds: ["existing-paper"] })]
  }));
  expect(invokeMock.mock.calls.filter(([command]) => command === "cancel_local_library_pdf_import"))
    .toHaveLength(0);
  expect(invokeMock.mock.calls.filter(([command, input]) => (
    command === "finish_local_library_pdf_import" && input.duplicateAction === "cancel"
  ))).toHaveLength(1);
});

test("writes response streams in bounded chunks without constructing a File", async () => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "finish_local_library_pdf_import") {
      return { duplicates: [], snapshot: emptySnapshot, status: "imported" };
    }
    return undefined;
  });
  const body = new Uint8Array(512 * 1024 + 17);
  body.set([37, 80, 68, 70, 45]);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body);
      controller.close();
    }
  });

  await expect(persistPdfByteStream({
    fileName: "Streamed.pdf",
    stream,
    targetFolderPath: "/library/Papers"
  })).resolves.toBe(emptySnapshot);

  const appendCalls = invokeMock.mock.calls.filter(([command]) => (
    command === "append_local_library_pdf_import"
  ));
  expect(appendCalls.map(([, input]) => (input.bytes as number[]).length)).toEqual([
    512 * 1024,
    17
  ]);
});

test("reads local upload sources from Tauri in bounded chunks", async () => {
  invokeMock.mockImplementation(async (command: string, input: Record<string, unknown>) => {
    if (command === "local_library_pdf_info") return { byteLength: 7 };
    if (command === "read_local_library_pdf_chunk") {
      const offset = Number(input.offset);
      return offset === 0 ? [37, 80, 68, 70, 45] : [1, 2];
    }
    return undefined;
  });

  const { byteLength, stream } = await createLocalLibraryPdfStream("/library/Paper.pdf");
  const reader = stream.getReader();
  const first = await reader.read();
  const second = await reader.read();
  const end = await reader.read();

  expect(byteLength).toBe(7);
  expect(Array.from(first.value ?? [])).toEqual([37, 80, 68, 70, 45]);
  expect(Array.from(second.value ?? [])).toEqual([1, 2]);
  expect(end.done).toBe(true);
  expect(invokeMock.mock.calls.filter(([command]) => (
    command === "read_local_library_pdf_chunk"
  )).map(([, input]) => input.offset)).toEqual([0, 5]);
});

test("cancels a streaming import when the response body fails", async () => {
  invokeMock.mockResolvedValue(undefined);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([37, 80, 68, 70, 45]));
      controller.error(new Error("connection reset"));
    }
  });

  await expect(persistPdfByteStream({ fileName: "Interrupted.pdf", stream }))
    .rejects.toThrow("connection reset");
  expect(invokeMock.mock.calls.some(([command]) => (
    command === "cancel_local_library_pdf_import"
  ))).toBe(true);
});

test("rejects unsupported or unsafe directory selections", async () => {
  await expect(persistZoteroPdfDirectory({
    files: [new File(["{}"], "library.json", { type: "application/json" })],
    snapshot: emptySnapshot
  })).rejects.toThrow("没有 PDF");

  const unsafe = directoryFile("Zotero Export/../Paper.pdf", "unsafe");
  await expect(persistZoteroPdfDirectory({
    files: [unsafe],
    snapshot: emptySnapshot
  })).rejects.toThrow("无效路径");
  expect(invokeMock).not.toHaveBeenCalled();
});
