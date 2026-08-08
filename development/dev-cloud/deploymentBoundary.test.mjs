import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertDevCloudDeploymentBoundary } from "./deploymentBoundary.mjs";
import { createDatabase } from "./db/database.mjs";
import { createDevCloudRequestHandler } from "./requestHandler.mjs";

const serviceDirectory = path.dirname(fileURLToPath(import.meta.url));

test("allows only development and test adapters", () => {
  assert.deepEqual(
    assertDevCloudDeploymentBoundary({ nodeEnvironment: "development" }),
    { requestedEnvironment: "development", runtimeEnvironment: "development" }
  );
  assert.deepEqual(
    assertDevCloudDeploymentBoundary({ nodeEnvironment: "test" }),
    { requestedEnvironment: "test", runtimeEnvironment: "test" }
  );
});

test("rejects staging and production even when local storage paths are configured", () => {
  for (const environment of ["staging", "production"]) {
    assert.throws(
      () => assertDevCloudDeploymentBoundary({ nodeEnvironment: environment }),
      /dev_cloud_nonproduction_only/
    );
  }
  assert.throws(
    () => assertDevCloudDeploymentBoundary({
      nodeEnvironment: "development",
      requestedEnvironment: "production"
    }),
    /dev_cloud_nonproduction_only/
  );
});

test("exported database and request-handler constructors also fail closed", () => {
  const originalEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => createDatabase({ databasePath: ":memory:" }), /dev_cloud_nonproduction_only/);
    assert.throws(() => createDevCloudRequestHandler(), /dev_cloud_nonproduction_only/);
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
  assert.throws(
    () => createDevCloudRequestHandler({ environment: "staging" }),
    /dev_cloud_nonproduction_only/
  );
});

test("the CLI fails closed before binding a production listener", () => {
  const result = spawnSync(process.execPath, ["server.mjs"], {
    cwd: serviceDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      LITEASY_AUDIT_ARCHIVE_DIR: path.join(serviceDirectory, "production-audit"),
      LITEASY_DEV_CLOUD_DATABASE_PATH: path.join(serviceDirectory, "production.sqlite"),
      LITEASY_DEV_CLOUD_DATA_DIR: path.join(serviceDirectory, "production-data"),
      LITEASY_LIBRARY_OBJECT_DIR: path.join(serviceDirectory, "production-objects"),
      NODE_ENV: "production"
    },
    timeout: 3_000
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dev_cloud_nonproduction_only/);
  assert.doesNotMatch(result.stdout, /listening on/);
});
