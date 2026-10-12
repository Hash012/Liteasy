import { z } from "zod";
import type { AgentAssetRead } from "./agentAsset.types";
import { resourceContentRevision } from "./resourceFileContent";
const range = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), unit: z.literal("utf16") });
export const contentReadLedgerSchema = z.object({
  reads: z.array(z.object({ id: z.string(), path: z.string(), revision: z.string().optional(), scopeId: z.string(),
    representationId: z.string(), ranges: z.array(range), fetchedHash: z.string(), fetchedAt: z.string() })).max(1000),
  deliveries: z.array(z.object({ id: z.string(), requestId: z.string(), audience: z.enum(["model", "display", "verifier"]),
    readIds: z.array(z.string()), payloadHash: z.string(), ranges: z.array(z.object({ readId: z.string(), ranges: z.array(range) })), at: z.string() })).max(1000),
});
export type ContentReadLedger = z.infer<typeof contentReadLedgerSchema>;
/** Append-only evidence history, deliberately separate from latest-version write preconditions. */
export function createContentReadLedger(runId: string, scopeId: string) {
  const ledger: ContentReadLedger = { reads: [], deliveries: [] };
  const snapshots: AgentAssetRead[] = [];
  return {
    snapshot: () => structuredClone(ledger),
    reads: () => snapshots.slice(),
    async append(read: AgentAssetRead) {
      const id = `${runId}:read:${ledger.reads.length + 1}`;
      snapshots.push(structuredClone(read));
      ledger.reads.push({ id, path: read.asset.path, revision: read.asset.revision, scopeId,
        representationId: read.content?.representationId ?? `${read.asset.path}:legacy-text`,
        ranges: [{ start: read.offset, end: read.offset + read.text.length, unit: "utf16" }],
        fetchedHash: await resourceContentRevision(read.text), fetchedAt: new Date().toISOString() });
      if (read.content?.viewContext.materialBeyondSelection) {
        ledger.deliveries.push({ id: `${id}:display`, requestId: id, audience: "display", readIds: [id],
          ranges: [{ readId: id, ranges: read.content.viewContext.ranges }],
          payloadHash: await resourceContentRevision(read.content.viewContext.text), at: new Date().toISOString() });
      }
      return id;
    },
    async delivered(requestId: string, payload: string, readIds: string[], ranges: Record<string, Array<{ start: number; end: number; unit: "utf16" }>> = {}) {
      const records = ledger.reads.filter(record => readIds.includes(record.id));
      ledger.deliveries.push({ id: `${requestId}:delivery`, requestId, audience: "model", readIds: records.map(record => record.id),
        ranges: records.map(record => ({ readId: record.id, ranges: ranges[record.id] ?? record.ranges })), payloadHash: await resourceContentRevision(payload), at: new Date().toISOString() });
    },
  };
}
