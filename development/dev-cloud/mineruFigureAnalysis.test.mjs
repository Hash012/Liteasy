import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMineruFigures } from "./mineruFigureAnalysis.mjs";

test("sends every MinerU image to the visual model and keeps its selected interpretation", async () => {
  let receivedInput;
  const result = await analyzeMineruFigures({
    apiBaseUrl: "https://api.example.test/v1",
    apiKey: "sk-test",
    figures: [
      { alt: "Figure one", dataUrl: "data:image/png;base64,AA==", id: "figure-1", page: 1, sourcePath: "images/1.png" },
      { alt: "Figure two", dataUrl: "data:image/png;base64,BB==", id: "figure-2", page: 4, sourcePath: "images/2.png" }
    ],
    model: "gpt-5.6-terra",
    paperTitle: "A paper",
    providerFactory: () => async (input) => {
      receivedInput = input;
      return JSON.stringify({
        figures: [
          {
            description: "Shows the core architecture.",
            id: "figure-1",
            importance: "primary",
            kind: "architecture",
            placement: "method",
            selectionReason: "It explains the main mechanism.",
            title: "Core architecture"
          },
          {
            description: "An auxiliary ablation.",
            id: "figure-2",
            importance: "reference",
            kind: "chart",
            placement: "results",
            selectionReason: "Keep it available for verification.",
            title: "Ablation result"
          }
        ]
      });
    }
  });

  assert.equal(
    receivedInput.input[0].content.filter((item) => item.type === "input_image").length,
    2
  );
  assert.deepEqual(result.selectedFigureIds, ["figure-1"]);
  assert.equal(result.figures[0].analysis.title, "Core architecture");
  assert.equal(result.figures[1].analysis.importance, "reference");
});
