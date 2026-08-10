import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Geometry3DRenderer, renderGeometry3D } from "../app/features/visualization/renderers/geometry3dRenderer";
import { cubeSectionFixture } from "./fixtures/interactiveMathFixtures";

describe("renderGeometry3D", () => {
  test("renders a safe fallback projection for a validated 3D section", () => {
    const rendered = renderGeometry3D(cubeSectionFixture);

    expect(rendered.svg).toContain('role="img"');
    expect(rendered.svg).toContain("object-cube");
    expect(rendered.svg).toContain("object-mid-section");
    expect(rendered.svg).not.toContain("<script");
    expect(rendered.selectableObjectIds).toEqual(["cube", "mid-section"]);
  });

  test("projects selectable 3D objects in React", () => {
    render(<Geometry3DRenderer rendered={renderGeometry3D(cubeSectionFixture)} />);

    expect(screen.getByRole("img", { name: /cube/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "cube" })).toHaveAttribute("data-object-id", "cube");
    expect(screen.getByText("6 section vertices")).toBeInTheDocument();
  });
});
