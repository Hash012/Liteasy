import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createMetadataProviderClient } from "../app/features/paper-services/metadataProviderClient";
import { parsePmlrBibliography } from "../app/features/paper-services/pmlrMetadata";
import { deletePaperServiceKey, paperServiceRequest, savePaperServiceKey } from "../app/features/paper-services/paperServiceTransport";
import { buildPdfRecognitionRequest, selectPdfRecognitionCandidate } from "../app/features/metadata/pdfRecognition";
import { createLiteratureResolutionRepository, resolutionStateFromResult } from "../app/features/paper-identity/literatureResolutionRepository";

const bibliography = readFileSync(resolve(process.cwd(), "../../../../development/test-data/literature/larimar-pmlr.bib"), "utf8");
const title = "Larimar: Large Language Models with Episodic Memory Control";
const config = { provider: "crossref" as const, endpoint: "https://api.crossref.org" };
const evidence = { firstPageText: `${title}\nPayel Das 1 Subhajit Chaudhury 1\nAbstract\nPMLR 235, 2024.` };
afterEach(async () => { await deletePaperServiceKey(config); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("retrieves Larimar from its official PMLR volume without Crossref or leaking API keys", async () => {
  await savePaperServiceKey(config, "private-crossref-key");
  const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
    expect(url.href).toBe("https://proceedings.mlr.press/v235/assets/bib/bibliography.bib");
    expect(init?.headers).not.toHaveProperty("Crossref-Plus-API-Token");
    return new Response(bibliography);
  });
  vi.stubGlobal("fetch", fetch);
  const client = createMetadataProviderClient(config);
  const request = buildPdfRecognitionRequest(evidence)!;
  expect(request.hints).toMatchObject({ title, pmlr: { source: "pmlr", volume: 235, year: 2024 } });
  const result = await client.resolveLiterature(request);
  const candidate = selectPdfRecognitionCandidate(result, evidence)!;
  expect(candidate).toMatchObject({ provider: "pmlr", candidateKey: "pmlr:pmlr_id:v235/das24a",
    record: { title, authors: expect.arrayContaining(["Payel Das", "Subhajit Chaudhury"]), year: 2024 },
    sourceEvidence: { artifactHash: `sha256:${createHash("sha256").update(bibliography).digest("hex")}`, volume: 235 } });
  let snapshot: unknown;
  const repository = createLiteratureResolutionRepository({
    loadArtifact: async <T>() => snapshot as T | undefined,
    saveArtifact: vi.fn(async (input) => { snapshot = input.snapshot; })
  });
  const state = resolutionStateFromResult(request, result);
  await repository.save("das24a", state);
  expect(await repository.load("das24a")).toEqual(state);
  const confirmed = await client.confirmLiterature({ candidateKey: candidate.candidateKey, mode: "candidate" });
  expect(confirmed.literature).toMatchObject({ title, year: 2024, provenance: { provider: "pmlr" },
    identifiers: [expect.objectContaining({ kind: "pmlr_id", value: "v235/das24a" })] });
  expect(fetch).toHaveBeenCalledOnce();
  const restarted = await createMetadataProviderClient(config).confirmLiterature({ candidateKey: candidate.candidateKey, mode: "candidate" });
  expect(restarted.literature.literatureId).toBe(confirmed.literature.literatureId);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("does not substitute a preprint, wrong volume or related Crossref paper for a PMLR publication", async () => {
  const [candidate] = await parsePmlrBibliography(new TextEncoder().encode(bibliography), 235);
  for (const identifiers of [
    [{ kind: "doi" as const, source: "public_registry" as const, value: "10.1234/related" }],
    [{ kind: "arxiv_id" as const, source: "public_registry" as const, value: "2403.11901" }],
    [{ kind: "pmlr_id" as const, source: "public_registry" as const, value: "v236/das24a" }]
  ]) {
    expect(selectPdfRecognitionCandidate({ status: "ambiguous", candidates: [{ ...candidate, record: { ...candidate.record, identifiers } }], unavailableProviders: [] }, evidence)).toBeUndefined();
  }
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bibliography)));
  const result = await createMetadataProviderClient(config).resolveLiterature({ purpose: "liteasy_pdf_annotation",
    hints: { title: "A different episodic memory paper", pmlr: { source: "pmlr", volume: 235, year: 2024 } } });
  expect(result.status).toBe("not_found");
  expect(fetch).toHaveBeenCalledOnce();
});

test("rejects duplicate IDs, inconsistent URLs/volumes and malformed literal entries", async () => {
  for (const text of [bibliography + bibliography,
    bibliography.replace("https://proceedings.mlr.press/v235/das24a.html", "https://example.com/v235/das24a.html"),
    bibliography.replace("{235}", "{236}"),
    bibliography.replace("{PMLR}", '"PMLR"')]) {
    expect(await parsePmlrBibliography(new TextEncoder().encode(text), 235)).toEqual([]);
  }
  await expect(parsePmlrBibliography(new TextEncoder().encode("<html>Service unavailable</html>"), 235)).rejects.toThrow("题录");
});

test("scans nested braces and ignores entry-like text embedded inside abstract fields", async () => {
  const text = bibliography.replace(title, "Larimar: {Large Language Models} with Episodic Memory Control")
    .replace(/\n}\s*$/, ',\nabstract = {Nested {commas, braces} and\n@InProceedings{pmlr-v235-fake24a, text}}\n}\n');
  expect(await parsePmlrBibliography(new TextEncoder().encode(text), 235)).toMatchObject([{ record: { title } }]);
});

test("bounds response streams even without Content-Length and cancels oversized downloads", async () => {
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(12)); }, cancel
  }))));
  await expect(paperServiceRequest(config, "https://proceedings.mlr.press/v235/assets/bib/bibliography.bib",
    { authenticate: false, maxResponseBytes: 10 })).rejects.toThrow("大小限制");
  expect(cancel).toHaveBeenCalledOnce();
});
