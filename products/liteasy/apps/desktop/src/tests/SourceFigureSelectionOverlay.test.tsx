import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SourceFigureSelectionOverlay } from "../app/features/thin-reading/SourceFigureSelectionOverlay";

describe("SourceFigureSelectionOverlay", () => {
  test("offers keyboard deep-dive actions and emits a whole-figure target", () => {
    const onSelect = vi.fn();
    render(<FluentProvider theme={webLightTheme}><SourceFigureSelectionOverlay
      figure={{ id: "fig-1", alt: "Figure", dataUrl: "data:image/png;base64,fixture", page: 1, sourcePath: "paper.pdf" }}
      nodeId="node-1"
      evidenceIds={["e-1"]}
      sourcePixelSize={{ width: 1600, height: 800 }}
      onSelect={onSelect}
    /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "深入整图" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "source_figure", sourceFigureId: "fig-1" }));
    expect(screen.getByRole("button", { name: "选择区域" })).toBeInTheDocument();
  });

  test("shows the bounded drag rectangle over the source image", () => {
    render(<FluentProvider theme={webLightTheme}><SourceFigureSelectionOverlay
      figure={{ id: "fig-1", alt: "Figure", dataUrl: "data:image/png;base64,fixture", page: 1, sourcePath: "paper.pdf" }}
      nodeId="node-1"
      evidenceIds={["e-1"]}
      sourcePixelSize={{ width: 1600, height: 800 }}
      onSelect={vi.fn()}
    /></FluentProvider>);
    const image = screen.getByTestId("source-figure-selection-image");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      bottom: 250,
      height: 200,
      left: 100,
      right: 500,
      top: 50,
      width: 400,
      x: 100,
      y: 50,
      toJSON: () => ({})
    });

    fireEvent(image, new MouseEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 100 }));
    fireEvent(image, new MouseEvent("pointermove", { bubbles: true, clientX: 360, clientY: 190 }));

    expect(screen.getByTestId("source-figure-selection-rect")).toHaveStyle({
      height: "45%",
      left: "25%",
      top: "25%",
      width: "40%"
    });
  });
});
