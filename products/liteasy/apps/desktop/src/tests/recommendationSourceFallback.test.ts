import { afterEach, expect, test, vi } from "vitest";
import { fetchLocalRecommendations } from "../app/features/recommendations/localRecommendationClient";
import type { RecommendationTask } from "../app/features/recommendations/recommendationCoordinator";

const config = { provider: "openalex" as const, endpoint: "https://api.openalex.org" };
const publicResult = { message: { items: [{ DOI: "10.1234/graph", title: ["Filtered graph retrieval"], abstract: "Graph retrieval combines structured filters with nearest-neighbor search." }] } };
afterEach(() => vi.unstubAllGlobals());

test.each([401, 403, 429, 503])("falls back from HTTP %d without relabelling the public source", async status => {
  const onSourceFailure = vi.fn();
  const sourceKeys: (string | undefined)[] = [];
  const request = async <T,>(_kind: string, run: () => Promise<T>, _units?: number, sourceKey?: string) => { sourceKeys.push(sourceKey); return run(); };
  const task: RecommendationTask = { request, signal: new AbortController().signal, active: async () => true, upstreamUnknown: () => {} };
  const fetch = vi.fn(async (url: URL) => String(url).includes("openalex.org") ? new Response("", { status }) : Response.json(publicResult));
  vi.stubGlobal("fetch", fetch);
  const result = await fetchLocalRecommendations(config, ["graph retrieval"], "balanced", task.signal, { task, onSourceFailure });
  expect(result[0]).toMatchObject({ id: "doi:10.1234/graph", source: "crossref", abstract: expect.stringContaining("structured filters") });
  expect(onSourceFailure).toHaveBeenCalledWith(expect.objectContaining({ provider: "openalex", fallback: "crossref", status }));
  expect(sourceKeys).toEqual(["openalex:https://api.openalex.org", "crossref:https://api.crossref.org"]);
});

test("redacts a failed provider diagnostic and preserves useful results from the fallback", async () => {
  const onSourceFailure = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
    if (String(url).includes("openalex.org")) throw new Error("Network failed https://api.openalex.org/works?api_key=hidden-secret Authorization: Bearer sk-secret");
    return Response.json(publicResult);
  }));
  await fetchLocalRecommendations(config, ["graph retrieval"], "balanced", new AbortController().signal, { onSourceFailure });
  expect(onSourceFailure.mock.calls[0][0].message).not.toMatch(/hidden-secret|sk-secret/);
  expect(onSourceFailure.mock.calls[0][0].message).toContain("Network failed");
});

test("does not turn valid empty searches into more network calls", async () => {
  const fetch = vi.fn(async () => Response.json({ results: [] })); vi.stubGlobal("fetch", fetch);
  expect(await fetchLocalRecommendations(config, ["graph retrieval"], "balanced", new AbortController().signal)).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("reports both failing sources when the public fallback also fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
  await expect(fetchLocalRecommendations(config, ["graph retrieval"], "balanced", new AbortController().signal))
    .rejects.toMatchObject({ message: expect.stringContaining("公开备用来源"), sourceFailures: [expect.objectContaining({ provider: "openalex" }), expect.objectContaining({ provider: "crossref" })] });
});

test("does not fall back after user cancellation", async () => {
  const controller = new AbortController();
  const fetch = vi.fn(async () => { controller.abort(); throw new DOMException("cancelled", "AbortError"); });
  vi.stubGlobal("fetch", fetch);
  await expect(fetchLocalRecommendations(config, ["graph retrieval"], "balanced", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
