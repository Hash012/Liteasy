import { createHash } from "node:crypto";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export async function generateRasterIllustration({ provider, signal } = {}) {
  if (!provider || typeof provider.generateImage !== "function") throw new Error("raster_provider_invalid");
  if (signal?.aborted) throw new Error("raster_generation_cancelled");
  const image = await provider.generateImage({ signal });
  const bytes = Buffer.from(image?.bytes ?? []);
  const dimensions = pngDimensions(bytes);
  const width = image.width ?? dimensions.width;
  const height = image.height ?? dimensions.height;
  if (image.mimeType !== "image/png" || width !== dimensions.width || height !== dimensions.height) {
    throw new Error("raster_image_invalid");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    assetRef: `sha256:${sha256}`,
    height,
    mimeType: "image/png",
    sha256,
    width
  };
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature)) throw new Error("raster_png_invalid");
  return {
    height: bytes.readUInt32BE(20),
    width: bytes.readUInt32BE(16)
  };
}
