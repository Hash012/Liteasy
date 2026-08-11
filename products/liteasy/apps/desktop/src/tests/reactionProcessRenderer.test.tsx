import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  projectReactionScene,
  ReactionProcessRenderer,
  renderReactionProcess
} from "../app/features/visualization/renderers/reactionProcessRenderer";
import type { ReactionProcessSpecV1 } from "../app/features/visualization/visualizationArtifact.types";

const fixture = {
  atomMap: [],
  conditions: [{ evidenceClaimIds: ["reaction-claim"], id: "ignition", label: "点火", value: "已提供" }],
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
  test("renders distinct evidence-bounded reactant, transition and product scenes", () => {
    const rendered = renderReactionProcess(fixture);
    const reactants = projectReactionScene(fixture, rendered, rendered.scenes, 0, null);
    const transition = projectReactionScene(fixture, rendered, rendered.scenes, 1, null);
    const products = projectReactionScene(fixture, rendered, rendered.scenes, 2, null);

    expect(rendered.scenes.map((scene) => scene.phase)).toEqual(["reactants", "transition", "products"]);
    expect(reactants.svg).not.toEqual(transition.svg);
    expect(transition.svg).not.toEqual(products.svg);
    expect(transition.svg).toContain("点火: 已提供");
    expect(transition.svg).toContain('data-scene-phase="transition"');
    expect(transition.svg).not.toContain("<script");
    expect(transition.svg).not.toContain("molecule-3d");
  });

  test("changes the SVG selection state for species and reaction steps", () => {
    const rendered = renderReactionProcess(fixture);
    const plain = projectReactionScene(fixture, rendered, rendered.scenes, 0, null);
    const speciesSelected = projectReactionScene(fixture, rendered, rendered.scenes, 0, "ch4");
    const stepSelected = projectReactionScene(fixture, rendered, rendered.scenes, 0, "overall");

    expect(speciesSelected.svg).not.toEqual(plain.svg);
    expect(stepSelected.svg).not.toEqual(plain.svg);
    expect(speciesSelected.svg).toContain('stroke="#0F6CBD" stroke-width="3"');
  });

  test("supports stepping, seeking and playback", async () => {
    vi.useFakeTimers();
    render(<ReactionProcessRenderer rendered={renderReactionProcess(fixture)} />);

    const initialSvg = screen.getByRole("img", { name: /反应物/ }).outerHTML;
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByTestId("reaction-process-step")).toHaveTextContent("1 / 2");
    expect(screen.getByRole("img", { name: /反应转化/ }).outerHTML).not.toEqual(initialSvg);
    fireEvent.change(screen.getByRole("slider", { name: "反应步骤" }), { target: { value: "0" } });
    expect(screen.getByTestId("reaction-process-step")).toHaveTextContent("0 / 2");

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(850));
    expect(screen.getByTestId("reaction-process-step")).toHaveTextContent("1 / 2");
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    vi.useRealTimers();
  });
});
