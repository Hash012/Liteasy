import { describe, expect, test } from "vitest";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";
import { validateSemanticActionPlan } from "../app/features/agent-runtime/planValidator";

const allowedFamilies = new Set([
  "artifact",
  "cloud",
  "collection",
  "layout",
  "organization",
  "panel",
  "plugin",
  "profile",
  "recommendation",
  "selection",
  "settings",
  "theme",
  "workspace"
]);

const allowedCosts = new Set(["none", "local_compute", "cloud_tokens", "paid_resource"]);
const allowedRiskLevels = new Set(["low", "medium", "high"]);

describe("capability metadata contract", () => {
  test("all registered actions expose complete capability metadata", () => {
    for (const capability of getRegisteredActionMetadata()) {
      expect(typeof capability.actionId).toBe("string");
      expect(capability.actionId.length).toBeGreaterThan(0);
      expect(typeof capability.label).toBe("string");
      expect(capability.label.length).toBeGreaterThan(0);
      expect(allowedFamilies.has(capability.family)).toBe(true);
      expect(capability.inputSchema).toMatchObject({ type: "object" });
      expect(capability.outputSchema).toMatchObject({ type: "object" });
      expect(typeof capability.reversible).toBe("boolean");
      expect(typeof capability.estimatedLatencyMs).toBe("number");
      expect(allowedCosts.has(capability.estimatedCost)).toBe(true);
      expect(Array.isArray(capability.requiredContext)).toBe(true);
      expect(typeof capability.requiresConfirmation).toBe("boolean");
      expect(allowedRiskLevels.has(capability.riskLevel)).toBe(true);

      if (capability.inverseActionId) {
        expect(
          getRegisteredActionMetadata().some(
            (candidate) => candidate.actionId === capability.inverseActionId
          )
        ).toBe(true);
      }
    }
  });

  test("registered actions are atomic and uniquely owned by one capability family", () => {
    const capabilities = getRegisteredActionMetadata();
    const ids = capabilities.map((capability) => capability.actionId);

    expect(new Set(ids).size).toBe(ids.length);

    for (const capability of capabilities) {
      expect(capability.family).toBeTruthy();
      expect(capability.riskLevel).toBeTruthy();
      expect(capability.requiredContext.every((item) => typeof item === "string")).toBe(true);
    }
  });

  test("semantic frames declare reusable concepts and schema-valid action inputs", () => {
    const registeredActions = getRegisteredActionMetadata();

    for (const capability of getRegisteredActionMetadata()) {
      for (const frame of capability.semantic?.frames ?? []) {
        expect(frame.frameId).toContain(capability.actionId);
        expect(frame.intentId.length).toBeGreaterThan(0);
        expect(frame.summary.length).toBeGreaterThan(0);
        expect(frame.signals.length).toBeGreaterThan(0);
        expect(
          validateSemanticActionPlan(
            {
              actions: [
                {
                  actionId: capability.actionId,
                  input: frame.input
                }
              ],
              confidence: "high",
              intentId: frame.intentId as never,
              planId: `contract-${frame.frameId}`,
              requiredContext: frame.requiredContext ?? capability.requiredContext,
              requiresConfirmation: frame.requiresConfirmation ?? capability.requiresConfirmation,
              riskLevel: frame.riskLevel ?? capability.riskLevel,
              summary: frame.summary
            },
            {
              mode: "command",
              registeredActions
            }
          ).valid
        ).toBe(true);

        for (const signal of frame.signals) {
          expect(signal.concept.length).toBeGreaterThan(0);
          expect(signal.aliases.length).toBeGreaterThan(0);
          expect(signal.weight).toBeGreaterThan(0);
        }
      }
    }
  });

  test("profile and high-risk workspace capabilities require confirmation", () => {
    const capabilities = getRegisteredActionMetadata();

    expect(
      capabilities.find((capability) => capability.actionId === "workspace.delete_documents")
    ).toMatchObject({
      requiresConfirmation: true,
      riskLevel: "high"
    });

    expect(
      capabilities.find((capability) => capability.actionId === "settings.update")
    ).toMatchObject({
      family: "settings",
      inputSchema: {
        required: ["target", "value"]
      }
    });
  });
});
