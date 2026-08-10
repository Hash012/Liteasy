import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ThinReadingSourceFigures } from "../app/features/thin-reading/ThinReadingSourceFigures";
import { VisualizationArtifactHost } from "../app/features/visualization/VisualizationArtifactHost";
import { artifactWithSelectedObject } from "./fixtures/visualizationFixtures";

describe("thin reading deep-dive production composition", () => {
  test("source figures and semantic objects expose branchable deep-dive actions", () => {
    const onSourceTarget = vi.fn();
    const onObjectTarget = vi.fn();
    render(<FluentProvider theme={webLightTheme}>
      <ThinReadingSourceFigures
        figures={[{ evidenceIds: ["e-1"], figure: { id: "fig-1", alt: "Figure", dataUrl: "data:image/png;base64,fixture", page: 1, sourcePath: "paper.pdf" }, reason: "evidence", recommendedBy: "agent" }]}
        nodeId="node-1"
        onSelectTarget={onSourceTarget}
      />
      <VisualizationArtifactHost artifact={artifactWithSelectedObject} onDeepDiveTarget={onObjectTarget} />
    </FluentProvider>);

    fireEvent.click(screen.getByRole("button", { name: "深入整图" }));
    fireEvent.click(screen.getByRole("button", { name: "深入 Object" }));
    expect(onSourceTarget).toHaveBeenCalledWith(expect.objectContaining({ kind: "source_figure", sourceFigureId: "fig-1" }));
    expect(onObjectTarget).toHaveBeenCalledWith(expect.objectContaining({ kind: "generated_object", objectId: "object-1" }));
  });

  test("keeps fallback source figures static when no evidence binds them", () => {
    render(<FluentProvider theme={webLightTheme}>
      <ThinReadingSourceFigures
        figures={[{ evidenceIds: [], figure: { id: "fig-fallback", alt: "Fallback", dataUrl: "data:image/png;base64,fixture", page: 1, sourcePath: "paper.pdf" }, reason: "related", recommendedBy: "fallback" }]}
        nodeId="node-1"
        onSelectTarget={vi.fn()}
      />
    </FluentProvider>);

    expect(screen.getAllByRole("img", { name: "Fallback" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "深入整图" })).toBeNull();
    expect(screen.queryByRole("button", { name: "选择区域" })).toBeNull();
  });
});
