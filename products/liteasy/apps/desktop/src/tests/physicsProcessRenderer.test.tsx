import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  PhysicsProcessRenderer,
  projectPhysicsProcess,
  renderPhysicsProcess
} from "../app/features/visualization/renderers/physicsProcessRenderer";
import { simulatePhysicsProcess } from "../app/features/visualization/kernels/physicsProcessKernel";
import { projectileProcessFixture } from "./fixtures/processFixtures";

describe("renderPhysicsProcess", () => {
  test("projects only the travelled trajectory and current state", () => {
    const simulation = simulatePhysicsProcess(projectileProcessFixture);
    const first = projectPhysicsProcess(projectileProcessFixture, simulation, 0, null);
    const tenth = projectPhysicsProcess(projectileProcessFixture, simulation, 10, null);

    expect(first.svg).toContain('data-frame-index="0"');
    expect(tenth.svg).toContain('data-frame-index="10"');
    expect(first.svg).not.toEqual(tenth.svg);
    expect((first.svg.match(/ L /gu) ?? []).length).toBeLessThan((tenth.svg.match(/ L /gu) ?? []).length);
    expect(tenth.svg).not.toContain("<script");
  });

  test("selection changes the actual trajectory projection", () => {
    const simulation = simulatePhysicsProcess(projectileProcessFixture);
    const plain = projectPhysicsProcess(projectileProcessFixture, simulation, 10, null);
    const selected = projectPhysicsProcess(projectileProcessFixture, simulation, 10, "trajectory");

    expect(selected.svg).not.toEqual(plain.svg);
    expect(selected.svg).toContain('stroke-width="5"');
  });

  test("supports playback, stepping, timeline seeking and parameter resampling", async () => {
    render(<PhysicsProcessRenderer rendered={renderPhysicsProcess(projectileProcessFixture)} />);
    await waitFor(() => expect(screen.getByTestId("physics-process-runtime")).toHaveAttribute("data-runtime", "fallback"));

    expect(screen.getByRole("img", { name: /Physics process/ })).toBeInTheDocument();
    const initialSvg = screen.getByRole("img", { name: /Physics process/ }).outerHTML;
    fireEvent.click(screen.getByRole("button", { name: "下一帧" }));
    expect(screen.getByTestId("physics-process-frame")).toHaveTextContent("1 / 60");
    expect(screen.getByRole("img", { name: /Physics process/ }).outerHTML).not.toEqual(initialSvg);

    fireEvent.change(screen.getByRole("slider", { name: "时间" }), { target: { value: "12" } });
    expect(screen.getByTestId("physics-process-frame")).toHaveTextContent("12 / 60");

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 100)));
    expect(screen.getByTestId("physics-process-frame")).not.toHaveTextContent("12 / 60");
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));

    fireEvent.change(screen.getByRole("slider", { name: "参数 g" }), { target: { value: "9.2" } });
    expect(screen.getByRole("slider", { name: "参数 g" })).toHaveValue("9.2");
    await waitFor(() => expect(screen.getByTestId("physics-process-runtime")).toHaveAttribute("data-runtime", "fallback"));
  });
});
