import { describe, expect, test } from "vitest";
import { resolveLocalDevCloudEndpoint } from "../app/features/models/localDevCloudEndpoint";

describe("resolveLocalDevCloudEndpoint", () => {
  test("uses the current browser host for LAN-accessed pages", () => {
    expect(
      resolveLocalDevCloudEndpoint({
        hostname: "10.77.110.167",
        protocol: "http:"
      })
    ).toBe("http://10.77.110.167:8787");
  });

  test("normalizes localhost to the loopback endpoint used by desktop tests", () => {
    expect(
      resolveLocalDevCloudEndpoint({
        hostname: "localhost",
        protocol: "http:"
      })
    ).toBe("http://127.0.0.1:8787");
  });

  test("uses the Vite-injected dev cloud port when the dev script selects a fallback", () => {
    expect(
      resolveLocalDevCloudEndpoint(
        {
          hostname: "localhost",
          protocol: "http:"
        },
        {
          VITE_LITEASY_DEV_CLOUD_PORT: "8790"
        }
      )
    ).toBe("http://127.0.0.1:8790");
  });

  test("falls back to loopback for non-http protocols", () => {
    expect(
      resolveLocalDevCloudEndpoint({
        hostname: "localhost",
        protocol: "tauri:"
      })
    ).toBe("http://127.0.0.1:8787");
  });
});
