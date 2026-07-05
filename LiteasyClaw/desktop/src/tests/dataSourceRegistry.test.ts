import { describe, expect, test } from "vitest";
import { resolveUIDslDataSource } from "../app/features/generative-ui/dataSourceRegistry";

describe("resolveUIDslDataSource", () => {
  test("resolves retrieval citations from the resolver context", () => {
    expect(
      resolveUIDslDataSource(
        {
          id: "citations",
          params: {},
          sourceId: "retrieval.citations"
        },
        {
          citations: [
            {
              page: 4,
              paperId: "demo-2",
              snippet: "vector database systems"
            }
          ]
        }
      )
    ).toEqual([
      {
        page: 4,
        paperId: "demo-2",
        snippet: "vector database systems"
      }
    ]);
  });

  test("returns redacted profile summaries only when provided by owner feature", () => {
    expect(
      resolveUIDslDataSource(
        {
          id: "profile",
          params: {},
          sourceId: "profile.summary"
        },
        {
          profileSummary: {
            enabled: true,
            basis: ["用户确认开启画像"],
            fields: ["research_interests"]
          }
        }
      )
    ).toEqual({
      enabled: true,
      basis: ["用户确认开启画像"],
      fields: ["research_interests"]
    });
  });
});
