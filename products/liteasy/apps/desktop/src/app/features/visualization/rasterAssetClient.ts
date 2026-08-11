export type RasterAssetBytes = {
  bytes: Uint8Array;
  mimeType: "image/png";
};

export type RasterAssetLoader = (assetRef: string, signal: AbortSignal) => Promise<RasterAssetBytes>;

type RasterAssetClientConfiguration = {
  endpoint: string;
  fetchImpl?: typeof fetch;
  getAccessToken: () => string | undefined;
};

let configuration: RasterAssetClientConfiguration | null = null;

export function configureRasterAssetClient(value: RasterAssetClientConfiguration | null): void {
  configuration = value;
}

export const loadConfiguredRasterAsset: RasterAssetLoader = async (assetRef, signal) => {
  const current = configuration;
  if (!current) throw new Error("raster_asset_client_unavailable");
  const match = assetRef.match(/^raster:([a-f0-9]{64})$/u);
  if (!match) throw new Error("raster_asset_ref_invalid");
  const token = current.getAccessToken()?.trim();
  if (!token) throw new Error("raster_asset_unauthorized");
  const endpoint = new URL(current.endpoint);
  if (!new Set(["http:", "https:"]).has(endpoint.protocol)) throw new Error("raster_asset_endpoint_invalid");
  const response = await (current.fetchImpl ?? fetch)(
    `${current.endpoint.replace(/\/+$/u, "")}/v1/account/visualization/assets/${match[1]}`,
    {
      headers: { Accept: "image/png", Authorization: `Bearer ${token}` },
      method: "GET",
      signal
    }
  );
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "raster_asset_unauthorized" : "raster_asset_unavailable");
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0];
  if (mimeType !== "image/png") throw new Error("raster_mime_invalid");
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, mimeType };
};
