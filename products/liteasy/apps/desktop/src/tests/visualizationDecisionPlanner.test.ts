import { describe, expect, test } from "vitest";
import {
  buildVisualizationDecisionPrompt,
  materializeVisualizationIntent,
  parseVisualizationDecisionOutput,
  runVisualizationDecisionPlanner
} from "../app/features/visualization/visualizationDecisionPlanner";

const evidence = [{
  id: "evidence-function",
  page: 3,
  quote: "For f(x) = x^2 on -1 <= x <= 2, the vertex is (0, 0)."
}];

describe("visualization decision planner", () => {
  test("builds a short evidence-bounded rubric instead of delegating the decision to prose generation", () => {
    const prompt = buildVisualizationDecisionPrompt({
      evidence,
      question: "Explain the bounded function and request a visual only when it materially helps.",
      requestedBy: "automatic",
      title: "Bounded function"
    });

    expect(prompt).toContain("独立判断是否需要受控可视化");
    expect(prompt).toContain("bounded_function_relationship");
    expect(prompt).toContain("temporal_physics");
    expect(prompt).toContain("总反应式或配平关系");
    expect(prompt).toContain("evidence-function");
    expect(prompt).not.toContain("visualizationIntent");
  });

  test("maps a reviewed decision basis to one controlled modality", () => {
    const decision = parseVisualizationDecisionOutput(JSON.stringify({
      basis: "bounded_function_relationship",
      decision: "generate",
      evidenceIds: ["evidence-function"],
      rationale: "The domain, vertex, and boundary values define a graph whose shape carries the result."
    }), { allowedEvidenceIds: ["evidence-function"] });

    expect(materializeVisualizationIntent(decision, "automatic")).toEqual({
      candidateModalities: ["function_plot"],
      evidenceIds: ["evidence-function"],
      expectedLearningGain: "high",
      purpose: "show_geometry",
      requestedBy: "automatic"
    });
  });

  test("fails closed on contradictory decisions or evidence outside the allowlist", () => {
    expect(() => parseVisualizationDecisionOutput(JSON.stringify({
      basis: "plain_text_sufficient",
      decision: "generate",
      evidenceIds: ["evidence-function"],
      rationale: "This contradictory result must not be accepted by the deterministic parser."
    }), { allowedEvidenceIds: ["evidence-function"] })).toThrow("visualization_decision_inconsistent");

    expect(() => parseVisualizationDecisionOutput(JSON.stringify({
      basis: "bounded_function_relationship",
      decision: "generate",
      evidenceIds: ["evidence-unknown"],
      rationale: "The decision cites evidence that was not supplied to the production planner."
    }), { allowedEvidenceIds: ["evidence-function"] })).toThrow("visualization_decision_evidence_invalid");

    const omitted = parseVisualizationDecisionOutput(JSON.stringify({
      basis: "plain_text_sufficient",
      decision: "omit",
      evidenceIds: [],
      rationale: "A single definition is already clearer and more precise as text."
    }), { allowedEvidenceIds: ["evidence-function"] });
    expect(materializeVisualizationIntent(omitted, "automatic")).toBeNull();
  });

  test("uses one bounded repair attempt and returns the deterministic materialized intent", async () => {
    const responses = [
      JSON.stringify({
        basis: "plain_text_sufficient",
        decision: "generate",
        evidenceIds: ["evidence-function"],
        rationale: "This intentionally contradictory first response must enter the normal repair path."
      }),
      JSON.stringify({
        basis: "bounded_function_relationship",
        decision: "generate",
        evidenceIds: ["evidence-function"],
        rationale: "The bounded function shape and key point carry material explanatory value."
      })
    ];
    const prompts: string[] = [];
    const result = await runVisualizationDecisionPlanner({
      evidence,
      generate: async ({ prompt }) => {
        prompts.push(prompt);
        return { text: responses[prompts.length - 1] };
      },
      question: "Explain the bounded function.",
      requestedBy: "automatic",
      title: "Bounded function"
    });

    expect(result.attempts.map(({ accepted }) => accepted)).toEqual([false, true]);
    expect(prompts[1]).toContain("visualization_decision_inconsistent");
    expect(result.intent?.candidateModalities).toEqual(["function_plot"]);
  });
});
