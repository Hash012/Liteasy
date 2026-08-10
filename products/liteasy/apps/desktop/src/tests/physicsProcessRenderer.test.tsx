import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PhysicsProcessRenderer, renderPhysicsProcess } from "../app/features/visualization/renderers/physicsProcessRenderer";
import { projectileProcessFixture } from "./fixtures/processFixtures";

describe("renderPhysicsProcess", () => {
  test("renders a safe keyframe projection", () => {
    const rendered = renderPhysicsProcess(projectileProcessFixture);

    expect(rendered.svg).toContain('role="img"');
    expect(rendered.svg).toContain("object-trajectory");
    expect(rendered.svg).not.toContain("<script");
    expect(rendered.selectableObjectIds).toEqual(["trajectory"]);
  });

  test("supports observation-only stepping in React", () => {
    render(<PhysicsProcessRenderer rendered={renderPhysicsProcess(projectileProcessFixture)} />);

    expect(screen.getByRole("img", { name: /Physics process/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "trajectory" })).toHaveAttribute("data-object-id", "trajectory");
    fireEvent.click(screen.getByRole("button", { name: "下一帧" }));
    expect(screen.getByTestId("physics-process-frame")).toHaveTextContent("1 / 60");
  });
});
