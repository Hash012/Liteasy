import { describe, expect, it, vi, beforeEach } from "vitest";
import { citationPaper, projectCitationGraph } from "../app/features/citation-graph/citationGraph";
import { createCitationGraphClient, parseCitationWork } from "../app/features/citation-graph/citationGraphClient";
import { paperServiceRequest } from "../app/features/paper-services/paperServiceTransport";
vi.mock("../app/features/paper-services/paperServiceTransport", async (original) => ({ ...await original<typeof import("../app/features/paper-services/paperServiceTransport")>(), paperServiceRequest: vi.fn() }));
const request = vi.mocked(paperServiceRequest);
const row = (id: number, refs: number[] = [], count = id) => ({ id: `https://openalex.org/W${id}`, doi: `https://doi.org/10.1234/${id}`, title: `Paper ${id}`, cited_by_count: count, referenced_works: refs.map((id) => `https://openalex.org/W${id}`) });
const work = (id: number, refs: number[] = [], count = id) => parseCitationWork(row(id, refs, count))!;
const response = (rows: unknown[], count = rows.length) => new Response(JSON.stringify({ results: rows, meta: { count } }), { status: 200 });
beforeEach(() => { request.mockReset(); });
describe("citation graph", () => {
  it("draws only real directed citations and merges duplicate local DOI copies", () => {
    const graph = projectCitationGraph([{ id: "a", title: "Memory", doi: "10.1234/1" }, { id: "copy", title: "Copy", doi: "10.1234/1" }, { id: "b", title: "Memory", doi: "10.1234/2" }, { id: "c", title: "Memory" }], [work(1, [2]), work(2)]);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0].localIds).toEqual(["a", "copy"]);
    expect(graph.edges).toEqual([{ id: "W1:W2", source: "W1", target: "W2" }]);
    expect(citationPaper({ id: "filename", title: "das24a" }).doi).toBeUndefined();
  });
  it("does not attach an obsolete OpenAlex identity after a manual DOI correction", () => {
    const graph = projectCitationGraph([{ id: "edited", title: "Corrected", doi: "10.1234/9", openAlexId: "W1" },
      { id: "original", title: "Original", doi: "10.1234/1" }], [work(1, [2]), work(2)]);
    expect(graph.nodes.find((node) => node.localIds.includes("edited"))?.work).toBeUndefined();
    expect(graph.nodes.find((node) => node.id === "W1")?.localIds).toEqual(["original"]);
  });
  it("uses exact IDs, caches within one client and never queries filenames", async () => {
    request.mockResolvedValueOnce(response([row(1), row(99)]));
    const client = createCitationGraphClient();
    const papers = [{ id: "a", title: "secret note title", doi: "10.1234/1" }, { id: "b", title: "Cicada" }];
    const result = await client.loadLibrary(papers, new AbortController().signal);
    expect(result.works.map((item) => item.id)).toEqual(["W1"]);
    expect(result.identified).toBe(1);
    await client.loadLibrary(papers, new AbortController().signal);
    expect(request).toHaveBeenCalledOnce();
    const url = new URL(request.mock.calls[0][1]);
    expect(url.searchParams.get("filter")).toBe("doi:10.1234/1");
    expect(url.href).not.toContain("secret");
    request.mockResolvedValueOnce(response([row(1)]));
    await createCitationGraphClient().loadLibrary(papers, new AbortController().signal);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("ranks across every outgoing-reference batch, not just the first records", async () => {
    request.mockImplementation(async (_, value) => {
      const url = new URL(value); expect(url.searchParams.get("sort")).toBe("cited_by_count:desc");
      const ids = url.searchParams.get("filter")!.replace("openalex:", "").split("|").map((id) => Number(id.slice(1)));
      return response(ids.sort((a, b) => b - a).slice(0, 5).map((id) => row(id)));
    });
    const seed = work(1, Array.from({ length: 130 }, (_, i) => i + 2));
    const result = await createCitationGraphClient().expand(seed, [seed, work(131)], "references", 5, new AbortController().signal);
    expect(result.works.map((item) => item.id)).toEqual(["W130", "W129", "W128", "W127", "W126"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.edges.every((edge) => edge.source === "W1")).toBe(true);
  });
  it("paginates incoming citations past local papers and verifies actual references", async () => {
    const seed = work(1);
    request.mockResolvedValueOnce(response(Array.from({ length: 100 }, (_, i) => row(i + 2, [1], 200 - i)), 102));
    request.mockResolvedValueOnce(response([row(102, [1], 4), row(103, [999], 3)], 102));
    const result = await createCitationGraphClient().expand(seed, [seed, ...Array.from({ length: 100 }, (_, i) => work(i + 2))], "citations", 5, new AbortController().signal);
    expect(result.works.map((item) => item.id)).toEqual(["W102"]);
    expect(result.edges).toEqual([{ id: "W102:W1", source: "W102", target: "W1" }]);
    expect(new URL(request.mock.calls[1][1]).searchParams.get("page")).toBe("2");
  });
  it("retains partial discovery and reports auth errors without inventing edges", async () => {
    request.mockResolvedValueOnce(response([row(2, [], 20)]));
    request.mockResolvedValueOnce(new Response("", { status: 401 }));
    const seed = work(1, [2]);
    const result = await createCitationGraphClient().expand(seed, [seed], "both", 10, new AbortController().signal);
    expect(result.works.map((item) => item.id)).toEqual(["W2"]);
    expect(result.errors.join()).toContain("API 凭据");
  });
  it("rejects stale or cancelled results and malformed provider payloads", async () => {
    const controller = new AbortController();
    request.mockImplementation(async () => { controller.abort(); return response([row(1)]); });
    await expect(createCitationGraphClient().loadLibrary([{ id: "a", title: "A", doi: "10.1234/1" }], controller.signal)).rejects.toThrow();
    expect(parseCitationWork({ id: "https://evil.example/W1", title: "wrong" })).toBeUndefined();
  });
});
