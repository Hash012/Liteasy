import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RasterIllustrationRenderer, renderRasterIllustration } from "../app/features/visualization/renderers/rasterIllustrationRenderer";
import type { RasterIllustrationSpecV1 } from "../app/features/visualization/visualizationArtifact.types";

const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAADklEQVR4nGP4DwUMMAYAj4IP8TylVlEAAAAASUVORK5CYII=", "base64"));
const sha256 = "8de1139cc6f6b0f2202d1c911d9232bed5fa38976272bd4f0812bba44a4ff2fc";
const fixture = {
  asset: {
    assetRef: `raster:${sha256}`,
    byteLength: bytes.byteLength,
    height: 2,
    labelVerification: { engine: "fixture-ocr/v1", verifiedLabelIds: ["label-1"] },
    mimeType: "image/png",
    sha256,
    width: 2
  },
  composition: { aspectRatio: 1, height: 2, width: 2 },
  evidenceClaimIds: ["claim-raster"],
  labels: [{ evidenceClaimIds: ["claim-raster"], id: "label-1", text: "cell" }],
  styleLock: { palette: ["#ffffff", "#111827"], prohibitDecorativeClaims: true, typography: "system" },
  visualSchema: "simple labelled diagram"
} as const satisfies RasterIllustrationSpecV1;

describe("renderRasterIllustration", () => {
  beforeEach(() => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close: vi.fn(), height: 2, width: 2 })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(Array(4).fill(255)) }))
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:raster-fixture"),
      revokeObjectURL: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("loads and displays validated private raster bytes", async () => {
    const rendered = renderRasterIllustration(fixture);
    const loadAsset = vi.fn(async () => ({ bytes, mimeType: "image/png" as const }));
    render(<RasterIllustrationRenderer loadAsset={loadAsset} rendered={rendered} />);

    await waitFor(() => expect(screen.getByTestId("raster-illustration-runtime")).toHaveAttribute("data-runtime", "ready"));
    expect(screen.getByRole("img", { name: /simple labelled diagram/ })).toHaveAttribute("src", "blob:raster-fixture");
    expect(loadAsset).toHaveBeenCalledWith(`raster:${sha256}`, expect.any(AbortSignal));
    expect(screen.getByText("生成插图")).toBeInTheDocument();
  });

  test("supports real zoom state and label selection", async () => {
    render(<RasterIllustrationRenderer loadAsset={async () => ({ bytes, mimeType: "image/png" })} rendered={renderRasterIllustration(fixture)} />);
    await waitFor(() => expect(screen.getByTestId("raster-illustration-runtime")).toHaveAttribute("data-runtime", "ready"));
    const stage = screen.getByLabelText("生成插图画布");
    const initialViewport = stage.getAttribute("data-viewport");
    fireEvent.click(screen.getByRole("button", { name: "放大生成插图" }));
    expect(stage).not.toHaveAttribute("data-viewport", initialViewport);
    fireEvent.click(screen.getByRole("button", { name: "label-1" }));
    expect(screen.getByRole("button", { name: "label-1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("cell").length).toBeGreaterThanOrEqual(2);
  });

  test("fails closed instead of rendering unvalidated bytes", async () => {
    render(<RasterIllustrationRenderer loadAsset={async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" })} rendered={renderRasterIllustration(fixture)} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("插图不可用"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
