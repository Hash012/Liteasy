import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useObjectWorkbenchController } from "../app/controllers/useObjectWorkbenchController";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { ObjectWorkbenchContext } from "../app/features/objects/objectWorkbenchPort";
import { ObjectSurface } from "../app/features/object-surface/ObjectSurface";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { refOf, type ObjectRef } from "../app/features/objects/object.types";
import { contextSnapshotPrompt, resolveContextSnapshot } from "../app/features/context/objectContext";
import { paperAnchorFromEvidence } from "../app/features/paper-anchors/paperAnchorEntity";
import { artifactAnnotationNotes } from "../app/features/notes/artifactNotesSource";
import type { AgentArtifactResult } from "../app/features/artifacts/artifact.types";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
const anchor = paperAnchorFromEvidence({
  id: "evidence-stable-original", paperId: "paper-a", paperTitle: "Original paper", page: 4,
  quote: "The original source passage.", pageTextStart: 10, pageTextEnd: 38, textExtraction: "embedded",
});

test("captured replies retain their paper entities through storage, copying, rich display and context submission", async () => {
  const scopeId = crypto.randomUUID();
  const openEvidence = vi.fn();
  const hook = renderHook(() => useObjectWorkbenchController({
    scopeId, getApi: () => { throw new Error("No model invocation expected"); },
    getPapers: () => [{ id: "paper-a", title: "Renamed paper" }],
    getSettings: () => createSettingsStore().getState(), openEvidence,
  }));
  let ref!: ObjectRef;
  await act(async () => {
    [ref] = await hook.result.current.port.captureMessage({
      messageId: "message-a", text: `Claim [${anchor.id}].`, excerpt: `Claim [${anchor.id}].`,
      partial: false, paperAnchors: [anchor],
    }, "board");
  });
  const reloaded = createObjectRepository(createObjectStorage(scopeId, () => scopeId), scopeId);
  const object = await reloaded.get(ref);
  expect(object.paperAnchors).toEqual([anchor]);
  expect((await reloaded.get(object.provenance.sourceRefs[0])).paperAnchors).toEqual([anchor]);
  const copy = await reloaded.copy(ref);
  expect(copy.paperAnchors).toEqual([anchor]);
  const snapshot = await resolveContextSnapshot({ repository: reloaded, refs: [refOf(copy)], purpose: "Create slides" });
  expect(snapshot.entries[0].paperAnchors).toEqual([anchor]);
  expect(contextSnapshotPrompt(snapshot, "Create slides")).toContain('"evidenceIds":["evidence-stable-original"]');
  expect(contextSnapshotPrompt(snapshot, "Create slides")).toContain('"title":"Original paper","page":4');
  expect(contextSnapshotPrompt(snapshot, "Create slides")).not.toContain('"schema":"liteasy.paper-anchor/v1"');
  render(<ObjectWorkbenchContext.Provider value={hook.result.current.port}>
    <ObjectSurface object={copy} onAdd={vi.fn()} onSource={vi.fn()} onDetails={vi.fn()} onError={vi.fn()} />
  </ObjectWorkbenchContext.Provider>);
  expect(screen.getByText("Claim 〔Original paper · 第 4 页〕.")).toBeInTheDocument();
  expect(screen.getByText(anchor.snapshot.quote)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "打开原文证据 1：Original paper 第 4 页" }));
  await waitFor(() => expect(openEvidence).toHaveBeenCalledWith({
    evidenceId: anchor.id, paperId: "paper-a", page: 4, quote: anchor.snapshot.quote,
    pageTextStart: 10, pageTextEnd: 38, textExtraction: "embedded",
  }));
  hook.unmount();
});

test("artifact annotations project the original entity into Notes without changing artifact identity or content", () => {
  const artifact = {
    artifactId: "artifact-a", title: "Reading", papers: [{ id: "paper-a", title: "Renamed paper" }],
    thinReadingDocument: {
      nodes: { page: { title: "Page", evidence: { paperEvidenceSpans: [{
        id: anchor.id, paperId: "paper-a", page: 4, quote: anchor.snapshot.quote, confidence: 1,
        pageTextStart: 10, pageTextEnd: 38, textExtraction: "embedded", paperAnchor: anchor,
      }] } } },
      annotations: [{ id: "annotation-a", nodeId: "page", body: `Discuss [${anchor.id}].`, updatedAt: "2026-09-15T00:00:00Z" }],
    },
  } as unknown as AgentArtifactResult;
  const original = JSON.stringify(artifact);
  const [item] = artifactAnnotationNotes([artifact]);
  expect(item.paperAnchors).toEqual([anchor]);
  expect(item.title).toBe("Discuss 〔Original paper · 第 4 页〕.");
  expect(item.target).toEqual({ kind: "artifact-annotation", artifactId: "artifact-a", annotationId: "annotation-a" });
  expect(JSON.stringify(artifact)).toBe(original);
});

test("anchor metadata changes create a new object revision without rewriting a fixed reference", async () => {
  const scopeId = crypto.randomUUID();
  const repository = createObjectRepository(createObjectStorage(scopeId, () => scopeId), scopeId);
  const draft = { title: "Saved page", kind: "artifact.document" as const, content: {
    schema: "liteasy.document/v1" as const, payload: { blocks: [{ blockId: "page", type: "markdown" as const, text: "Claim", sourceRefs: [] }] },
  } };
  const before = await repository.projectLegacy("artifact-page-a", draft);
  const after = await repository.projectLegacy("artifact-page-a", { ...draft, paperAnchors: [anchor] });
  expect(after.objectId).toBe(before.objectId);
  expect(after.revision).not.toBe(before.revision);
  expect((await repository.get(refOf(before))).paperAnchors).toBeUndefined();
  expect((await repository.get(refOf(after))).paperAnchors).toEqual([anchor]);
});
