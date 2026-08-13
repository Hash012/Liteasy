import assert from "node:assert/strict";
import test from "node:test";
import {
  EnvironmentVisualizationSecretStore,
  parseVisualizationSecrets
} from "./visualizationSecretStore.mjs";

test("keeps parsed deployment secrets immutable while allowing runtime secret rotation", () => {
  const parsed = parseVisualizationSecrets(JSON.stringify({
    "viz-secret:platform-openai": "deployment-secret"
  }));
  assert.equal(Object.isFrozen(parsed), true);

  const store = new EnvironmentVisualizationSecretStore(parsed);
  store.set("viz-secret:platform-openai", "database-encrypted-secret");

  assert.equal(store.resolve("viz-secret:platform-openai"), "database-encrypted-secret");
  assert.equal(parsed["viz-secret:platform-openai"], "deployment-secret");
});
