import { describe, expect, test } from "vitest";
import { validateCircuit } from "../app/features/visualization/kernels/circuitKernel";
import { ohmsLawFixture } from "./fixtures/staticScienceFixtures";

describe("validateCircuit", () => {
  test("rejects a wire connected to a nonexistent port", () => {
    expect(() => validateCircuit(ohmsLawFixture({
      wire: { evidenceClaimIds: ["claim-circuit"], from: "missing", id: "wire-missing", to: "resistor-in" }
    }))).toThrow("circuit_port_unknown");
  });

  test("checks KCL only when the spec supplies compatible current values", () => {
    expect(validateCircuit(ohmsLawFixture({
      currents: [{ nodeId: "junction", values: [2, 1, 1] }]
    })).invariants.kcl).toBe("pass");
  });
});
