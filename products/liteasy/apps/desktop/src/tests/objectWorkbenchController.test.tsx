import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useObjectWorkbenchController } from "../app/controllers/useObjectWorkbenchController";
import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import { createSettingsStore } from "../app/features/settings/settings.store";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
test("tray selections remain temporary until submit, then produce a saved artifact with frozen sources", async () => {
  let current: ReturnType<typeof useObjectWorkbenchController>;
  const scopeId = crypto.randomUUID();
  const api = createAgentApplicationService({
    supportsObjectContext: true,
    getPrincipalId: () => scopeId,
    resolveContext: async ({ request }) => ({
      objectSnapshot: await current.resolveContext(request),
    }),
    executeCommand: () => ({ events: [], settingsChanged: false }),
    executeKnowledge: async () => ({ message: "解释内容" }),
  });
  const paper = { id: "paper", title: "Paper", contentHash: "original-hash" };
  const hook = renderHook(() =>
    useObjectWorkbenchController({
      scopeId,
      getApi: () => api,
      getPapers: () => [paper],
      getSettings: () => createSettingsStore().getState(),
      openEvidence: vi.fn(),
    }),
  );
  current = hook.result.current;
  await act(async () => {
    await current.port.capturePdf(
      {
        paper,
        page: 3,
        excerpt: "原文",
        rects: [{ left: 20, top: 30, width: 40, height: 5 }],
      },
      "tray",
    );
  });
  await waitFor(() =>
    expect(
      hook.result.current.objects.some((o) => o.kind === "source.document"),
    ).toBe(true),
  );
  current = hook.result.current;
  expect(
    (await current.repository.search()).objects.filter(
      (o) => o.kind === "content.fragment",
    ),
  ).toHaveLength(0);
  await act(async () => {
    await current.previewContext();
  });
  current = hook.result.current;
  expect(current.preview?.entries[0].text).toBe("原文");
  await act(async () => {
    await current.submit("解释");
  });
  current = hook.result.current;
  expect(current.answer?.text).toBe("解释内容");
  const fragment = (await current.repository.search()).objects.find(
    (o) => o.kind === "content.fragment",
  )!;
  if (fragment.kind !== "content.fragment") throw new Error("fragment");
  expect(fragment.content.payload.anchors[0]).toMatchObject({
    page: 3,
    rects: [{ x: 0.2, y: 0.3, width: 0.4, height: 0.05 }],
  });
  let first: unknown, second: unknown;
  await act(async () => {
    first = await current.saveAnswer();
  });
  current = hook.result.current;
  await act(async () => {
    second = await current.saveAnswer();
  });
  expect(second).toEqual(first);
  expect(
    (await current.repository.search()).objects.filter(
      (o) => o.kind === "artifact.document",
    ),
  ).toHaveLength(1);
  hook.unmount();
});
