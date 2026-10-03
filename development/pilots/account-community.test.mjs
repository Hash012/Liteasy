import assert from "node:assert/strict";
import test from "node:test";
import { emptyPilotRecord, summarizePilotRecords, validatePilotRecord } from "./account-community.mjs";

const observed = () => ({ ...emptyPilotRecord(), consent: true, participantCode: "participant-fixture1", cohort: "reader",
  testedCommit: "a".repeat(40), platform: "browser", status: "fail", observations: emptyPilotRecord().observations.map((item, index) => index ? item : { ...item, status: "fail", assisted: false, elapsedSeconds: 45, evidenceSha256: "b".repeat(64) }) });

test("an empty record cannot masquerade as a completed human pilot", () => {
  assert.equal(summarizePilotRecords([emptyPilotRecord()]).participation, "not_run");
  assert.throws(() => validatePilotRecord({ ...emptyPilotRecord(), status: "pass" }), /overall result/);
});
test("preserves observed failure and rejects absent consent, fake totals and estimated costs", () => {
  assert.equal(validatePilotRecord(observed()).status, "fail");
  assert.throws(() => validatePilotRecord({ ...observed(), consent: false }), /consent/);
  assert.throws(() => validatePilotRecord({ ...observed(), status: "pass" }), /preserve failures/);
  assert.throws(() => validatePilotRecord({ ...observed(), costs: { measurement: "estimated", amount: 10 } }), /actual metered/);
  const summary = summarizePilotRecords([observed()]);
  assert.equal(summary.cohorts[0].observations[0].fail, 1);
  assert.equal(summary.businessConclusions, "not_established");
  assert.ok(!JSON.stringify(summary).includes("participant-fixture1"));
});
