import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { CircuitRenderer, renderCircuit } from "../app/features/visualization/renderers/circuitRenderer";
import { ohmsLawFixture } from "./fixtures/staticScienceFixtures";

describe("renderCircuit", () => {
  test("renders controlled circuit symbols through safe SVG", () => {
    const rendered = renderCircuit(ohmsLawFixture());

    expect(rendered.svg).toContain('role="img"');
    expect(rendered.svg).toContain("object-battery");
    expect(rendered.svg).not.toContain("<script");
    expect(rendered.accessibility.summary).toBe("battery, resistor, wire-1, wire-2");
    expect(rendered.selectableObjectIds).toEqual(["battery", "resistor", "wire-1", "wire-2"]);
  });

  test("projects selectable components in React", () => {
    render(<CircuitRenderer rendered={renderCircuit(ohmsLawFixture())} />);

    expect(screen.getByRole("img", { name: /battery, resistor/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "battery" })).toHaveAttribute("data-object-id", "battery");
  });
});
