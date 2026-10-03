import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { sealRecoveryJournal, verifyRecoveryJournal, verifyReplayCompletion } from "../scripts/recoveryJournal.mjs";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
const base = { sourceDatabase: "isolated_source_test", targetDatabase: "isolated_restore_test", backupSha256: "a".repeat(64),
  backupFinishedAt: "2026-10-03T00:00:00Z", highWatermark: "2026-10-03T02:00:00Z",
  events: [{ kind: "delete", input: { subjectId: "synthetic" } }, { kind: "withdraw", input: { annotationId: "synthetic" } }] };
const sealed = sealRecoveryJournal(base, keys.privateKey);
const inputs = { ...sealed, publicKey, backupSha256: base.backupSha256, sourceDatabase: base.sourceDatabase,
  targetDatabase: base.targetDatabase, requiredThrough: base.highWatermark };

test("trusted complete checkpoint and exact replay receipts permit readiness", () => {
  const journal = verifyRecoveryJournal(inputs);
  assert.equal(verifyReplayCompletion(journal, journal.events.map(({ sequence, hash }) => ({ sequence, hash }))), true);
  assert.throws(() => verifyReplayCompletion(journal, [journal.events[0]]), /incomplete/);
  assert.throws(() => verifyReplayCompletion(journal, [journal.events[1], journal.events[0]]), /incomplete/);
});

test("missing, truncated, tampered, cross-instance and stale journals cannot open readiness", () => {
  for (const change of [
    { bytes: undefined }, { bytes: sealed.bytes.slice(0, -5) },
    { bytes: sealed.bytes.replace("synthetic", "altered") },
    { checkpoint: { ...sealed.checkpoint, endSequence: 1 } },
    { checkpoint: null }, { sourceDatabase: "other_test" }, { targetDatabase: "other_restore_test" },
    { backupSha256: "b".repeat(64) }, { requiredThrough: "2026-10-03T03:00:00Z" },
    { publicKey: generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }) }
  ]) assert.throws(() => verifyRecoveryJournal({ ...inputs, ...change }), /incomplete/);
});

test("even a signed producer entry must have supported event types and contiguous replay positions", () => {
  const invalid = sealRecoveryJournal({ ...base, events: [{ kind: "unexpected" }] }, keys.privateKey);
  assert.throws(() => verifyRecoveryJournal({ ...inputs, ...invalid }), /incomplete/);
  const journal = verifyRecoveryJournal(inputs);
  assert.throws(() => verifyReplayCompletion(journal, [journal.events[0], journal.events[0]]), /incomplete/);
});
