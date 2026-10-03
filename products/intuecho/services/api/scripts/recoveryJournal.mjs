import { createHash, createPublicKey, sign, verify } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const digestPattern = /^[a-f0-9]{64}$/;
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
function required(condition) { if (!condition) throw new Error("recovery_journal_untrusted_or_incomplete"); }

// The signing identity belongs to the separately backed-up event producer, not
// the restored application/database. A locally generated seal is only a drill.
export function sealRecoveryJournal(journal, privateKey, { startSequence = 1, previousHash = "0".repeat(64) } = {}) {
  let priorHash = previousHash;
  const events = journal.events.map((event, index) => {
    const entry = { sequence: startSequence + index, previousHash: priorHash, event };
    const digest = hash(canonical(entry));
    priorHash = digest;
    return { ...entry, hash: digest };
  });
  const value = { ...journal, format: "liteasy.recovery-journal/v2", events };
  const bytes = canonical(value);
  const checkpoint = {
    format: "liteasy.recovery-checkpoint/v1", sourceDatabase: value.sourceDatabase,
    targetDatabase: value.targetDatabase, backupSha256: value.backupSha256,
    backupFinishedAt: value.backupFinishedAt, highWatermark: value.highWatermark,
    startSequence, endSequence: startSequence + events.length - 1, previousHash,
    lastHash: priorHash, journalSha256: hash(bytes)
  };
  return { bytes, checkpoint: { ...checkpoint, signature: sign(null, Buffer.from(canonical(checkpoint)), privateKey).toString("base64") } };
}

export function verifyRecoveryJournal({ bytes, checkpoint, publicKey, backupSha256, sourceDatabase, targetDatabase, requiredThrough }) {
  try {
    required(checkpoint && typeof checkpoint === "object");
    const { signature, ...signed } = checkpoint;
    const key = createPublicKey(publicKey);
    required(key.asymmetricKeyType === "ed25519" && typeof signature === "string");
    required(verify(null, Buffer.from(canonical(signed)), key, Buffer.from(signature, "base64")));
    required(signed.format === "liteasy.recovery-checkpoint/v1");
    required(digestPattern.test(backupSha256) && signed.backupSha256 === backupSha256);
    required(signed.sourceDatabase === sourceDatabase && signed.targetDatabase === targetDatabase);
    // requiredThrough is from the independent recovery control plane, never
    // inferred from the journal being checked (which may be an older valid one).
    required(timestamp(requiredThrough) && timestamp(signed.highWatermark) && Date.parse(signed.highWatermark) >= Date.parse(requiredThrough));
    required(timestamp(signed.backupFinishedAt) && Date.parse(signed.backupFinishedAt) <= Date.parse(signed.highWatermark));
    required(Number.isSafeInteger(signed.startSequence) && signed.startSequence >= 1);
    required(Number.isSafeInteger(signed.endSequence) && signed.endSequence >= signed.startSequence - 1);
    required(digestPattern.test(signed.previousHash) && digestPattern.test(signed.lastHash));
    required(typeof bytes === "string" && hash(bytes) === signed.journalSha256);
    const journal = JSON.parse(bytes);
    required(journal.format === "liteasy.recovery-journal/v2" && Array.isArray(journal.events));
    for (const field of ["sourceDatabase", "targetDatabase", "backupSha256", "backupFinishedAt", "highWatermark"]) required(journal[field] === signed[field]);
    required(journal.events.length === signed.endSequence - signed.startSequence + 1);
    let previousHash = signed.previousHash;
    for (const [index, entry] of journal.events.entries()) {
      required(entry.sequence === signed.startSequence + index && entry.previousHash === previousHash);
      required(entry.hash === hash(canonical({ sequence: entry.sequence, previousHash: entry.previousHash, event: entry.event })));
      required(["delete", "withdraw"].includes(entry.event?.kind));
      previousHash = entry.hash;
    }
    required(previousHash === signed.lastHash);
    return journal;
  } catch {
    throw new Error("recovery_journal_untrusted_or_incomplete");
  }
}

export function verifyReplayCompletion(journal, applied) {
  required(Array.isArray(applied) && applied.length === journal.events.length);
  for (const [index, entry] of journal.events.entries()) {
    required(applied[index]?.sequence === entry.sequence && applied[index]?.hash === entry.hash);
  }
  return true;
}
