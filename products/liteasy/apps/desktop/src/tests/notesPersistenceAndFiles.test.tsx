import "fake-indexeddb/auto";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotesController } from "../app/controllers/useNotesController";
import { NotesPanel } from "../app/features/notes/NotesPanel";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createNotesRepository } from "../app/features/notes/notesRepository";
import { refOf } from "../app/features/objects/object.types";
import {
  PENDING_CAPTURE_MIME,
  OBJECT_TRANSFER_MIME,
} from "../app/features/object-transfer/objectTransfer";
import { NOTES_REFERENCE_MIME } from "../app/features/notes/notesPort";
import { loadPdfNotes } from "../app/features/notes/pdfNotesSource";
import { pdfAnnotationStorageKey } from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import type {
  NoteFileEntry,
  NoteFileMount,
  NoteFileService,
  NoteFileSnapshot,
} from "../app/features/note-files/noteFileService";

const gateway = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../app/features/note-files/noteFileService", () => ({
  createNoteFileService: gateway.create,
  subscribeNoteFiles: () => () => undefined,
}));
function fileFixture() {
  const mount: NoteFileMount = {
    id: "vault",
    name: "Research Vault",
    location: "/vault",
    kind: "directory",
  };
  const disk = new Map<string, NoteFileSnapshot>();
  let mounted = false;
  let revision = 0;
  const put = (path: string, text: string) => {
    const file: NoteFileSnapshot = {
      mountId: mount.id,
      path,
      name: path.split("/").at(-1)!,
      kind: "file",
      text,
      version: `v${++revision}`,
    };
    disk.set(path, file);
    return file;
  };
  const directories: NoteFileEntry[] = [];
  const service: NoteFileService = {
    listMounts: vi.fn(async () => (mounted ? [mount] : [])),
    chooseFolder: vi.fn(async () => {
      mounted = true;
      return mount;
    }),
    listEntries: vi.fn(async () => [...directories, ...disk.values()]),
    readFile: vi.fn(async (_mountId, path) => {
      const file = disk.get(path);
      if (!file) throw new Error("missing file");
      return { ...file };
    }),
    writeFile: vi.fn(async (input) => {
      if ((disk.get(input.path)?.version ?? null) !== input.expectedVersion)
        throw new Error("文件已在其他应用中修改，请重新打开后再保存。");
      return put(input.path, input.text);
    }),
    createDirectory: vi.fn(async (mountId, path) => {
      directories.push({
        mountId,
        path,
        name: path.split("/").at(-1)!,
        kind: "directory",
      });
    }),
    pickFiles: vi.fn(async () => []),
    chooseFile: vi.fn(async () => null),
  };
  return {
    service,
    disk,
    mount,
    put,
    mountNow: () => {
      mounted = true;
    },
  };
}
let fileSystem: ReturnType<typeof fileFixture>;
beforeEach(() => {
  fileSystem = fileFixture();
  gateway.create.mockReturnValue(fileSystem.service);
});
function fixture() {
  const scopeId = `notes-files-${crypto.randomUUID()}`;
  const storage = createObjectStorage(scopeId, () => scopeId);
  const repository = createObjectRepository(storage, scopeId);
  return {
    repository,
    notes: createNotesRepository(storage),
    input: {
      scopeId,
      repository,
      visible: true,
      getPapers: () => [],
      onOpen: vi.fn(),
      openObject: vi.fn(),
      openAnnotation: vi.fn(),
    },
  };
}
const note = (text: string) => ({
  kind: "content.note" as const,
  title: text.split("\n")[0],
  content: {
    schema: "liteasy.note/v1" as const,
    payload: { text, origin: "user" as const },
  },
});
function transfer(values: Record<string, string> = {}, files: File[] = []) {
  return {
    getData: (type: string) => values[type] ?? "",
    setData: (type: string, text: string) => {
      values[type] = text;
    },
    files,
    types: Object.keys(values),
    effectAllowed: "all",
  } as unknown as DataTransfer;
}

describe("durable Notes with unavailable optional sources", () => {
  it("saves and restores new local notes while artifact fetches fail", async () => {
    const f = fixture();
    const input = {
      ...f.input,
      listArtifacts: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    };
    const first = renderHook(() => useNotesController(input));
    await waitFor(() =>
      expect(first.result.current.model.sourceWarning).toContain("部分来源"),
    );
    await act(async () => {
      await first.result.current.model.createNote("本机记录\n不能因断网消失");
    });
    expect(first.result.current.model.error).toBe("");
    expect(first.result.current.model.items[0]?.text).toContain(
      "不能因断网消失",
    );
    first.unmount();
    const reopened = renderHook(() => useNotesController(input));
    await waitFor(() =>
      expect(reopened.result.current.model.items[0]?.text).toContain(
        "不能因断网消失",
      ),
    );
    expect(reopened.result.current.model.error).toBe("");
  });

  it("does not await a hanging remote source when a local note is saved", async () => {
    const f = fixture();
    const { result } = renderHook(() =>
      useNotesController({
        ...f.input,
        listArtifacts: () => new Promise(() => undefined),
      }),
    );
    await act(async () => {
      await result.current.model.createNote("离线创建");
    });
    expect(result.current.model.items[0]?.title).toBe("离线创建");
    expect(result.current.model.busy).toBe(false);
  });

  it("isolates an unreadable PDF from other saved paper entries and retains review text", async () => {
    const broken = { id: crypto.randomUUID(), title: "坏文件" };
    const paper = { id: crypto.randomUUID(), title: "有效论文" };
    const now = new Date().toISOString();
    localStorage.setItem(pdfAnnotationStorageKey(broken)!, "broken json");
    localStorage.setItem(
      pdfAnnotationStorageKey(paper)!,
      JSON.stringify([
        {
          id: "entry",
          kind: "highlight",
          paperIdentity: resolvePaperIdentity(paper),
          page: 1,
          excerpt: "Evidence",
          text: "Evidence",
          rects: [],
          revision: 2,
          createdAt: now,
          updatedAt: now,
          publication: { state: "not_published", desiredVisibility: "private" },
          review: {
            text: "Check this evidence",
            generatedAt: now,
            updatedAt: now,
            sourceRevision: 1,
          },
        },
      ]),
    );
    const failed = vi.fn();
    const items = await loadPdfNotes([broken, paper], failed);
    expect(failed).toHaveBeenCalledWith(broken.id, expect.anything());
    expect(items).toHaveLength(1);
    expect(items[0].text).toContain("Check this evidence");
    expect(items[0].automaticallyListed).toBe(true);
  });

  it("receives trusted highlight captures into a Note directory without creating a board", async () => {
    const f = fixture();
    const object = await f.repository.create(
      note("Captured annotation\n## AI review\nKeep the reasoning"),
    );
    const receiveContextDrop = vi.fn(
      async (data: Pick<DataTransfer, "getData">) => {
        expect(data.getData(PENDING_CAPTURE_MIME)).toBe("trusted-ticket");
        return [
          {
            ref: refOf(object),
            refs: [refOf(object)],
            title: object.title,
            kind: object.kind,
          },
        ];
      },
    );
    const folder = await f.notes.createFolder("root", "Evidence");
    const { result } = renderHook(() =>
      useNotesController({ ...f.input, receiveContextDrop }),
    );
    await act(async () => {
      await result.current.model.drop(
        transfer({ [PENDING_CAPTURE_MIME]: "trusted-ticket" }),
        folder.folderId,
      );
    });
    expect(await f.notes.listReferences()).toHaveLength(1);
    expect(
      (await f.repository.search()).objects.some(
        (item) => item.kind === "workspace.board",
      ),
    ).toBe(false);
    act(() => result.current.model.selectFolder(folder.folderId));
    expect(result.current.model.items[0].text).toContain("Keep the reasoning");
    await act(async () => {
      await expect(
        result.current.model.drop(
          transfer({ [NOTES_REFERENCE_MIME]: '{"kind":"invalid"}' }),
          folder.folderId,
        ),
      ).rejects.toThrow();
    });
    expect(result.current.model.error).not.toBe("");
  });
});

it("keeps dropped native highlights as live entry references, including later review edits", async () => {
  const f = fixture();
  const folder = await f.notes.createFolder("root", "Reading");
  const paper = { id: crypto.randomUUID(), title: "Paper" };
  const now = new Date().toISOString();
  const entry = {
    id: "highlight",
    kind: "highlight",
    paperIdentity: resolvePaperIdentity(paper),
    page: 1,
    excerpt: "Source sentence",
    text: "Source sentence",
    rects: [],
    revision: 2,
    createdAt: now,
    updatedAt: now,
    publication: { state: "not_published", desiredVisibility: "private" },
    review: {
      text: "First review",
      generatedAt: now,
      updatedAt: now,
      sourceRevision: 1,
    },
  };
  localStorage.setItem(
    pdfAnnotationStorageKey(paper)!,
    JSON.stringify([entry]),
  );
  const receiveContextDrop = vi.fn();
  const { result } = renderHook(() =>
    useNotesController({
      ...f.input,
      getPapers: () => [paper],
      receiveContextDrop,
    }),
  );
  const target = {
    kind: "pdf-annotation",
    paperId: paper.id,
    annotationId: "highlight",
  };
  await act(async () => {
    await result.current.model.drop(
      transfer({
        [NOTES_REFERENCE_MIME]: JSON.stringify(target),
        [PENDING_CAPTURE_MIME]: "also-a-ticket",
      }),
      folder.folderId,
    );
  });
  act(() => result.current.model.selectFolder(folder.folderId));
  expect((await f.notes.listReferences())[0].target).toEqual(target);
  expect(receiveContextDrop).not.toHaveBeenCalled();
  expect(result.current.model.items[0].text).toContain("First review");
  localStorage.setItem(
    pdfAnnotationStorageKey(paper)!,
    JSON.stringify([
      {
        ...entry,
        revision: 3,
        review: { ...entry.review, text: "Edited review" },
      },
    ]),
  );
  await act(async () => {
    await result.current.model.refresh();
  });
  await waitFor(() =>
    expect(result.current.model.items[0].text).toContain("Edited review"),
  );
});

it("imports a dragged Vault hierarchy while omitting hidden settings and non-Markdown attachments", async () => {
  const f = fixture();
  const fileEntry = (name: string, text: string) => ({
    name,
    isFile: true,
    isDirectory: false,
    file: (resolve: (file: File) => void) =>
      resolve({ name, size: text.length, text: async () => text } as File),
  });
  const directory = (name: string, children: unknown[]) => ({
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let sent = false;
      return {
        readEntries: (resolve: (items: unknown[]) => void) => {
          resolve(sent ? [] : children);
          sent = true;
        },
      };
    },
  });
  const vault = directory("Vault", [
    directory("Topic", [
      fileEntry("Study.md", "# Topic body"),
      fileEntry("figure.png", "binary"),
    ]),
    directory(".obsidian", [fileEntry("Private.md", "not imported")]),
  ]);
  const data = transfer();
  Object.defineProperty(data, "items", {
    value: [{ kind: "file", webkitGetAsEntry: () => vault }],
  });
  const { result } = renderHook(() => useNotesController(f.input));
  await act(async () => {
    await result.current.model.drop(data, "root");
  });
  const folders = await f.notes.listFolders();
  const root = folders.find((folder) => folder.name === "Vault")!;
  const topic = folders.find((folder) => folder.name === "Topic")!;
  expect(topic.parentId).toBe(root.folderId);
  const objects = (await f.repository.search()).objects;
  expect(objects).toHaveLength(1);
  expect(objects[0].title).toBe("Study.md");
  expect((await f.notes.listReferences())[0].folderId).toBe(topic.folderId);
});

describe("Markdown files and connected Vaults", () => {
  it("imports Markdown verbatim into the drop destination and survives reopening", async () => {
    const f = fixture();
    const folder = await f.notes.createFolder("root", "Imported");
    const file = new File([], "Source.md", { type: "text/markdown" });
    Object.defineProperty(file, "text", {
      value: async () =>
        "---\ntags: [research]\n---\n# Source\n[[Another note]]",
    });
    const first = renderHook(() => useNotesController(f.input));
    await act(async () => {
      await first.result.current.model.drop(
        transfer({}, [file]),
        folder.folderId,
      );
    });
    const objects = (await f.repository.search()).objects;
    expect(objects[0].title).toBe("Source.md");
    expect(objects[0].content.payload).toMatchObject({
      text: await file.text(),
    });
    expect((await f.notes.listReferences())[0].folderId).toBe(folder.folderId);
    first.unmount();
    const reopened = renderHook(() => useNotesController(f.input));
    await waitFor(() =>
      expect(reopened.result.current.model.items[0]?.title).toBe("Source.md"),
    );
    await act(async () => {
      await reopened.result.current.model.editNote(
        reopened.result.current.model.items[0],
        "Updated body",
      );
    });
    expect((await f.repository.resolveLatest(objects[0].objectId)).title).toBe(
      "Source.md",
    );
  });

  it("connects a Vault, uses stable file references and writes standalone Markdown without overwriting an existing file", async () => {
    const f = fixture();
    fileSystem.put("Existing.md", "# Original\nDo not overwrite");
    const object = await f.repository.create(
      note("Existing\nAnnotation body\n\n## AI review\nReview travels"),
    );
    const { result } = renderHook(() => useNotesController(f.input));
    await act(async () => {
      await result.current.model.connectFolder();
    });
    await waitFor(() =>
      expect(
        result.current.model.items.some((item) => item.title === "Existing.md"),
      ).toBe(true),
    );
    const external = result.current.model.items.find((item) => item.file)!;
    expect(
      await f.repository.getObjectFileBinding(external.object!.objectId),
    ).toMatchObject({ mountId: "vault", path: "Existing.md" });
    const data = transfer();
    result.current.model.drag(external, data);
    expect(
      JSON.parse(data.getData(OBJECT_TRANSFER_MIME)).refs[0].objectId,
    ).toBe(external.object!.objectId);
    await act(async () => {
      await result.current.port.collect(
        { kind: "object", ref: refOf(object) },
        result.current.model.folderId,
      );
    });
    expect(fileSystem.disk.get("Existing.md")?.text).toBe(
      "# Original\nDo not overwrite",
    );
    expect(fileSystem.disk.get("Existing (2).md")?.text).toContain(
      "Review travels",
    );
    expect(fileSystem.disk.get("Existing (2).md")?.text).toContain(
      "liteasy://objects/",
    );
    expect(await f.notes.listReferences()).toEqual([]);
    const folder = await f.notes.createFolder("root", "View");
    await act(async () => {
      await result.current.model.collect(external, folder.folderId);
    });
    expect((await f.notes.listReferences())[0].target).toEqual({
      kind: "external-file",
      mountId: "vault",
      path: "Existing.md",
    });
    expect(fileSystem.disk.size).toBe(2);
  });

  it("shows filenames alone in the list and keeps the edit revision fixed when another application changes the file", async () => {
    const f = fixture();
    fileSystem.mountNow();
    fileSystem.put("Source.md", "Original external body");
    let view!: ReturnType<typeof useNotesController>;
    function Harness() {
      view = useNotesController(f.input);
      return (
        <FluentProvider theme={webLightTheme}>
          <NotesPanel model={view.model} />
        </FluentProvider>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    const entry = await screen.findByRole("button", {
      name: "查看笔记 Source.md",
    });
    const list = screen.getByRole("list", { name: "笔记条目" });
    expect(within(list).queryByText("Original external body")).toBeNull();
    expect(within(list).getByText("Source.md")).toBeTruthy();
    await user.click(entry);
    expect(
      screen.getByRole("region", { name: "打开的笔记" }),
    ).toHaveTextContent("Original external body");
    await user.click(
      screen.getByRole("button", { name: "编辑笔记", exact: true }),
    );
    const editor = screen.getByRole("textbox", { name: "笔记正文" });
    await user.clear(editor);
    await user.type(editor, "My unsaved changes");
    const next = fileSystem.put("Source.md", "Changed in Obsidian");
    await act(async () => {
      await view.refresh();
    });
    await waitFor(() =>
      expect(view.model.items.find((item) => item.file)?.file?.version).toBe(
        next.version,
      ),
    );
    await user.click(screen.getByRole("button", { name: "保存", exact: true }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("其他应用中修改"),
    );
    expect(fileSystem.disk.get("Source.md")?.text).toBe("Changed in Obsidian");
    expect(editor).toHaveValue("My unsaved changes");
  });
});
