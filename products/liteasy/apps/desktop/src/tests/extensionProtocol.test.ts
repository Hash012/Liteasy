import { describe, expect, test } from "vitest";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";
import {
  buildCoreExtensionProtocolCatalog,
  validateExtensionProtocolPackage
} from "../app/features/extensions/extensionProtocol";

describe("ExtensionProtocol governance", () => {
  test("accepts a complete extension package with capability, handler, policy, journal, and tests", () => {
    const capability = getRegisteredActionMetadata().find(
      (candidate) => candidate.actionId === "artifact.open_tab"
    );

    if (!capability) {
      throw new Error("artifact.open_tab capability is required for this contract");
    }

    const result = validateExtensionProtocolPackage({
      capability,
      components: ["ActionBar"],
      dataSources: ["artifact.tasks"],
      handler: {
        actionId: "artifact.open_tab",
        handlerId: "artifact.open_tab.handler",
        owner: "artifact"
      },
      journal: {
        eventTypes: ["plan_preview", "action_executed"],
        replayable: true
      },
      packageId: "artifact.open_tab.extension",
      policy: {
        requiredContext: [],
        requiresConfirmation: false,
        riskLevel: "low"
      },
      tests: {
        contractTestIds: ["dynamicActionExecutor.test", "ArtifactTabs.test"]
      }
    });

    expect(result).toEqual({
      errors: [],
      valid: true
    });
  });

  test("rejects extension packages that omit governance seams or reference unknown contracts", () => {
    const capability = getRegisteredActionMetadata().find(
      (candidate) => candidate.actionId === "artifact.open_tab"
    );

    if (!capability) {
      throw new Error("artifact.open_tab capability is required for this contract");
    }

    const result = validateExtensionProtocolPackage({
      capability,
      components: ["UnknownCard"],
      dataSources: ["unknown.source"],
      handler: undefined,
      journal: {
        eventTypes: [],
        replayable: true
      },
      packageId: "broken.extension",
      policy: {
        requiredContext: [],
        requiresConfirmation: true,
        riskLevel: "high"
      },
      tests: {
        contractTestIds: []
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("handler"),
        expect.stringContaining("policy"),
        expect.stringContaining("journal"),
        expect.stringContaining("tests"),
        expect.stringContaining("Unknown component"),
        expect.stringContaining("Unknown data source")
      ])
    );
  });

  test("projects registered core capabilities into governed extension packages", () => {
    const catalog = buildCoreExtensionProtocolCatalog();
    const actionIds = catalog.packages.map((item) => item.capability.actionId);

    expect(actionIds).toEqual(
      expect.arrayContaining([
        "artifact.generate",
        "artifact.open_tab",
        "panel.open",
        "profile.open_academic_archive",
        "settings.update"
      ])
    );
    expect(catalog.errors).toEqual([]);
    expect(
      catalog.packages.every((item) => validateExtensionProtocolPackage(item).valid)
    ).toBe(true);
  });
});
