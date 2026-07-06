import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSecretEnvFile } from "./config.mjs";

test("loads model api keys from a local env file without overriding process env", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-secret-env-"));
  const envFile = path.join(tempDir, ".env.local");
  fs.writeFileSync(
    envFile,
    [
      "OPENAI_API_KEY=openai-file-value",
      "DEEPSEEK_API_KEY=deepseek-file-value",
      "LITEASY_MODEL_PROVIDER=deepseek"
    ].join("\n")
  );

  const env = {
    OPENAI_API_KEY: "openai-existing-value"
  };
  loadSecretEnvFile(envFile, env);

  assert.equal(env.OPENAI_API_KEY, "openai-existing-value");
  assert.equal(env.DEEPSEEK_API_KEY, "deepseek-file-value");
  assert.equal(env.LITEASY_MODEL_PROVIDER, "deepseek");
});

test("ignores comments, blanks, and quoted values in local env files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-secret-env-"));
  const envFile = path.join(tempDir, ".env.local");
  fs.writeFileSync(
    envFile,
    [
      "# local secrets",
      "",
      "OPENAI_API_KEY=\"openai-quoted-value\"",
      "OPENAI_BASE_URL='https://api.example.test/v1'"
    ].join("\n")
  );

  const env = {};
  loadSecretEnvFile(envFile, env);

  assert.equal(env.OPENAI_API_KEY, "openai-quoted-value");
  assert.equal(env.OPENAI_BASE_URL, "https://api.example.test/v1");
});
