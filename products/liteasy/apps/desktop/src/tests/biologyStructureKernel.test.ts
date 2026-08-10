import { describe, expect, test } from "vitest";
import { validateBiologyStructure } from "../app/features/visualization/kernels/biologyStructureKernel";
import { neuralFixture } from "./fixtures/staticScienceFixtures";

describe("validateBiologyStructure", () => {
  test("rejects an unknown controlled-ontology ID", () => {
    expect(() => validateBiologyStructure(neuralFixture({ ontologyId: "unimplemented:cell-x" })))
      .toThrow("biology_ontology_unknown");
  });

  test("requires evidence for each neural connection endpoint", () => {
    expect(() => validateBiologyStructure(neuralFixture({
      connections: [{ evidenceClaimIds: [], from: "unknown", id: "connection-missing", to: "axon" }]
    }))).toThrow("biology_connection_unbound");
  });
});
