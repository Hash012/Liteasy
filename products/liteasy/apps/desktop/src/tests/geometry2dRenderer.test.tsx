import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Geometry2DRenderer, renderGeometry2D } from "../app/features/visualization/renderers/geometry2dRenderer";
import type { Geometry2DSpecV1 } from "../app/features/visualization/visualizationArtifact.types";

const fixture = {
  constraints: [{ evidenceClaimIds: ["claim-tangent"], id: "tangent", kind: "tangent", objectIds: ["circle", "line"] }],
  objects: [
    { data: { cx: 0, cy: 0, radius: 1 }, evidenceClaimIds: ["claim-circle"], id: "circle", kind: "circle" },
    { data: { x1: -1, x2: 1, y1: 1, y2: 1 }, evidenceClaimIds: ["claim-line"], id: "line", kind: "line" }
  ],
  viewport: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 }
} as const satisfies Geometry2DSpecV1;

describe("renderGeometry2D", () => {
  test("renders controlled geometry through safe SVG", () => {
    const rendered = renderGeometry2D(fixture);

    expect(rendered.svg).toContain('role="img"');
    expect(rendered.svg).toContain("object-circle");
    expect(rendered.svg).toContain("object-tangent-point");
    expect(rendered.svg).not.toContain("<script");
    expect(rendered.selectableObjectIds).toEqual(["circle", "line", "tangent-point"]);
  });

  test("renders every declared bounded geometry primitive", () => {
    const rendered = renderGeometry2D({
      constraints: [],
      objects: [
        { data: { cx: 0, cy: 0, endAngle: 180, radius: 1, startAngle: 0 }, evidenceClaimIds: ["claim-arc"], id: "arc", kind: "arc" },
        { data: { points: [-1, -1, 1, -1, 0, 1] }, evidenceClaimIds: ["claim-polygon"], id: "polygon", kind: "polygon" },
        { data: { points: [-1, 0, 0, 1, 1, 0] }, evidenceClaimIds: ["claim-curve"], id: "curve", kind: "curve" }
      ],
      viewport: fixture.viewport
    });

    expect(rendered.svg).toContain("object-arc");
    expect(rendered.svg).toContain("object-polygon");
    expect(rendered.svg).toContain("object-curve");
    expect(rendered.svg.match(/<path/gu)?.length).toBeGreaterThanOrEqual(3);
  });

  test("projects selectable geometry objects in React", () => {
    render(<Geometry2DRenderer rendered={renderGeometry2D(fixture)} />);

    expect(screen.getByRole("img", { name: /circle/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "circle" })).toHaveAttribute("data-object-id", "circle");
    expect(screen.getByText("(0, 1)")).toBeInTheDocument();
  });

  test("re-renders the construction when zooming and panning", () => {
    render(<Geometry2DRenderer rendered={renderGeometry2D(fixture)} />);
    const stage = screen.getByTestId("geometry-2d-stage");
    const svg = screen.getByTestId("geometry-2d-svg");
    const initialSvg = svg.innerHTML;
    const initialViewport = stage.getAttribute("data-viewport");

    fireEvent.click(screen.getByRole("button", { name: "放大二维几何" }));
    expect(stage).not.toHaveAttribute("data-viewport", initialViewport);
    expect(svg.innerHTML).not.toBe(initialSvg);

    const zoomedSvg = svg.innerHTML;
    fireEvent.keyDown(stage, { key: "ArrowUp" });
    expect(svg.innerHTML).not.toBe(zoomedSvg);
  });
});
