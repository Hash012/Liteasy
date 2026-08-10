import assert from "node:assert/strict";
import test from "node:test";
import { generateRasterIllustration } from "./visualizationRasterService.mjs";

function validPngBytes() {
  return Buffer.from("89504e470d0a1a0a0000000d494844520000000200000002080600000072b60d240000000049454e44ae426082", "hex");
}

function imageAdapter(image) {
  return {
    async generateImage() {
      return image;
    }
  };
}

test("normalizes a provider image without exposing provider fields", async () => {
  const result = await generateRasterIllustration({
    provider: imageAdapter({ bytes: validPngBytes(), height: 2, mimeType: "image/png", providerRequestId: "secret", width: 2 })
  });

  assert.deepEqual(Object.keys(result), ["assetRef", "height", "mimeType", "sha256", "width"]);
  assert.equal(result.width, 2);
  assert.equal(result.height, 2);
  assert.equal(result.mimeType, "image/png");
});
