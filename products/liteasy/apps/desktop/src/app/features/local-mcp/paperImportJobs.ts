import { z } from "zod";
import { AgentAssetError } from "../resource-filesystem/agentAsset.types";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { normalizeLiteratureIdentifier } from "../paper-identity/paperIdentity";
import type { ImportPaper, ImportedPaper } from "../library/paperImport.types";
import type { RecommendationItem } from "../recommendations/recommendation.types";

const httpsUrl = z.string().trim().max(8192).refine((value) => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}, "Use an HTTPS paper page or PDF URL without credentials.");
const source = z.strictObject({
  doi: z.string().trim().max(512).refine((value) => !!normalizeLiteratureIdentifier("doi", value), "Invalid DOI").optional(),
  arxivId: z.string().trim().max(128).refine((value) => !!normalizeLiteratureIdentifier("arxiv_id", value), "Invalid arXiv ID").optional(),
  url: httpsUrl.optional(), pdfUrl: httpsUrl.optional(), title: z.string().trim().min(1).max(1000).optional(),
  authors: z.array(z.string().trim().min(1).max(240)).max(100).optional(), year: z.number().int().min(1000).max(9999).optional(),
}).refine((value) => !!(value.doi || value.arxivId || value.url || value.pdfUrl), "Provide a DOI, arXiv ID, paper URL or PDF URL; a title alone cannot identify the paper.");
export const paperImportSchema = z.strictObject({
  operationId: z.string().trim().min(1).max(128), papers: z.array(source).min(1).max(50),
  targetFolderPath: z.string().min(1).max(8192).optional(), newFolderName: z.string().trim().min(1).max(120).optional(),
});
export type PaperImportInput = z.infer<typeof paperImportSchema>;
type Row = { index: number; title: string; status: "queued" | "running" | "imported" | "duplicate" | "failed" | "cancelled"; result?: ImportedPaper & { path: string }; error?: string };
type Job = { jobId: string; operationId: string; status: "running" | "completed" | "cancelled"; items: Row[] };

function recommendation(paper: PaperImportInput["papers"][number]): RecommendationItem {
  const doi = paper.doi ? normalizeLiteratureIdentifier("doi", paper.doi) : "";
  const arxivId = paper.arxivId ? normalizeLiteratureIdentifier("arxiv_id", paper.arxivId) : "";
  const id = doi ? `doi:${doi}` : arxivId ? `arxiv:${arxivId}` : paper.url || paper.pdfUrl!;
  return { id, canonicalId: id, title: paper.title || id, authors: paper.authors, publishedYear: paper.year,
    sourceUrl: paper.url || (doi ? `https://doi.org/${doi}` : arxivId ? `https://arxiv.org/abs/${arxivId}` : paper.pdfUrl),
    openAccessPdfUrl: paper.pdfUrl, source: "MCP", sourceKind: "live", discoveredAt: new Date().toISOString(),
    relatedDocumentTitle: "", relevanceBand: "medium", relevanceScore: 0, reason: "MCP 批量导入" };
}

/** Session-bound jobs keep the stdio bridge responsive and never retain PDF bytes. */
export function createPaperImportJobs(scopeId: string, importPaper: ImportPaper) {
  const jobs = new Map<string, { job: Job; fingerprint: string; abort: AbortController }>();
  let disposed = false;
  const snapshot = (job: Job): Job => structuredClone(job);
  const find = (id: string) => { const entry = jobs.get(id); if (!entry) throw new AgentAssetError("unavailable", "Import job not found in this MCP session. Start a new job after reconnecting."); return entry; };
  return {
    start(raw: PaperImportInput) {
      if (disposed) throw new AgentAssetError("scope_changed", "MCP session has ended.");
      const input = paperImportSchema.parse(raw);
      const fingerprint = JSON.stringify(input);
      const previous = [...jobs.values()].find((entry) => entry.job.operationId === input.operationId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new AgentAssetError("invalid_request", "operationId already belongs to a different import. Use a new operationId.");
        return snapshot(previous.job);
      }
      // Bound both work and retained idempotency records; reconnect after 100 jobs.
      if (jobs.size >= 100 || [...jobs.values()].filter((entry) => entry.job.status === "running").length >= 3)
        throw new AgentAssetError("unavailable", "Import queue is full. Wait for current jobs; reconnect after 100 jobs.");
      const abort = new AbortController();
      const job: Job = { jobId: crypto.randomUUID(), operationId: input.operationId, status: "running", items: input.papers.map((paper, index) => ({ index, title: recommendation(paper).title, status: "queued" })) };
      jobs.set(job.jobId, { job, fingerprint, abort });
      void (async () => {
        // Sequential PDF imports bound WebView memory, and a failed row never aborts the batch.
        for (const row of job.items) {
          if (abort.signal.aborted) { row.status = "cancelled"; continue; }
          row.status = "running";
          try {
            const result = await importPaper(recommendation(input.papers[row.index]), { targetFolderPath: input.targetFolderPath, newFolderName: input.newFolderName }, abort.signal);
            row.result = { ...result, path: liteasyPath(scopeId, { kind: "paper", paperId: result.paperId }) };
            row.title = result.title;
            row.status = result.duplicate ? "duplicate" : "imported";
          } catch (error) {
            row.status = abort.signal.aborted ? "cancelled" : "failed";
            row.error = error instanceof Error ? error.message : String(error);
          }
        }
        job.status = abort.signal.aborted ? "cancelled" : "completed";
      })();
      return snapshot(job);
    },
    status(id: string) { return snapshot(find(id).job); },
    cancel(id: string) {
      const entry = find(id);
      if (entry.job.status === "running") {
        entry.abort.abort();
        entry.job.status = "cancelled";
        for (const row of entry.job.items) if (row.status === "queued") row.status = "cancelled";
      }
      return snapshot(entry.job);
    },
    dispose() { disposed = true; for (const entry of jobs.values()) entry.abort.abort(); },
  };
}
export type PaperImportJobs = ReturnType<typeof createPaperImportJobs>;
