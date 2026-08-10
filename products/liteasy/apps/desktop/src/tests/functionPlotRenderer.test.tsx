import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { FunctionPlotRenderer, renderFunctionPlot } from "../app/features/visualization/renderers/functionPlotRenderer";
import type { FunctionPlotSpecV1 } from "../app/features/visualization/visualizationArtifact.types";

const fixture = {
  auxiliaryCurves: [],
  axes: { xLabel: "x", yLabel: "f(x)" },
  domain: { min: -2, max: 2 },
  expression: "x^2",
  keyPoints: [{ evidenceClaimIds: ["claim-vertex"], id: "vertex", label: "vertex", x: 0, y: 0 }],
  parameters: [],
  variable: "x"
} as const satisfies FunctionPlotSpecV1;

describe("renderFunctionPlot", () => {
  test("renders a safe SVG plot with axes and key points", () => {
    const rendered = renderFunctionPlot(fixture);

    expect(rendered.svg).toContain('role="img"');
    expect(rendered.svg).toContain("plot-segment-0");
    expect(rendered.svg).toContain("object-vertex");
    expect(rendered.svg).not.toContain("<script");
    expect(rendered.selectableObjectIds).toEqual(["vertex"]);
  });

  test("projects zoom controls and a data table in React", () => {
    render(<FunctionPlotRenderer rendered={renderFunctionPlot(fixture)} />);

    expect(screen.getByRole("img", { name: /f\(x\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "vertex" })).toHaveAttribute("data-object-id", "vertex");
    expect(screen.getAllByText("f(x)").length).toBeGreaterThanOrEqual(1);
  });
});
