import { RasterIllustrationRenderer, renderRasterIllustration } from "../../app/features/visualization/renderers/rasterIllustrationRenderer";
import type { RasterIllustrationSpecV1 } from "../../app/features/visualization/visualizationArtifact.types";

const encodedPng = "iVBORw0KGgoAAAANSUhEUgAAAIAAAABgCAYAAADVenpJAAABPUlEQVR4nO3Syw1BURhGUR3owJwWVKAUiVK0pBGViEiuoUTEI8IVew32/Jz/W5PpZjeo22TsBwgAASAABIAAEAACQAAIAAGgjwM4HE+DugEQD4B4AMQDIB4A8QCIB0A8AOIBEA+AeADEAyAeAPEAiAdAPADiARDvZQD71eqn+/TBFtv1TwcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADzTbL6829gDAwAAAAAAAAAAAABwo0cDvtvYAwMAAAAAAAAAAAAAAAAAAAAAAACXXv3PdQAAAAAAAAAAAAAABAE8auyBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAOA7APRfARAPgHgAxAMgHgDxAIgHQDwA4gEQD4B4AMQDIB4A8QCIB0A8AOIBEA+AeADEAyAeAPEAiAdAPADiARAPgHgAxDsDG+jxZhYQt4YAAAAASUVORK5CYII=";
const bytes = Uint8Array.from(atob(encodedPng), (character) => character.charCodeAt(0));
const sha256 = "e7bd41d7f4c49778a0fba4c26f1f909b411a49aeafdace26a196edda8fb318c7";

export const rasterIllustrationBrowserFixture = {
  asset: {
    assetRef: `raster:${sha256}`,
    byteLength: bytes.byteLength,
    height: 96,
    labelVerification: {
      engine: "fixture-ocr/v1",
      verifiedLabelIds: ["input", "output"]
    },
    mimeType: "image/png",
    sha256,
    width: 128
  },
  composition: { aspectRatio: 4 / 3, height: 96, width: 128 },
  evidenceClaimIds: ["claim-raster-browser"],
  labels: [
    { evidenceClaimIds: ["claim-raster-browser"], id: "input", text: "Input stage" },
    { evidenceClaimIds: ["claim-raster-browser"], id: "output", text: "Output stage" }
  ],
  styleLock: {
    allowTransparency: false,
    palette: ["#0f6cbd", "#da4949", "#2a8c69", "#f8fafc"],
    prohibitDecorativeClaims: true,
    typography: "system"
  },
  visualSchema: "Evidence-bounded input and output process illustration"
} as const satisfies RasterIllustrationSpecV1;

export default function RasterIllustrationBrowserFixture() {
  const rendered = renderRasterIllustration(rasterIllustrationBrowserFixture);
  return (
    <main data-testid="raster-illustration-browser-fixture">
      <RasterIllustrationRenderer
        loadAsset={async (_assetRef, signal) => {
          if (signal.aborted) throw signal.reason;
          return { bytes, mimeType: "image/png" };
        }}
        rendered={rendered}
      />
      <output data-testid="raster-illustration-scene-metadata">
        {rasterIllustrationBrowserFixture.composition.width}x{rasterIllustrationBrowserFixture.composition.height}|{rendered.selectableObjectIds.join(",")}
      </output>
    </main>
  );
}
