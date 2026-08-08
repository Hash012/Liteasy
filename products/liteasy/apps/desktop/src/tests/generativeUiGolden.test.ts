import { describe, expect, test } from "vitest";
import { generateGoldenIntentUIDslDocuments } from "../app/features/generative-ui/uiDslGenerator";
import { validateUIDslDocument } from "../app/features/generative-ui/uiDslValidator";

describe("golden generative UI intents", () => {
  test("generates stable valid dsl for ten golden intents", () => {
    const documents = generateGoldenIntentUIDslDocuments();

    expect(documents).toHaveLength(10);
    expect(documents.map((document) => document.id)).toEqual([
      "ui-golden-theme-cartoon",
      "ui-golden-theme-reset",
      "ui-golden-layout-split",
      "ui-golden-layout-reset",
      "ui-golden-panel-open",
      "ui-golden-panel-close",
      "ui-golden-artifact-comparison",
      "ui-golden-artifact-mindmap",
      "ui-golden-selection-import",
      "ui-golden-evidence-answer"
    ]);
    expect(documents.every((document) => validateUIDslDocument(document).valid)).toBe(true);
  });
});
