import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useThinReadingVisualizationController } from "../app/controllers/useThinReadingVisualizationController";
import {
  availableCapability,
  cancelGeneration,
  documentWithNode,
  generateVisualization,
  nodeWithIntent,
  readyArtifact,
  resetVisualizationControllerSpies,
  saveThinReadingDocument
} from "./fixtures/visualizationControllerFixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function renderController(overrides: Record<string, unknown> = {}) {
  let currentDocument = documentWithNode();
  const onDocumentUpdated = vi.fn((document) => {
    currentDocument = document;
  });
  const hook = renderHook(() => useThinReadingVisualizationController({
    cancelGeneration,
    generateVisualization,
    getCapability: () => availableCapability,
    getThinReadingDocument: () => currentDocument,
    initialReadyArtifacts: [readyArtifact],
    onDocumentUpdated,
    saveThinReadingDocument,
    ...overrides
  }));
  return { ...hook, getDocument: () => currentDocument, onDocumentUpdated };
}

beforeEach(() => {
  resetVisualizationControllerSpies();
});

test("persists prose before starting an eligible visualization request", async () => {
  const { result } = renderController();

  await act(async () => {
    await result.current.commitGeneratedNode({
      artifactId: "thin-1",
      document: documentWithNode(),
      node: nodeWithIntent
    });
  });

  expect(saveThinReadingDocument).toHaveBeenCalledBefore(generateVisualization);
});

test("cancels a request while its visualization result is waiting to persist", async () => {
  const save = deferred<void>();
  const persist = vi.fn(() => save.promise);
  const { result } = renderController({
    saveThinReadingDocument: persist
  });
  generateVisualization.mockResolvedValueOnce([readyArtifact]);

  act(() => {
    void result.current.startVisualization({
      artifactId: "thin-1",
      document: documentWithNode(),
      node: nodeWithIntent
    });
  });
  await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
  await act(async () => {
    await result.current.cancelVisualization(nodeWithIntent.id, "preference_disabled");
    save.resolve();
    await Promise.resolve();
  });

  expect(cancelGeneration).toHaveBeenCalledWith(expect.objectContaining({
    reason: "preference_disabled"
  }));
  expect(result.current.statuses[nodeWithIntent.id]).toEqual({
    reasonCode: "preference_disabled",
    status: "omitted"
  });
});

test("reports generation failure when visualization persistence fails", async () => {
  const { result } = renderController({
    saveThinReadingDocument: vi.fn(async () => {
      throw new Error("persistence unavailable");
    })
  });

  let outcome;
  await act(async () => {
    outcome = await result.current.startVisualization({
      artifactId: "thin-1",
      document: documentWithNode(),
      node: nodeWithIntent
    });
  });

  expect(outcome).toEqual({ reasonCode: "generation_failed", status: "omitted" });
  expect(result.current.statuses[nodeWithIntent.id]).toEqual(outcome);
});

test.each([
  ["missing capability", undefined],
  ["disabled preference", { ...availableCapability, enabled: false }],
  ["unavailable service", { ...availableCapability, serviceAvailable: false }],
  ["empty quota", { ...availableCapability, quota: { available: false } }],
  ["unsupported modality", { ...availableCapability, availableModalities: [] }]
])("fails closed for %s", async (_label, capability) => {
  const { result } = renderController({ getCapability: () => capability });

  let outcome;
  await act(async () => {
    outcome = await result.current.startVisualization({
      artifactId: "thin-1",
      document: documentWithNode(),
      node: nodeWithIntent
    });
  });

  expect(outcome).toEqual(expect.objectContaining({ status: "omitted" }));
  expect(generateVisualization).not.toHaveBeenCalled();
});

test("turning off cancels uncommitted requests and keeps ready artifacts", async () => {
  const pending = deferred<readonly [typeof readyArtifact]>();
  generateVisualization.mockReturnValueOnce(pending.promise);
  const { result } = renderController();

  act(() => {
    void result.current.startVisualization({
      artifactId: "thin-1",
      document: documentWithNode(),
      node: nodeWithIntent
    });
  });
  await act(async () => {
    await Promise.resolve();
    await result.current.setEnabled(false);
  });

  expect(cancelGeneration).toHaveBeenCalledWith(expect.objectContaining({
    nodeId: nodeWithIntent.id,
    reason: "preference_disabled"
  }));
  expect(result.current.readyArtifacts).toEqual([readyArtifact]);
});

test("persists a disabled preference even when remote cancellation fails", async () => {
  const pending = deferred<readonly [typeof readyArtifact]>();
  generateVisualization.mockReturnValueOnce(pending.promise);
  cancelGeneration.mockRejectedValueOnce(new Error("cancel route unavailable"));
  const setVisualizationPreference = vi.fn(async () => ({
    ...availableCapability,
    enabled: false
  }));
  const { result } = renderController({ setVisualizationPreference });

  act(() => {
    void result.current.startVisualization({
      artifactId: "thin-1",
      document: documentWithNode(),
      node: nodeWithIntent
    });
  });
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await result.current.setEnabled(false);
  });
  expect(setVisualizationPreference).toHaveBeenCalledWith(false);
});

test("propagates one AbortController signal to generation and cancellation", async () => {
  const pending = deferred<readonly [typeof readyArtifact]>();
  generateVisualization.mockReturnValueOnce(pending.promise);
  const { result } = renderController();

  act(() => {
    void result.current.startVisualization({
      artifactId: "thin-1",
      document: documentWithNode(),
      node: nodeWithIntent
    });
  });
  await act(async () => {
    await Promise.resolve();
  });
  const signal = generateVisualization.mock.calls[0]?.[0].signal;
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal.aborted).toBe(false);

  await act(async () => {
    await result.current.cancelVisualization(nodeWithIntent.id, "user_cancelled");
  });

  expect(signal.aborted).toBe(true);
});

test("does not trust a cached preference capability for a late result", async () => {
  const pending = deferred<readonly [typeof readyArtifact]>();
  generateVisualization.mockReturnValueOnce(pending.promise);
  let capability: unknown = availableCapability;
  const { result, onDocumentUpdated } = renderController({
    getCapability: () => capability,
    setVisualizationPreference: vi.fn(async () => availableCapability)
  });

  await act(async () => {
    await result.current.setEnabled(true);
  });

  act(() => {
    void result.current.startVisualization({
      artifactId: "thin-1",
      document: documentWithNode(),
      node: nodeWithIntent
    });
  });
  await act(async () => {
    await Promise.resolve();
  });
  capability = { ...availableCapability, serviceAvailable: false };
  await act(async () => {
    pending.resolve([readyArtifact]);
    await Promise.resolve();
  });

  expect(onDocumentUpdated).not.toHaveBeenCalled();
  expect(result.current.statuses[nodeWithIntent.id]).toEqual({
    reasonCode: "stale_request",
    status: "omitted"
  });
});

test("ignores a late result after cancellation", async () => {
  const pending = deferred<readonly [typeof readyArtifact]>();
  generateVisualization.mockReturnValueOnce(pending.promise);
  const { result, onDocumentUpdated } = renderController();

  let generation!: Promise<unknown>;
  act(() => {
    generation = result.current.startVisualization({
      artifactId: "thin-1",
      document: documentWithNode(),
      node: nodeWithIntent
    });
  });
  await act(async () => {
    await Promise.resolve();
    await result.current.cancelVisualization(nodeWithIntent.id, "user_cancelled");
    pending.resolve([readyArtifact]);
    await generation;
  });

  expect(onDocumentUpdated).not.toHaveBeenCalled();
  expect(saveThinReadingDocument).not.toHaveBeenCalled();
});

test("aborts and cancels active work without persisting after the controller unmounts", async () => {
  const pending = deferred<readonly [typeof readyArtifact]>();
  generateVisualization.mockReturnValueOnce(pending.promise);
  const { result, unmount } = renderController();

  act(() => {
    void result.current.startVisualization({
      artifactId: "thin-1",
      document: documentWithNode(),
      node: nodeWithIntent
    });
  });
  await act(async () => {
    await Promise.resolve();
  });
  unmount();
  pending.resolve([readyArtifact]);
  await Promise.resolve();

  expect(cancelGeneration).toHaveBeenCalledWith(expect.objectContaining({
    reason: "workflow_disposed"
  }));
  expect(saveThinReadingDocument).not.toHaveBeenCalled();
});

test("does not wait for a hanging remote cancellation before persisting preference", async () => {
  generateVisualization.mockReturnValueOnce(new Promise<readonly unknown[]>(() => undefined));
  cancelGeneration.mockImplementationOnce(() => new Promise<void>(() => undefined));
  const setVisualizationPreference = vi.fn(async () => ({
    ...availableCapability,
    enabled: false
  }));
  const { result } = renderController({ setVisualizationPreference });
  act(() => {
    void result.current.startVisualization({
      artifactId: "thin-1",
      document: documentWithNode(),
      node: nodeWithIntent
    });
  });
  await act(async () => {
    await Promise.resolve();
  });

  let outcome: "disabled" | "timeout" | undefined;
  await act(async () => {
    outcome = await Promise.race([
      result.current.setEnabled(false).then(() => "disabled" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 30))
    ]);
  });
  expect(outcome).toBe("disabled");
  expect(setVisualizationPreference).toHaveBeenCalledWith(false);
});

test("ignores a result when the node intent changed while generation was in flight", async () => {
  const pending = deferred<readonly [typeof readyArtifact]>();
  generateVisualization.mockReturnValueOnce(pending.promise);
  let currentDocument = documentWithNode();
  const onDocumentUpdated = vi.fn();
  const { result } = renderHook(() => useThinReadingVisualizationController({
    cancelGeneration,
    generateVisualization,
    getCapability: () => availableCapability,
    getThinReadingDocument: () => currentDocument,
    onDocumentUpdated,
    saveThinReadingDocument
  }));

  let generation!: Promise<unknown>;
  act(() => {
    generation = result.current.startVisualization({
      artifactId: "thin-1",
      document: currentDocument,
      node: nodeWithIntent
    });
  });
  currentDocument = documentWithNode({
    ...nodeWithIntent,
    visualizationDecision: undefined
  });
  await act(async () => {
    pending.resolve([readyArtifact]);
    await generation;
  });

  expect(onDocumentUpdated).not.toHaveBeenCalled();
  expect(saveThinReadingDocument).not.toHaveBeenCalled();
  expect(result.current.statuses[nodeWithIntent.id]).toEqual({
    reasonCode: "stale_request",
    status: "omitted"
  });
});

test("requests at most two artifacts for an explicit visualization intent", async () => {
  const explicitNode = {
    ...nodeWithIntent,
    visualizationDecision: {
      ...nodeWithIntent.visualizationDecision!,
      intent: {
        ...nodeWithIntent.visualizationDecision!.intent,
        requestedBy: "explicit_user_request" as const
      }
    }
  };
  const { result } = renderController();

  await act(async () => {
    await result.current.startVisualization({
      artifactId: "thin-1",
      document: documentWithNode(explicitNode),
      node: explicitNode
    });
  });

  expect(generateVisualization).toHaveBeenCalledWith(expect.objectContaining({
    requestedArtifactCount: 2
  }));
});

test("hydrates ready artifacts from restored V2 documents", () => {
  const { result } = renderController({ initialReadyArtifacts: [] });
  act(() => {
    result.current.hydrateReadyArtifacts([readyArtifact]);
  });
  expect(result.current.readyArtifacts).toEqual([readyArtifact]);
});

test("serializes concurrent node saves without dropping either visualization", async () => {
  const secondArtifact = { ...readyArtifact, artifactId: "visual-ready-2", nodeId: "node-second" };
  const secondNode = {
    ...nodeWithIntent,
    id: "node-second",
    visualizationDecision: {
      ...nodeWithIntent.visualizationDecision!,
      intent: { ...nodeWithIntent.visualizationDecision!.intent, nodeId: "node-second" }
    }
  };
  let currentDocument = {
    ...documentWithNode(),
    nodes: { ...documentWithNode().nodes, [secondNode.id]: secondNode }
  };
  const updates: typeof currentDocument[] = [];
  const firstSave = deferred<void>();
  let saveCount = 0;
  const save = vi.fn(async (_artifactId: string, document: typeof currentDocument) => {
    saveCount += 1;
    updates.push(document);
    if (saveCount === 1) {
      await firstSave.promise;
    }
    currentDocument = document;
  });
  const { result } = renderHook(() => useThinReadingVisualizationController({
    cancelGeneration,
    generateVisualization: vi.fn(async (request) => (
      request.nodeId === nodeWithIntent.id ? [readyArtifact] : [secondArtifact]
    )),
    getCapability: () => availableCapability,
    getThinReadingDocument: () => currentDocument,
    onDocumentUpdated: (document) => { currentDocument = document; },
    saveThinReadingDocument: save
  }));

  act(() => {
    void result.current.startVisualization({ artifactId: "thin-1", document: currentDocument, node: nodeWithIntent });
    void result.current.startVisualization({ artifactId: "thin-1", document: currentDocument, node: secondNode });
  });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  firstSave.resolve();
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(updates.at(-1)?.nodes[secondNode.id].visualizations).toHaveLength(1));

  expect(updates.at(-1)?.nodes[nodeWithIntent.id].visualizations).toHaveLength(1);
  expect(updates.at(-1)?.nodes[secondNode.id].visualizations).toHaveLength(1);
});
