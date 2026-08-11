import { describe, expect, test } from "vitest";
import type { FunctionPlotSpecV1 } from "../app/features/visualization/visualizationArtifact.types";
import { sampleFunctionPlot, validateFunctionPlot } from "../app/features/visualization/kernels/functionPlotKernel";

const quadraticFixture = {
  auxiliaryCurves: [],
  axes: { xLabel: "x", yLabel: "f(x)" },
  domain: { min: -2, max: 2 },
  expression: "x^2",
  keyPoints: [{ evidenceClaimIds: ["claim-vertex"], id: "vertex", label: "vertex", x: 0, y: 0 }],
  parameters: [],
  variable: "x"
} as const satisfies FunctionPlotSpecV1;

describe("sampleFunctionPlot", () => {
  test("samples a bounded plot and marks derived points", () => {
    const result = sampleFunctionPlot(quadraticFixture);

    expect(result.points.length).toBeLessThanOrEqual(10000);
    expect(result.points[0]).toMatchObject({ derived: true });
    expect(result.segments).toHaveLength(1);
  });

  test("splits a curve around a singularity", () => {
    expect(sampleFunctionPlot({
      ...quadraticFixture,
      domain: { min: -1, max: 1 },
      expression: "1 / x",
      keyPoints: []
    }).segments).toHaveLength(2);
  });

  test("rejects non-finite domains and unbound declared points", () => {
    expect(() => validateFunctionPlot({ ...quadraticFixture, domain: { min: -1, max: Number.POSITIVE_INFINITY } })).toThrow("function_plot_domain_invalid");
    expect(() => validateFunctionPlot({ ...quadraticFixture, keyPoints: [{ ...quadraticFixture.keyPoints[0], evidenceClaimIds: [] }] })).toThrow("function_plot_evidence_missing");
  });
});
