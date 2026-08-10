import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BiologyStructureRenderer, renderBiologyStructure } from "../app/features/visualization/renderers/biologyStructureRenderer";
import { neuralFixture } from "./fixtures/staticScienceFixtures";

describe("renderBiologyStructure", () => {
  test("renders evidence-bound structures through safe SVG", () => {
    const rendered = renderBiologyStructure(neuralFixture());

    expect(rendered.svg).toContain('role="img"');
    expect(rendered.svg).not.toContain("<script");
    expect(rendered.selectableObjectIds).toEqual(["neuron", "soma", "axon", "synapse", "connection-1"]);
  });

  test("projects structures and neural connections as selectable objects", () => {
    render(<BiologyStructureRenderer rendered={renderBiologyStructure(neuralFixture())} />);

    expect(screen.getByRole("img", { name: /神经元, 胞体, 轴突, 突触/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "connection-1" })).toHaveAttribute("data-object-id", "connection-1");
  });
});
