import type { FunctionPlotSpecV1 } from "../../app/features/visualization/visualizationArtifact.types";
import { FunctionPlotRenderer, renderFunctionPlot } from "../../app/features/visualization/renderers/functionPlotRenderer";

const functionPlotFixture = {
  auxiliaryCurves: [],
  axes: { xLabel: "x", yLabel: "f(x)" },
  domain: { min: -2, max: 2 },
  expression: "x^2",
  keyPoints: [{ evidenceClaimIds: ["claim-vertex"], id: "vertex", label: "vertex", x: 0, y: 0 }],
  parameters: [],
  variable: "x"
} as const satisfies FunctionPlotSpecV1;

export default function FunctionPlotBrowserFixture() {
  const rendered = renderFunctionPlot(functionPlotFixture);

  return (
    <main data-testid="function-plot-browser-fixture">
      <FunctionPlotRenderer rendered={rendered} />
      <output data-testid="function-plot-scene-metadata">
        {rendered.segments.length}|{rendered.selectableObjectIds.join(",")}
      </output>
    </main>
  );
}
