import { afterEach, describe, expect, test, vi } from "vitest";
import {
  configureRasterAssetClient,
  loadConfiguredRasterAsset
} from "../app/features/visualization/rasterAssetClient";

const digest = "8de1139cc6f6b0f2202d1c911d9232bed5fa38976272bd4f0812bba44a4ff2fc";
const assetRef = `raster:${digest}`;

describe("rasterAssetClient", () => {
  afterEach(() => {
    configureRasterAssetClient(null);
    vi.restoreAllMocks();
  });

  test("downloads a private PNG with the current account token", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const fetchImpl = vi.fn(async () => new Response(bytes, {
      headers: { "content-type": "image/png" },
      status: 200
    }));
    configureRasterAssetClient({
      endpoint: "https://api.liteasy.test/",
      fetchImpl: fetchImpl as typeof fetch,
      getAccessToken: () => "account-token"
    });
    const signal = new AbortController().signal;

    await expect(loadConfiguredRasterAsset(assetRef, signal)).resolves.toEqual({
      bytes,
      mimeType: "image/png"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.liteasy.test/v1/account/visualization/assets/${digest}`,
      {
        headers: { Accept: "image/png", Authorization: "Bearer account-token" },
        method: "GET",
        signal
      }
    );
  });

  test("fails closed for invalid references, MIME types, and authorization errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("not png", {
      headers: { "content-type": "text/plain" },
      status: 200
    }));
    configureRasterAssetClient({
      endpoint: "https://api.liteasy.test",
      fetchImpl: fetchImpl as typeof fetch,
      getAccessToken: () => "account-token"
    });
    const signal = new AbortController().signal;

    await expect(loadConfiguredRasterAsset("raster:not-a-digest", signal)).rejects.toThrow("raster_asset_ref_invalid");
    await expect(loadConfiguredRasterAsset(assetRef, signal)).rejects.toThrow("raster_mime_invalid");

    configureRasterAssetClient({
      endpoint: "https://api.liteasy.test",
      fetchImpl: vi.fn(async () => new Response(null, { status: 403 })) as typeof fetch,
      getAccessToken: () => "account-token"
    });
    await expect(loadConfiguredRasterAsset(assetRef, signal)).rejects.toThrow("raster_asset_unauthorized");
  });

  test("requires configuration and a non-empty access token", async () => {
    const signal = new AbortController().signal;
    await expect(loadConfiguredRasterAsset(assetRef, signal)).rejects.toThrow("raster_asset_client_unavailable");

    configureRasterAssetClient({
      endpoint: "https://api.liteasy.test",
      getAccessToken: () => "  "
    });
    await expect(loadConfiguredRasterAsset(assetRef, signal)).rejects.toThrow("raster_asset_unauthorized");
  });

  test("propagates cancellation to fetch", async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    configureRasterAssetClient({
      endpoint: "https://api.liteasy.test",
      fetchImpl: fetchImpl as typeof fetch,
      getAccessToken: () => "account-token"
    });
    const controller = new AbortController();
    const pending = loadConfiguredRasterAsset(assetRef, controller.signal);
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
