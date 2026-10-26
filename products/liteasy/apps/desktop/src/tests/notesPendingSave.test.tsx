import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test, vi } from "vitest";
import { NotesPanel } from "../app/features/notes/NotesPanel";
import { useNotesController } from "../app/controllers/useNotesController";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import type { NotesItem } from "../app/features/notes/notes.types";

function setup() {
  const scopeId = `pending-notes-${crypto.randomUUID()}`;
  const repository = createObjectRepository(createObjectStorage(scopeId, () => scopeId), scopeId);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const create = vi.fn(async (save: () => Promise<NotesItem | void>) => {
    const item = await save();
    await gate;
    return item;
  });
  const edit = vi.fn(async (item: NotesItem, text: string, save: () => Promise<NotesItem | void>) => save());
  function Harness() {
    const { model } = useNotesController({ scopeId, repository, visible: true, getPapers: () => [],
      onOpen: vi.fn(), openObject: vi.fn(), openAnnotation: vi.fn() });
    return <FluentProvider theme={webLightTheme}><NotesPanel model={{ ...model,
      createNote: (text) => create(() => model.createNote(text)),
      editNote: (item, text) => edit(item, text, () => model.editNote(item, text)),
    }} /></FluentProvider>;
  }
  render(<Harness />);
  return { repository, create, edit, release, user: userEvent.setup() };
}

test("keeps text entered during save and saves its next revision to the same persisted note", async () => {
  const f = setup();
  await f.user.click(screen.getByRole("button", { name: "新建笔记" }));
  fireEvent.change(screen.getByRole("textbox", { name: "笔记正文" }), { target: { value: "First snapshot" } });
  const form = screen.getByRole("textbox", { name: "笔记正文" }).closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(f.create).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "笔记正文" }), { target: { value: "Newer unsaved text" } });
  await act(async () => { f.release(); });
  await waitFor(() => expect(screen.getByRole("button", { name: "保存", exact: true })).toBeEnabled());
  expect(screen.getByRole("textbox", { name: "笔记正文" })).toHaveValue("Newer unsaved text");
  const first = (await f.repository.search()).objects;
  expect(first).toHaveLength(1);
  await f.user.click(screen.getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "笔记正文" })).not.toBeInTheDocument());
  expect(f.create).toHaveBeenCalledOnce();
  expect(f.edit).toHaveBeenCalledOnce();
  expect(f.edit.mock.calls[0][0].object?.objectId).toBe(first[0].objectId);
  const saved = (await f.repository.search()).objects;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ objectId: first[0].objectId, content: { payload: { text: "Newer unsaved text" } } });
  expect(saved[0].revision).not.toBe(first[0].revision);
});

test("completion of a cancelled draft cannot close a new editor with the same text", async () => {
  const f = setup();
  await f.user.click(screen.getByRole("button", { name: "新建笔记" }));
  fireEvent.change(screen.getByRole("textbox", { name: "笔记正文" }), { target: { value: "Same text" } });
  await f.user.click(screen.getByRole("button", { name: "保存", exact: true }));
  await f.user.click(screen.getByRole("button", { name: "取消编辑笔记" }));
  await f.user.click(screen.getByRole("button", { name: "新建笔记" }));
  fireEvent.change(screen.getByRole("textbox", { name: "笔记正文" }), { target: { value: "Same text" } });
  await act(async () => { f.release(); });
  await waitFor(() => expect(screen.getByRole("button", { name: "保存", exact: true })).toBeEnabled());
  expect(screen.getByRole("textbox", { name: "笔记正文" })).toHaveValue("Same text");
  await f.user.click(screen.getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(f.create).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "笔记正文" })).not.toBeInTheDocument());
  expect((await f.repository.search()).objects).toHaveLength(2);
});

test("editing and restoring the submitted text while saving keeps the newer editor revision open", async () => {
  const f = setup();
  await f.user.click(screen.getByRole("button", { name: "新建笔记" }));
  const editor = screen.getByRole("textbox", { name: "笔记正文" });
  fireEvent.change(editor, { target: { value: "Submitted text" } });
  await f.user.click(screen.getByRole("button", { name: "保存", exact: true }));
  fireEvent.change(editor, { target: { value: "Temporary change" } });
  fireEvent.change(editor, { target: { value: "Submitted text" } });
  await act(async () => { f.release(); });
  await waitFor(() => expect(screen.getByRole("button", { name: "保存", exact: true })).toBeEnabled());
  expect(editor).toHaveValue("Submitted text");
  expect(editor).toBeInTheDocument();
  await f.user.click(screen.getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "笔记正文" })).not.toBeInTheDocument());
  expect(f.create).toHaveBeenCalledOnce();
  expect(f.edit).toHaveBeenCalledOnce();
  expect((await f.repository.search()).objects).toHaveLength(1);
});
