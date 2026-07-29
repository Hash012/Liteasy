import { describe, expect, test } from "vitest";
import { validateCitesTargetRecord } from "../../scripts/thin-reading-openalex-live-eval.mjs";

describe("thinReadingOpenAlexLiveEval", () => {
  test("accepts a source record that explicitly cites the target work", () => {
    expect(validateCitesTargetRecord({
      source: {
        display_name: "Highly accurate protein structure prediction with AlphaFold",
        id: "https://openalex.org/W3177828909",
        referenced_works: ["https://openalex.org/W2963341956"]
      },
      target: { id: "https://openalex.org/W2963341956" }
    })).toEqual([]);
  });

  test("rejects a source whose graph no longer contains the target citation", () => {
    expect(validateCitesTargetRecord({
      source: {
        display_name: "Highly accurate protein structure prediction with AlphaFold",
        id: "https://openalex.org/W3177828909",
        referenced_works: []
      },
      target: { id: "https://openalex.org/W2963341956" }
    })).toContain("OpenAlex no longer reports W3177828909 as citing W2963341956");
  });
});
