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
      onSelect={onSelect}
    /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "深入整图" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "source_figure", sourceFigureId: "fig-1" }));
    expect(screen.getByRole("button", { name: "选择区域" })).toBeInTheDocument();
  });

  test("uses the loaded native image box and pixels for a letterboxed region", () => {
    const onSelect = vi.fn();
    render(<FluentProvider theme={webLightTheme}><SourceFigureSelectionOverlay
      figure={{ id: "fig-1", alt: "Figure", dataUrl: "data:image/png;base64,fixture", page: 1, sourcePath: "paper.pdf" }}
      nodeId="node-1"
      evidenceIds={["e-1"]}
      onSelect={onSelect}
    /></FluentProvider>);
    const wrapper = screen.getByTestId("source-figure-selection-image");
    const image = wrapper.querySelector("img");
    if (!image) throw new Error("expected source image");
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
      bottom: 300, height: 300, left: 0, right: 600, top: 0, width: 600, x: 0, y: 0,
      toJSON: () => ({})
    });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      bottom: 250, height: 200, left: 100, right: 500, top: 50, width: 400, x: 100, y: 50,
      toJSON: () => ({})
    });
    Object.defineProperties(image, {
      naturalHeight: { configurable: true, value: 800 },
      naturalWidth: { configurable: true, value: 1600 }
    });
    fireEvent.load(image);

    fireEvent(image, new MouseEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 100 }));
    fireEvent(image, new MouseEvent("pointermove", { bubbles: true, clientX: 360, clientY: 190 }));
    fireEvent(image, new MouseEvent("pointerup", { bubbles: true, clientX: 360, clientY: 190 }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      bbox: { height: 0.45, width: 0.4, x: 0.25, y: 0.25 },
      kind: "source_region",
      sourcePixelSize: { height: 800, width: 1600 }
    }));
  });
});
