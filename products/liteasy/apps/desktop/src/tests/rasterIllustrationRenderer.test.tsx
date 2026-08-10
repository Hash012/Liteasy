import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { RasterIllustrationRenderer, renderRasterIllustration } from "../app/features/visualization/renderers/rasterIllustrationRenderer";
import type { RasterIllustrationSpecV1 } from "../app/features/visualization/visualizationArtifact.types";

const fixture = {
  composition: { aspectRatio: 1, height: 512, width: 512 },
  evidenceClaimIds: ["claim-raster"],
  labels: [{ evidenceClaimIds: ["claim-raster"], id: "label-1", text: "cell" }],
  styleLock: { palette: ["#ffffff", "#111827"], prohibitDecorativeClaims: true, typography: "system" },
  visualSchema: "simple labelled diagram"
} as const satisfies RasterIllustrationSpecV1;

describe("renderRasterIllustration", () => {
  test("renders a safe generated-raster placeholder and label table", () => {
    const rendered = renderRasterIllustration(fixture);

    expect(rendered.svg).toContain('role="img"');
    expect(rendered.svg).toContain("object-label-1");
    expect(rendered.svg).not.toContain("<script");
    render(<RasterIllustrationRenderer rendered={rendered} />);
    expect(screen.getByRole("img", { name: /simple labelled diagram/ })).toBeInTheDocument();
    expect(screen.getAllByText("cell").length).toBeGreaterThanOrEqual(1);
  });
});
