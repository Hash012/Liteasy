import assert from "node:assert/strict";
import test from "node:test";
import { localPort, localUrl, parseEnvironmentFile, resolvedLocalEnvironment } from "./config.mjs";

test("parses deployment values without interpreting secret contents", () => {
  assert.deepEqual(parseEnvironmentFile("# local\nONE=value=with=equals\nTWO=2\n"), {
    ONE: "value=with=equals",
    TWO: "2"
  });
  assert.throws(() => parseEnvironmentFile("ONE=1\nONE=2\n"), /duplicate key/);
});

test("resolves defaults and validates runtime ports and URLs", () => {
  const values = resolvedLocalEnvironment({ KEYCLOAK_HOST_PORT: "28081" });
  assert.equal(localPort(values, "KEYCLOAK_HOST_PORT"), 28081);
  assert.equal(localUrl(values, "KEYCLOAK_ISSUER"), "http://localhost:18081/realms/liteasy");
  assert.throws(() => localPort({ PORT: "0" }, "PORT"), /invalid PORT/);
  assert.throws(() => localUrl({ URL: "file:///tmp/issuer" }, "URL"), /invalid URL/);
});
