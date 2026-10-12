import { expect, test } from "vitest";
import { createContentReadLedger, contentReadLedgerSchema } from "../app/features/resource-filesystem/contentReadLedger";
import { readAgentAssetText } from "../app/features/resource-filesystem/agentAssetService";
import { evidenceReportFromAssetReads } from "../app/features/evidence/evidenceAdapters";
import { parseEvidenceReport } from "../app/features/evidence/evidenceReport";
const asset = { path: "liteasy://objects/n?scope=local", kind: "content.note", title: "笔记", revision: "r1", capabilities: [] };
test("keeps repeated and different revision reads after eviction and report persistence", async () => {
  const ledger = createContentReadLedger("run", "local");
  const first = await ledger.append(readAgentAssetText(asset, "first\n\nsecond", { maxCharacters: 5 }));
  const second = await ledger.append(readAgentAssetText(asset, "first\n\nsecond", { offset: 7 }));
  await ledger.append(readAgentAssetText({ ...asset, revision: "r2" }, "changed", {}));
  await ledger.delivered("call1", "only second actually delivered", [second]);
  const snapshot = contentReadLedgerSchema.parse(JSON.parse(JSON.stringify(ledger.snapshot())));
  expect(snapshot.reads.map(read => read.revision)).toEqual(["r1", "r1", "r2"]);
  expect(snapshot.deliveries.at(-1)?.readIds).toEqual([second]);
  expect(snapshot.deliveries.at(-1)?.readIds).not.toContain(first);
  const report = parseEvidenceReport(JSON.parse(JSON.stringify(evidenceReportFromAssetReads({ id: "run", answer: "", scopeId: "local", reads: ledger.reads(), readLedger: snapshot }))));
  expect(report?.passages.map(passage => passage.quote)).toEqual(["first", "second", "changed"]);
  expect(report?.claims).toEqual([]);
});
test("display expansion never counts as model or verifier delivery", async () => {
  const ledger = createContentReadLedger("run", "local");
  const read = readAgentAssetText(asset, "<table><tr><th>Header</th><td>7</td></tr></table>", { offset: 28, maxCharacters: 1 });
  await ledger.append(read);
  expect(ledger.snapshot().deliveries.map(receipt => receipt.audience)).toEqual(["display"]);
  expect(ledger.snapshot().reads[0].ranges).toEqual([{ start: 28, end: 29, unit: "utf16" }]);
});
