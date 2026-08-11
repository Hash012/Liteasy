import { fireEvent, render, screen } from "@testing-library/react";
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

const parameterFixture = {
  ...fixture,
  expression: "a*x^2",
  parameters: [{ evidenceClaimIds: ["claim-parameter"], id: "a", max: 2, min: 0.5, value: 1 }]
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

  test("renders evidence-bound auxiliary curves as selectable scene objects", () => {
    const rendered = renderFunctionPlot({
      ...fixture,
      auxiliaryCurves: [{ evidenceClaimIds: ["claim-reference"], expression: "x", id: "reference" }]
    });

    expect(rendered.svg).toContain("plot-curve-reference-segment-0");
    expect(rendered.selectableObjectIds).toEqual(["vertex", "reference"]);
  });

  test("projects interactive controls and a data table in React", () => {
    render(<FunctionPlotRenderer rendered={renderFunctionPlot(fixture)} />);

    expect(screen.getByRole("img", { name: /f\(x\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "vertex" })).toHaveAttribute("data-object-id", "vertex");
    expect(screen.getAllByText("f(x)").length).toBeGreaterThanOrEqual(1);
  });

  test("re-renders the plotted scene when zooming and panning", () => {
    render(<FunctionPlotRenderer rendered={renderFunctionPlot(fixture)} />);
    const stage = screen.getByTestId("function-plot-stage");
    const svg = screen.getByTestId("function-plot-svg");
    const initialSvg = svg.innerHTML;
    const initialViewport = stage.getAttribute("data-viewport");

    fireEvent.click(screen.getByRole("button", { name: "放大函数图" }));
    expect(stage).not.toHaveAttribute("data-viewport", initialViewport);
    expect(svg.innerHTML).not.toBe(initialSvg);

    const zoomedSvg = svg.innerHTML;
    fireEvent.keyDown(stage, { key: "ArrowRight" });
    expect(svg.innerHTML).not.toBe(zoomedSvg);
  });

  test("re-samples the curve when a parameter slider changes", () => {
    render(<FunctionPlotRenderer rendered={renderFunctionPlot(parameterFixture)} />);
    const svg = screen.getByTestId("function-plot-svg");
    const initialSvg = svg.innerHTML;
    const slider = screen.getByRole("slider", { name: "参数 a" });

    fireEvent.change(slider, { target: { value: "2" } });

    expect(slider).toHaveValue("2");
    expect(svg.innerHTML).not.toBe(initialSvg);
  });
});
