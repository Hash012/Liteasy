import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type PropsWithChildren } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ThinReadingPaperRelationsTransport } from "../app/features/thin-reading/thinReadingPaperRelationsClient";
import { useThinReadingPaperRelations } from "../app/features/thin-reading/useThinReadingPaperRelations";
import { ThinReadingTab } from "../app/features/thin-reading/ThinReadingTab";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";
import type {
  ThinReadingExternalSource,
  ThinReadingNode,
  ThinReadingRecommendationPaperEdge
} from "../app/features/thin-reading/thinReading.types";
import { createThinReadingAnchorGraphFixture } from "./fixtures/thinReadingFixtures";

const existingEdge: ThinReadingRecommendationPaperEdge = {
  directed: true,
  evidenceRecordUrls: ["https://openalex.org/W1"],
  kind: "direct_citation",
  provider: "openalex",
  sourcePaperId: "openalex:W1",
  strength: 1,
  targetPaperId: "openalex:W2"
};

const addedEdge: ThinReadingRecommendationPaperEdge = {
  directed: false,
  evidenceRecordUrls: ["https://openalex.org/W1", "https://openalex.org/W2"],
  kind: "bibliographic_coupling",
  provider: "openalex",
  sourcePaperId: "openalex:W1",
  strength: 0.6,
  targetPaperId: "openalex:W2"
};

function nodeWithEdges(edges: readonly ThinReadingRecommendationPaperEdge[] = [existingEdge]) {
  const document = createThinReadingDocument(createThinReadingAnchorGraphFixture());
  const node = document.nodes[document.rootNodeId];
  return {
    ...node,
    evidence: { ...node.evidence, recommendationPaperEdges: edges }
  };
}

function denseNode() {
  const base = nodeWithEdges([]);
  const externalSources: ThinReadingExternalSource[] = [];
  const anchors = Array.from({ length: 8 }, (_, anchorIndex) => {
    const externalSourceIds = Array.from({ length: 4 }, (_, sourceIndex) => {
      const paperIndex = anchorIndex * 4 + sourceIndex + 1;
      const graphId = `W${String(paperIndex).padStart(3, "0")}`;
      const id = paperIndex === 32 ? "crossref-duplicate" : `source-${graphId}`;
      externalSources.push({
        abstract: "Abstract",
        authors: ["Author"],
        ...(paperIndex === 32
          ? { doi: "10.1000/shared-five", provider: "crossref" as const, sourceId: "10.1000/shared-five" }
          : {
              canonicalPaperId: `openalex:${graphId}`,
              ...(paperIndex === 5 ? { doi: "10.1000/shared-five" } : {}),
              provider: "openalex" as const,
              sourceId: graphId
            }),
        id,
        relation: "topic_search",
        relevance: 0.8,
        retrievalQuery: "query",
        sourceRecordUrl: paperIndex === 32
          ? "https://api.crossref.org/works/10.1000%2Fshared-five"
          : `https://openalex.org/${graphId}`,
        title: id,
        url: paperIndex === 32
          ? "https://doi.org/10.1000/shared-five"
          : `https://openalex.org/${graphId}`
      });
      return id;
    });
    return {
      end: anchorIndex + 1,
      evidenceIds: [],
      externalSourceIds,
      id: `anchor-${anchorIndex + 1}`,
      importance: 0.8,
      kind: "concept" as const,
      label: `Anchor ${anchorIndex + 1}`,
      searchQuery: "query",
      start: anchorIndex,
      summarySentenceId: "summary-1",
      text: `Anchor ${anchorIndex + 1}`
    };
  });
  return {
    ...base,
    evidence: { ...base.evidence, anchors, externalSources, recommendationPaperEdges: [] }
  };
}

function transport(payload: unknown): ThinReadingPaperRelationsTransport {
  return vi.fn(async () => ({ json: async () => payload, ok: true, status: 200 }));
}

type RelationTransportRequest = Parameters<ThinReadingPaperRelationsTransport>[0];
type RelationTransportResponse = Awaited<ReturnType<ThinReadingPaperRelationsTransport>>;

function successfulResponse(payload: unknown): RelationTransportResponse {
  return { json: async () => payload, ok: true, status: 200 };
}

function deferredTransport() {
  const requests: Array<{
    reject: (reason: unknown) => void;
    request: RelationTransportRequest;
    resolve: (response: RelationTransportResponse) => void;
  }> = [];
  const relationTransport: ThinReadingPaperRelationsTransport = vi.fn((request) => (
    new Promise((resolve, reject) => requests.push({ reject, request, resolve }))
  ));
  return { relationTransport, requests };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useThinReadingPaperRelations", () => {
  test("requests exactly the 24 alias-merged paper components visible in the graph", async () => {
    let requestedPaperIds: string[] = [];
    const relationTransport: ThinReadingPaperRelationsTransport = vi.fn(async (request) => {
      const body = JSON.parse(request.body) as { papers: Array<{ id: string }> };
      requestedPaperIds = body.papers.map((paper) => paper.id);
      return successfulResponse({ edges: [], warnings: [] });
    });

    renderHook(() => useThinReadingPaperRelations({
      artifactId: "artifact-dense",
      enabled: true,
      endpoint: "https://api.example",
      node: denseNode(),
      onPersist: vi.fn(),
      transport: relationTransport
    }));

    await waitFor(() => expect(relationTransport).toHaveBeenCalledTimes(1));
    expect(requestedPaperIds).toEqual(
      Array.from({ length: 24 }, (_, index) => `openalex:W${String(index + 1).padStart(3, "0")}`)
    );
  });

  test("completes one request for a stable key under React StrictMode", async () => {
    const relationTransport = transport({ edges: [addedEdge], warnings: [] });
    const onPersist = vi.fn();
    const wrapper = ({ children }: PropsWithChildren) => createElement(StrictMode, null, children);

    renderHook(() => useThinReadingPaperRelations({
      artifactId: "artifact-1",
      enabled: true,
      endpoint: "https://api.example",
      node: nodeWithEdges(),
      onPersist,
      transport: relationTransport
    }), { wrapper });

    await waitFor(() => expect(onPersist).toHaveBeenCalledWith([addedEdge]));
    expect(relationTransport).toHaveBeenCalledTimes(1);
  });

  test("leaving graph aborts an in-flight request and clears loading without persisting", async () => {
    const pending = deferredTransport();
    const onPersist = vi.fn();
    const input = {
      artifactId: "artifact-1",
      enabled: true,
      endpoint: "https://api.example",
      node: nodeWithEdges(),
      onPersist,
      transport: pending.relationTransport
    };
    const { result, rerender } = renderHook(
      (props: typeof input) => useThinReadingPaperRelations(props),
      { initialProps: input }
    );
    await waitFor(() => expect(pending.requests).toHaveLength(1));
    expect(result.current.loading).toBe(true);

    rerender({ ...input, enabled: false });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(pending.requests[0].request.signal?.aborted).toBe(true);

    await act(async () => {
      pending.requests[0].resolve(successfulResponse({ edges: [addedEdge], warnings: [] }));
      await Promise.resolve();
    });
    expect(result.current.edges).toEqual([existingEdge]);
    expect(onPersist).not.toHaveBeenCalled();
  });

  test("changing endpoint aborts the old request and starts one request against the new endpoint", async () => {
    const pending = deferredTransport();
    const onPersist = vi.fn();
    const input = {
      artifactId: "artifact-1",
      enabled: true,
      endpoint: "https://old.example",
      node: nodeWithEdges(),
      onPersist,
      transport: pending.relationTransport
    };
    const { rerender } = renderHook(
      (props: typeof input) => useThinReadingPaperRelations(props),
      { initialProps: input }
    );
    await waitFor(() => expect(pending.requests).toHaveLength(1));

    rerender({ ...input, endpoint: "https://new.example" });
    await waitFor(() => expect(pending.requests).toHaveLength(2));
    expect(pending.requests[0].request.signal?.aborted).toBe(true);
    expect(pending.requests[1].request.url).toBe("https://new.example/v1/research/paper-relations");

    await act(async () => {
      pending.requests[1].resolve(successfulResponse({ edges: [addedEdge], warnings: [] }));
      await Promise.resolve();
    });
    await waitFor(() => expect(onPersist).toHaveBeenCalledWith([addedEdge]));
    expect(pending.relationTransport).toHaveBeenCalledTimes(2);
  });

  test("retries a transient failure only after leaving and re-entering graph", async () => {
    const pending = deferredTransport();
    const onPersist = vi.fn();
    const input = {
      artifactId: "artifact-1",
      enabled: true,
      endpoint: "https://api.example",
      node: nodeWithEdges(),
      onPersist,
      transport: pending.relationTransport
    };
    const { result, rerender } = renderHook(
      (props: typeof input) => useThinReadingPaperRelations(props),
      { initialProps: input }
    );
    await waitFor(() => expect(pending.requests).toHaveLength(1));

    await act(async () => {
      pending.requests[0].reject(new Error("provider offline"));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.edges).toEqual([existingEdge]);
    expect(result.current.warnings).toEqual(["provider offline"]);
    expect(pending.relationTransport).toHaveBeenCalledTimes(1);
    await act(async () => Promise.resolve());
    expect(pending.relationTransport).toHaveBeenCalledTimes(1);

    rerender({ ...input, enabled: false });
    rerender({ ...input, enabled: true });
    await waitFor(() => expect(pending.requests).toHaveLength(2));
    await act(async () => {
      pending.requests[1].resolve(successfulResponse({ edges: [addedEdge], warnings: [] }));
      await Promise.resolve();
    });
    await waitFor(() => expect(onPersist).toHaveBeenCalledWith([addedEdge]));
    expect(pending.relationTransport).toHaveBeenCalledTimes(2);
  });

  test("ThinReadingTab loads relations only when related recommendations reach graph stage", async () => {
    const document = createThinReadingDocument(createThinReadingAnchorGraphFixture());
    const onUpdateDocument = vi.fn();
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ edges: [addedEdge], warnings: [] }),
      ok: true,
      status: 200
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(ThinReadingTab, {
      artifactId: document.artifactId,
      document,
      onUpdateDocument,
      paperRelationsEndpoint: "https://api.example",
      papers: []
    }));

    fireEvent.click(screen.getByRole("button", { name: "相关推荐" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "相关推荐" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onUpdateDocument).toHaveBeenCalledWith(
      document.artifactId,
      expect.objectContaining({
        nodes: expect.objectContaining({
          [document.rootNodeId]: expect.objectContaining({
            evidence: expect.objectContaining({ recommendationPaperEdges: [addedEdge] })
          })
        })
      })
    ));
  });

  test("keeps persisted edges immediately and fetches once only after graph enablement", async () => {
    const relationTransport = transport({ edges: [addedEdge], warnings: [] });
    const onPersist = vi.fn();
    const input = {
      artifactId: "artifact-1",
      enabled: false,
      endpoint: "https://api.example",
      node: nodeWithEdges(),
      onPersist,
      transport: relationTransport
    };
    const { result, rerender } = renderHook(
      (props: typeof input) => useThinReadingPaperRelations(props),
      { initialProps: input }
    );

    expect(result.current.edges).toEqual([existingEdge]);
    expect(result.current.loading).toBe(false);
    expect(relationTransport).not.toHaveBeenCalled();

    rerender({ ...input, enabled: true });
    await waitFor(() => expect(onPersist).toHaveBeenCalledWith([addedEdge]));
    expect(relationTransport).toHaveBeenCalledTimes(1);
    expect(result.current.edges).toEqual([addedEdge]);

    rerender({ ...input, enabled: true, node: nodeWithEdges([addedEdge]) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(relationTransport).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenCalledTimes(1);
  });

  test("merges verified partial results with persisted edges and exposes a nonblocking warning", async () => {
    const onPersist = vi.fn();
    const { result } = renderHook(() => useThinReadingPaperRelations({
      artifactId: "artifact-1",
      enabled: true,
      endpoint: "https://api.example",
      node: nodeWithEdges(),
      onPersist,
      transport: transport({ edges: [addedEdge], warnings: ["paper_relation_provider_unavailable"] })
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.edges).toEqual([addedEdge, existingEdge]);
    expect(result.current.warnings).toEqual(["paper_relation_provider_unavailable"]);
    expect(onPersist).toHaveBeenCalledWith([addedEdge, existingEdge]);
  });

  test("preserves persisted edges and reports a warning when loading fails", async () => {
    const onPersist = vi.fn();
    const { result } = renderHook(() => useThinReadingPaperRelations({
      artifactId: "artifact-1",
      enabled: true,
      endpoint: "https://api.example",
      node: nodeWithEdges(),
      onPersist,
      transport: vi.fn(async () => {
        throw new Error("provider offline");
      })
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.edges).toEqual([existingEdge]);
    expect(result.current.warnings).toEqual(["provider offline"]);
    expect(onPersist).not.toHaveBeenCalled();
  });

  test("aborts the previous request when the stable artifact-node-paper key changes", async () => {
    const signals: AbortSignal[] = [];
    const relationTransport: ThinReadingPaperRelationsTransport = vi.fn((request) => {
      if (request.signal) signals.push(request.signal);
      return new Promise(() => undefined);
    });
    const originalNode = nodeWithEdges();
    const input = {
      artifactId: "artifact-1",
      enabled: true,
      endpoint: "https://api.example",
      node: originalNode,
      onPersist: vi.fn(),
      transport: relationTransport
    };
    const { rerender, unmount } = renderHook(
      (props: typeof input) => useThinReadingPaperRelations(props),
      { initialProps: input }
    );
    await waitFor(() => expect(relationTransport).toHaveBeenCalledTimes(1));

    const nextNode: ThinReadingNode = { ...originalNode, id: "next-node" };
    rerender({ ...input, node: nextNode });
    await waitFor(() => expect(relationTransport).toHaveBeenCalledTimes(2));
    expect(signals[0].aborted).toBe(true);

    unmount();
    expect(signals[1].aborted).toBe(true);
  });
});
