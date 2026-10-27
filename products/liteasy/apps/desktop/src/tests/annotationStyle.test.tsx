import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { collectAnnotationStyleSamples, learnAnnotationStyle } from "../app/features/paper-reading/annotationStyle";
import { useAnnotationStyle } from "../app/features/paper-reading/useAnnotationStyle";
import { useLiteratureGuide } from "../app/features/paper-reading/useLiteratureGuide";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { ModelTransportRequest } from "../app/features/models/modelHttpClient";

const mocks = vi.hoisted(() => ({ load: vi.fn(), read: vi.fn(), choose: vi.fn(), write: vi.fn() }));
vi.mock("../app/features/notes/pdfNotesSource", () => ({ loadPdfNotes: mocks.load }));
vi.mock("../app/features/note-files/noteFileService", () => ({ createNoteFileService: () => ({
  readFile: mocks.read, chooseFile: mocks.choose, writeFile: mocks.write,
}) }));
const paper = { id: "manual", title: "Manual notes", sourcePath: "/paper.pdf" };
const snapshot = { mountId: "chosen", path: "annotation-style.md", name: "annotation-style.md", kind: "file", version: "v1", text: "# 我的批注风格\n先描述机制，再提出一个边界问题。" };
const binding = { mountId: snapshot.mountId, path: snapshot.path, enabled: true };
const settings = () => createSettingsStore().getState();
const input = { scopeId: "user-a", sessionGeneration: "session-a", getPapers: () => [paper], getSettings: settings };
const note = (text: string, patch = {}) => ({ updatedAt: "2026-10-27", annotation: { note: text, excerpt: "source quote", ...patch } });
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); mocks.read.mockResolvedValue(snapshot); });
afterEach(() => { cleanup(); localStorage.clear(); });

test("learns only manual bodies, excluding AI output, reviews, duplicate notes and organization papers", async () => {
  mocks.load.mockResolvedValue([
    note("先核对机制", { review: { text: "AI review should never be learned" } }),
    note("边界是什么？"), note("先核对机制"), note("", { kind: "text", text: "对照实验还缺哪一组？" }),
    note("generated guide", { aiGuide: {} }), note("generated lookup", { lookupKind: "dictionary" }),
    note("generated quick ask", { quickAsk: {} }), note("conflict", { conflictOf: "other" }),
  ]);
  const result = await collectAnnotationStyleSamples([{ ...paper, id: "org", sourcePath: "org://team/shared-library/paper" }, paper], () => {});
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(result.samples.map(sample => sample.note)).toEqual(["先核对机制", "边界是什么？", "对照实验还缺哪一组？"]);
  const transport = vi.fn(async (_request: ModelTransportRequest) => ({ ok: true, status: 200, json: async () => ({ answer: snapshot.text, execution: { mode: "live", provider: "openai" } }) }));
  const learned = await learnAnnotationStyle({ samples: result.samples, settings: settings(), transport, signal: new AbortController().signal });
  expect(learned).toBe(snapshot.text);
  const request = JSON.parse(transport.mock.calls[0][0].body);
  expect(request.requireLive).toBe(true);
  expect(request.prompt).toContain("边界是什么？");
  expect(request.prompt).not.toContain("AI review should never be learned");
});

test("saves a chosen Markdown file with version checks and rereads its persisted content for generation", async () => {
  mocks.choose.mockResolvedValue({ ...snapshot, version: null, text: "" });
  mocks.write.mockImplementation(async value => ({ ...snapshot, ...value, version: "v2" }));
  const { result, unmount } = renderHook(() => useAnnotationStyle(input));
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => result.current.setDraft(snapshot.text));
  await act(async () => result.current.save());
  expect(mocks.choose).toHaveBeenCalledWith({ mode: "save", extension: "md", suggestedName: "annotation-style.md" });
  expect(mocks.write).toHaveBeenCalledWith({ mountId: "chosen", path: snapshot.path, expectedVersion: null, text: snapshot.text + "\n" });
  expect(result.current.enabled).toBe(true);
  unmount();
  const reopened = renderHook(() => useAnnotationStyle(input));
  await waitFor(() => expect(reopened.result.current.draft).toBe(snapshot.text));
  mocks.read.mockResolvedValue({ ...snapshot, text: "# 新风格\n用一句话指出限制。", version: "external-edit" });
  await expect(reopened.result.current.readForGeneration()).resolves.toContain("用一句话指出限制");
  act(() => reopened.result.current.setEnabled(false));
  mocks.read.mockClear();
  await expect(reopened.result.current.readForGeneration()).resolves.toBe("");
  expect(mocks.read).not.toHaveBeenCalled();
});

test("missing enabled style fails visibly and account changes reject an old reader callback", async () => {
  localStorage.setItem("liteasy.annotation-style.v1:user-a", JSON.stringify(binding));
  const { result, rerender } = renderHook(props => useAnnotationStyle(props), { initialProps: input });
  await waitFor(() => expect(result.current.busy).toBe(false));
  mocks.read.mockRejectedValue(new Error("文件已删除"));
  await expect(result.current.readForGeneration()).rejects.toThrow("无法读取已启用的风格文件");
  const oldRead = result.current.readForGeneration;
  rerender({ ...input, scopeId: "user-b", sessionGeneration: "session-b" });
  await expect(oldRead()).rejects.toThrow("账号已切换");
  await waitFor(() => expect(result.current.enabled).toBe(false));
});

test("all page batches share one saved style snapshot and failed style loading sends no model request", async () => {
  const readStyle = vi.fn().mockResolvedValue(snapshot.text);
  const generate = vi.fn().mockResolvedValue({ level: "balanced", items: [], rejected: 0 });
  const guideInput = { scope: "paper", title: "Paper", pageCount: 4, ready: true, count: 0,
    readAnnotationStyle: readStyle, generate, readPage: async () => "unique page text", save: vi.fn(async () => 0), clear: vi.fn(async () => {}) };
  const { result } = renderHook(() => useLiteratureGuide(guideInput));
  act(() => result.current.start("只讨论限制"));
  await waitFor(() => expect(result.current.message).toContain("4/4 页"));
  expect(generate).toHaveBeenCalledTimes(2);
  expect(readStyle).toHaveBeenCalledOnce();
  for (const [request] of generate.mock.calls) expect(request).toMatchObject({ annotationStyle: snapshot.text, systemPrompt: "只讨论限制" });
  generate.mockClear(); readStyle.mockRejectedValue(new Error("风格文件不可读"));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.error).toBe("风格文件不可读"));
  expect(generate).not.toHaveBeenCalled();
});
