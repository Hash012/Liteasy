import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { createDesktopAgentService } from "../app/controllers/agent/createDesktopAgentService";
import { AssistantPane } from "../app/features/assistant/AssistantPane";
import type { FrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { ContextSnapshot } from "../app/features/context/objectContext";
import { paperAnchorFromEvidence } from "../app/features/paper-anchors/paperAnchorEntity";

test("object answers preserve exact paper entities through public events and the conversation surface", async () => {
  const anchor = paperAnchorFromEvidence({ id: "evidence-notes-original", paperId: "source-paper", paperTitle: "Original paper", page: 3,
    pageTextStart: 10, pageTextEnd: 28, quote: "Original evidence.", textExtraction: "embedded" });
  const unlocated = paperAnchorFromEvidence({ id: "evidence-notes-unlocated", paperId: "other-paper", paperTitle: "Unlocated paper",
    quote: "A source without a recorded page." });
  const snapshot: ContextSnapshot = { snapshotId: "snapshot-notes", scopeId: "account-a", purpose: "answer", createdAt: "2026-09-15T00:00:00Z", tokens: 40,
    entries: [{ ref: { objectId: "saved-note", revision: "original-note-revision" }, title: "Saved note", text: "A source-grounded note.",
      paperAnchors: [anchor, unlocated], sha256: "text-hash", tokens: 40, origin: "explicit", trustLabel: "derived", extractor: "liteasy.text/v1" }] };
  const settingsStore = createSettingsStore();
  const api = createDesktopAgentService({
    resolveObjectContext: async () => snapshot,
    getEnvironment: () => ({ knowledge: { importedChunksByPaperId: {}, selectedPapers: [], settings: settingsStore.getState(),
      modelTransport: async () => ({ ok: true, status: 200, json: async () => ({ answer: `A grounded answer [${anchor.id}].`,
        execution: { backend: "test_cloud", mode: "live", provider: "openai" } }) }) }, runtime: {} as never }),
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) throw new Error(session.error.message);
  const result = await api.submitTurn({ sessionId: session.data.sessionId, idempotencyKey: "object-source-answer",
    input: { message: "Explain the note", mode: "qa" }, contextRefs: [snapshot.entries[0]!.ref], contextPurpose: "answer" });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.data.status).toBe("completed");
  const answer = result.data.events.find((event) => event.type === "assistant.message");
  expect(answer).toMatchObject({ citations: [{ paperAnchor: anchor, paperId: "source-paper", page: 3, snippet: "Original evidence." }],
    metadata: { paperAnchors: [anchor, unlocated], resourceSnapshot: { snapshotId: snapshot.snapshotId, scopeId: snapshot.scopeId } } });
  if (answer?.type !== "assistant.message") throw new Error("Missing answer");
  expect(JSON.stringify(answer.metadata)).not.toContain("A source-grounded note.");

  const client: FrontendAgentClient = { cancel: vi.fn(), close: vi.fn(), connect: vi.fn(), confirm: vi.fn(),
    getSession: () => ({ sessionId: session.data.sessionId, status: "active" }), send: vi.fn(async () => result), subscribe: vi.fn(() => vi.fn()) };
  const onOpenCitation = vi.fn();
  render(<AssistantPane agentClient={client} onGenerateArtifact={() => "unused"} onOpenCitation={onOpenCitation} settingsStore={settingsStore}
    selectedSetStatus={{ importedCount: 0, selectedCount: 0, selectionLocked: false }} />);
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "Explain the note");
  await user.click(screen.getByRole("button", { name: "发送" }));
  expect(await screen.findByText("A grounded answer 〔Original paper · 第 3 页〕.")).toBeInTheDocument();
  expect(screen.getByText(unlocated.snapshot.quote)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "打开原文证据 2：Unlocated paper 页码未记录" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "打开原文证据 1：Original paper 第 3 页" }));
  await waitFor(() => expect(onOpenCitation).toHaveBeenCalledWith(expect.objectContaining({ paperAnchor: anchor })));
});
