import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readOpenAlexApiKey, requireOpenAlexApiKey } from "../../scripts/openalex-api-key.mjs";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const temporaryPath of temporaryPaths.splice(0)) {
    fs.rmSync(temporaryPath, { force: true });
  }
});

describe("openalex-api-key", () => {
  test("prefers the process-local user setting without reading a file", () => {
    expect(readOpenAlexApiKey({
      env: { LITEASY_OPENALEX_API_KEY: "configured-key" },
      envPaths: ["/path/that-is-not-read"]
    })).toBe("configured-key");
  });

  test("reads a dotenv api_key without exposing it through output", () => {
    const envPath = path.join(os.tmpdir(), `liteasy-openalex-${Date.now()}.env`);
    temporaryPaths.push(envPath);
    fs.writeFileSync(envPath, "# local user key\napi_key = 'file-key' # comment\n", "utf8");

    expect(readOpenAlexApiKey({ env: {}, envPaths: [envPath] })).toBe("file-key");
  });

  test("fails explicitly when no user key is configured", () => {
    expect(() => requireOpenAlexApiKey({ env: {}, envPaths: [] })).toThrow("OpenAlex live eval requires");
  });

  test("rejects an invalid user key before a live request", () => {
    expect(() => requireOpenAlexApiKey({
      env: { LITEASY_OPENALEX_API_KEY: "key with whitespace" },
      envPaths: []
    })).toThrow("API key format is invalid");
  });
});
