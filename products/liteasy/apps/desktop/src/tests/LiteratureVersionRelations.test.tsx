import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LiteratureVersionRelations } from "../app/features/forum/LiteratureVersionRelations";

describe("LiteratureVersionRelations", () => {
  test("shows an evidenced published version without merging it into the current preprint", async () => {
    const loadRelations = vi.fn(async () => ({
      literatureId: "literature-preprint",
      versions: [{
        direction: "from_current" as const,
        literature: {
          authors: ["A. Author"],
          identifiers: [{ kind: "doi" as const, source: "public_registry" as const, value: "10.1000/publication" }],
          literatureId: "literature-publication",
          provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry" as const, provider: "crossref" as const },
          revision: 1,
          status: "confirmed" as const,
          title: "Published Version",
          year: 2026
        },
        relation: {
          createdAt: "2026-08-09T00:00:00.000Z",
          evidence: { recordUrl: "https://registry.example.test/relation" },
          fromLiteratureId: "literature-preprint",
          provider: "crossref" as const,
          relationType: "is_preprint_of" as const,
          toLiteratureId: "literature-publication",
          verificationStatus: "confirmed" as const
        }
      }]
    }));

    render(<LiteratureVersionRelations literatureId="literature-preprint" loadRelations={loadRelations} />);

    expect(await screen.findByText("已有正式发表版")).toBeInTheDocument();
    expect(screen.getByText("Published Version")).toBeInTheDocument();
    expect(screen.getByText("DOI 10.1000/publication")).toBeInTheDocument();
    expect(loadRelations).toHaveBeenCalledWith("literature-preprint");
  });

  test("stays quiet when no authenticated relation loader is available", () => {
    const { container } = render(<LiteratureVersionRelations literatureId="literature-preprint" />);
    expect(container).toBeEmptyDOMElement();
  });
});
