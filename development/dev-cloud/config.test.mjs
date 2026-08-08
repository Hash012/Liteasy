import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPublicRuntimeSummary,
  loadSecretEnvFile
} from "./config.mjs";

test("loads local settings without overriding existing process env", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-secret-env-"));
  const envFile = path.join(tempDir, ".env.local");
  fs.writeFileSync(
    envFile,
    [
      "OPENAI_API_KEY=openai-file-value",
      "DEEPSEEK_API_KEY=deepseek-file-value",
      "OPENALEX_API_KEY=openalex-file-value",
      "SEMANTIC_SCHOLAR_API_KEY=semantic-scholar-file-value",
      "LITEASY_MODEL_PROVIDER=deepseek"
    ].join("\n")
  );

  const env = {
    DEEPSEEK_API_KEY: "deepseek-existing-value",
    LITEASY_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "openai-existing-value"
  };
  loadSecretEnvFile(envFile, env);

  assert.equal(env.OPENAI_API_KEY, "openai-existing-value");
  assert.equal(env.DEEPSEEK_API_KEY, "deepseek-existing-value");
  assert.equal(env.OPENALEX_API_KEY, "openalex-file-value");
  assert.equal(env.SEMANTIC_SCHOLAR_API_KEY, "semantic-scholar-file-value");
  assert.equal(env.LITEASY_MODEL_PROVIDER, "openai");
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

test("builds a stable public runtime summary without exposing credentials", () => {
  const summary = buildPublicRuntimeSummary(
    {
      defaultProvider: "openai",
      openaiApiBaseUrl: "https://user:password@api.example.test/v1?token=secret",
      openaiApiKey: "sk-do-not-expose",
      openaiModel: "gpt-5.6-terra"
    },
    {
      pid: 4242,
      startedAt: "2026-08-01T00:00:00.000Z"
    }
  );

  assert.deepEqual(summary, {
    provider: "openai",
    upstreamBaseUrl: "https://api.example.test/v1",
    hasApiKey: true,
    selectedModel: "gpt-5.6-terra",
    pid: 4242,
    startedAt: "2026-08-01T00:00:00.000Z"
  });
  assert.doesNotMatch(JSON.stringify(summary), /password|secret|sk-do-not-expose/);
});
