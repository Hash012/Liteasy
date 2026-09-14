import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useObjectWorkbenchController } from "../app/controllers/useObjectWorkbenchController";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { makeObjectTransfer, writeObjectTransfer } from "../app/features/object-transfer/objectTransfer";
import { refOf } from "../app/features/objects/object.types";
import { resolveContextSnapshot } from "../app/features/context/objectContext";
import { PAPER_CONTEXT_MIME, readContextPaper } from "../app/features/object-transfer/contextTransfer";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));

function transfer() {
  const data = new Map<string, string>();
  return { getData: (type: string) => data.get(type) ?? "", setData: (type: string, value: string) => data.set(type, value) } as unknown as DataTransfer;
}
test("dropping a capture into chat saves the selected object without opening or placing on a board", async () => {
  const scopeId = crypto.randomUUID();
  const { result, unmount } = renderHook(() => useObjectWorkbenchController({
    scopeId, getApi: () => { throw new Error("No model expected"); },
    getPapers: () => [], getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn(),
  }));
  const data = transfer();
  act(() => result.current.port.dragMessage({ messageId: "m", text: "原回答", excerpt: "原回答", partial: false }, data));
  let refs;
  await act(async () => { refs = await result.current.port.receiveContextDrop!(data); });
  expect(refs).toHaveLength(1);
  expect(result.current.visible).toBe(false);
  expect(result.current.board).toBeUndefined();
  expect(result.current.placements).toHaveLength(0);
  expect(result.current.objects.filter((object) => object.kind === "content.fragment")).toHaveLength(1);
  await act(async () => { await result.current.drop(data); });
  expect(result.current.placements).toHaveLength(1);
  expect(result.current.objects.filter((object) => object.kind === "content.fragment")).toHaveLength(1);
  unmount();
});

test("whole board context fixes its members and versions when dropped", async () => {
  const scopeId = crypto.randomUUID();
  const { result, unmount } = renderHook(() => useObjectWorkbenchController({
    scopeId, getApi: () => { throw new Error("No model expected"); },
    getPapers: () => [], getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn(),
  }));
  await act(async () => { await result.current.createNote("最初的白板内容"); });
  const data = transfer();
  writeObjectTransfer(data, makeObjectTransfer([refOf(result.current.board!)]));
  const attachments = await result.current.port.receiveContextDrop!(data);
  expect(attachments[0].refs).toHaveLength(2);
  await act(async () => { await result.current.createNote("后来加入的内容"); });
  const snapshot = await resolveContextSnapshot({ repository: result.current.repository,
    refs: attachments[0].refs, purpose: "review" });
  expect(snapshot.entries.map((entry) => entry.text).join("\n")).toContain("最初的白板内容");
  expect(snapshot.entries.map((entry) => entry.text).join("\n")).not.toContain("后来加入的内容");
  await expect(result.current.port.receiveContextDrop!(data)).rejects.toThrow("白板已变化");
  unmount();
});

test("paper drag resolves against the current workspace and does not trust a pasted title or path", () => {
  const data = transfer();
  data.setData(PAPER_CONTEXT_MIME, "paper-A");
  expect(readContextPaper(data, [{ id: "paper-A", title: "Current title" }])?.title).toBe("Current title");
  expect(() => readContextPaper(data, [{ id: "paper-B", title: "Other account" }])).toThrow("当前工作区不可用");
});

test("saving a generated page or a PDF excerpt preserves the existing full source representation", async () => {
  const paper = { id: "paper-source", title: "来源论文", contentHash: "same-pdf" };
  const scopeId = crypto.randomUUID();
  const { result, unmount } = renderHook(() => useObjectWorkbenchController({
    scopeId, getApi: () => { throw new Error("No model expected"); }, getPapers: () => [paper],
    getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn(),
  }));
  const source = await result.current.repository.projectLegacy(`paper-${paper.id}`, {
    kind: "source.document", title: paper.title,
    content: { schema: "liteasy.source-document/v1", payload: {
      paperId: paper.id, text: "已保存的完整来源正文", pages: [{ page: 1, text: "已保存的完整来源正文" }],
      abstractText: "摘要", documentHash: "same-pdf", availability: "local", legacyKey: paper.id,
    } },
  });
  const input = { artifactId: "generated-document", pageId: "page-A", title: "薄读页", text: "生成页面正文", paperIds: [paper.id] };
  let ref;
  await act(async () => { ref = await result.current.port.captureArtifactPage!(input); });
  const first = await result.current.repository.get(ref!);
  expect(first.kind).toBe("artifact.document");
  expect(await result.current.repository.resolveLatest(source.objectId)).toEqual(source);
  await act(async () => { await result.current.port.capturePdf({ paper, page: 1, excerpt: "完整来源", rects: [] }, "board"); });
  expect(await result.current.repository.resolveLatest(source.objectId)).toEqual(source);
  await act(async () => { await result.current.port.captureArtifactPage!({ ...input, text: "新页面正文" }); });
  expect(await result.current.repository.get(ref!)).toEqual(first);
  expect((await result.current.repository.resolveLatest(ref!.objectId)).revision).not.toBe(ref!.revision);
  unmount();
});

test("a library thin-reading locator resolves its actual document and deeper pages to immutable context", async () => {
  const { ARTIFACT_CONTEXT_MIME } = await import("../app/features/object-transfer/contextTransfer");
  const { createThinReadingDocument } = await import("../app/features/thin-reading/thinReadingProjection");
  const { createThinReadingFixture } = await import("./fixtures/thinReadingFixtures");
  const thin = structuredClone(createThinReadingDocument(createThinReadingFixture()));
  const root = thin.nodes[thin.rootNodeId];
  thin.nodes["deeper-page"] = { ...root, id: "deeper-page", summary: "下一层实际解释：注意力权重的归一化。", title: "深入注意力", depth: 1 };
  const artifact = {
    agent: { apiVersion: "1", runId: "run-artifact", sessionId: "session", status: "completed" as const },
    artifactId: "saved-thin", artifactType: "thin_reading" as const, answer: "", citations: [],
    createdAt: new Date().toISOString(), papers: createThinReadingFixture().papers,
    thinReadingDocument: thin, title: "文库薄读", version: "liteasy.agent-artifact/v1" as const,
  };
  const scopeId = crypto.randomUUID();
  const { result, unmount } = renderHook(() => useObjectWorkbenchController({
    scopeId, getApi: () => { throw new Error("No model expected"); },
    getPapers: () => [], listLegacyArtifacts: async () => [artifact],
    getSettings: () => createSettingsStore().getState(), openEvidence: vi.fn(),
  }));
  const data = transfer();
  data.setData(ARTIFACT_CONTEXT_MIME, artifact.artifactId);
  const attachments = await result.current.port.receiveContextDrop!(data);
  const snapshot = await resolveContextSnapshot({ repository: result.current.repository,
    refs: attachments[0].refs, purpose: "解释" });
  const body = snapshot.entries.map((entry) => entry.text).join("\n");
  expect(body).toContain(root.summary);
  expect(body).toContain("下一层实际解释");
  expect(body).toContain("Self-attention replaces recurrence");
  expect(result.current.visible).toBe(false);
  thin.nodes["deeper-page"].summary = "多层详细正文".repeat(6000);
  await expect(result.current.port.receiveContextDrop!(data)).rejects.toThrow(/超|预算/);
  data.setData(ARTIFACT_CONTEXT_MIME, "other-account-artifact");
  await expect(result.current.port.receiveContextDrop!(data)).rejects.toThrow("当前账号不可用");
  unmount();
});
