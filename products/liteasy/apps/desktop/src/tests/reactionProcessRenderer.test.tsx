import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ReactionProcessRenderer, renderReactionProcess } from "../app/features/visualization/renderers/reactionProcessRenderer";
import type { ReactionProcessSpecV1 } from "../app/features/visualization/visualizationArtifact.types";

const fixture = {
  atomMap: [],
  conditions: [],
  species: [
    { evidenceClaimIds: ["reaction-claim"], formula: "CH4", id: "ch4", state: "g" },
    { evidenceClaimIds: ["reaction-claim"], formula: "O2", id: "o2", state: "g" },
    { evidenceClaimIds: ["reaction-claim"], formula: "CO2", id: "co2", state: "g" },
    { evidenceClaimIds: ["reaction-claim"], formula: "H2O", id: "h2o", state: "l" }
  ],
  steps: [
    {
      evidenceClaimIds: ["reaction-claim"],
      id: "overall",
      products: [{ coefficient: 1, speciesId: "co2" }, { coefficient: 2, speciesId: "h2o" }],
      reactants: [{ coefficient: 1, speciesId: "ch4" }, { coefficient: 2, speciesId: "o2" }]
    }
  ]
} as const satisfies ReactionProcessSpecV1;

describe("renderReactionProcess", () => {
  test("renders a safe balanced equation projection", () => {
    const rendered = renderReactionProcess(fixture);

    expect(rendered.svg).toContain('role="img"');
    expect(rendered.svg).toContain("object-overall");
    expect(rendered.svg).toContain("CH4");
    expect(rendered.svg).not.toContain("<script");
  });

  test("supports stepwise observation in React", () => {
    render(<ReactionProcessRenderer rendered={renderReactionProcess(fixture)} />);

    expect(screen.getByRole("img", { name: /CH4/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByTestId("reaction-process-step")).toHaveTextContent("1 / 1");
  });
});
