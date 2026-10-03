import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertAccountGate, requiredAccountSuites } from "./account-boundary-policy.mjs";
import { accountCommands, evidenceSummary, runCommands } from "./run-account-boundary-suite.mjs";

test("Desktop-only publication, account, and organization changes require service regression", () => {
  for (const file of ["features/pdf/pdfAnnotationPublicationClient.ts", "features/account/useAccountSession.ts", "controllers/useOrganizationActions.ts", "features/agent/runtime/assetSourceReferences.ts"]) {
    assert.deepEqual(requiredAccountSuites([`products/liteasy/apps/desktop/src/app/${file}`]), { services: true, clients: ["desktop"] });
  }
  assert.deepEqual(requiredAccountSuites(["docs/example.md", "products/liteasy/apps/desktop/src/app/styles/pdf.css"]), { services: false, clients: [] });
});

test("authority and shared-contract changes include every client, without installers", () => {
  for (const file of ["products/liteasy/services/api/src/server.mjs", "products/liteasy/packages/shared/contextRef.v1.schema.json", "products/intuecho/packages/contracts/src/index.ts", "platform/identity-service/src/server.mjs", ".github/scripts/account-boundary-policy.mjs"]) {
    assert.deepEqual(requiredAccountSuites([file]), { services: true, clients: ["desktop", "admin", "mobile"] });
  }
  for (const client of ["admin", "mobile"]) assert.deepEqual(requiredAccountSuites([`products/liteasy/apps/${client}/src/App.tsx`]), { services: true, clients: [client] });
});

test("failed real PG process is a failing suite and stops later commands", () => {
  let count = 0;
  const results = runCommands(accountCommands("services-postgres"), () => ({ status: ++count === 2 ? 1 : 0 }));
  assert.equal(count, 2);
  assert.equal(results.at(-1).status, "fail");
  const policy = { services: true, clients: [] };
  assert.throws(() => assertAccountGate(policy, { policy: { result: "success" }, "isolated-services": { result: "failure" }, "client-contracts": { result: "skipped" } }));
  assert.throws(() => assertAccountGate(policy, { policy: { result: "success" }, "isolated-services": { result: "skipped" }, "client-contracts": { result: "skipped" } }));
});

test("portable evidence excludes arbitrary outputs and labels untested native layers", () => {
  const result = evidenceSummary({ suite: "services-postgres", commit: "a".repeat(40), tree: "b".repeat(40), dirtyDiffHash: null,
    environment: { os: "linux", architecture: "x64", node: "22", secret: "DO_NOT_EXPORT" },
    files: [{ path: "fixture.json", sha256: "c".repeat(64), content: "DO_NOT_EXPORT" }],
    results: [{ cwd: ".", command: ["node", "test.mjs"], exitCode: 0, status: "pass", stdout: "DO_NOT_EXPORT" }] });
  assert.equal(result.testedCommit, "a".repeat(40));
  assert.equal(result.status, "pass");
  assert.ok(result.excluded.every((item) => item.status === "not_run"));
  assert.ok(!JSON.stringify(result).includes("DO_NOT_EXPORT"));
});

test("workflow includes client ingress paths, same-checkout runners and only summary artifact files", () => {
  const workflow = readFileSync(new URL("../workflows/account-cloud-community.yml", import.meta.url), "utf8");
  for (const client of ["desktop", "admin", "mobile"]) assert.ok(workflow.includes(`products/liteasy/apps/${client}/**`));
  assert.match(workflow, /run-account-boundary-suite\.mjs services-postgres/);
  assert.match(workflow, /path: test-results\/account-boundaries\/\*\.json/);
  assert.doesNotMatch(workflow, /continue-on-error|pull_request_target|path:.*(?:dump|\.log|\.env)/);
  assert.match(workflow, /account-boundary-policy\.mjs --gate/);
});
