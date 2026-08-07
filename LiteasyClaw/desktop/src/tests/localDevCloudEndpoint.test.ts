import { describe, expect, test } from "vitest";
import {
  resolveLocalDevCloudEndpoint,
  shouldApplyLocalDevCloudDefaults
} from "../app/features/models/localDevCloudEndpoint";

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

  test("normalizes the packaged Tauri origin to the Windows loopback endpoint", () => {
    expect(
      resolveLocalDevCloudEndpoint({
        hostname: "tauri.localhost",
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

  test("enables local dev cloud defaults for the desktop Vite dev page", () => {
    expect(
      shouldApplyLocalDevCloudDefaults({
        hostname: "127.0.0.1",
        port: "1425",
        protocol: "http:"
      })
    ).toBe(true);
  });

  test("does not enable local dev cloud defaults for unrelated browser pages", () => {
    expect(
      shouldApplyLocalDevCloudDefaults({
        hostname: "localhost",
        port: "3000",
        protocol: "http:"
      })
    ).toBe(false);
  });
});
