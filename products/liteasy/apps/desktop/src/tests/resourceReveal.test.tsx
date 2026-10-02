import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { MarkdownContent } from "../app/features/markdown/MarkdownContent";
import { ReferenceSourceContext } from "../app/features/resource-links/ResourceReferencesContext";
import { revealOffset, revealResource } from "../app/features/resource-links/resourceReveal";

test("a verified locator survives mounting and rerendering without changing text", async () => {
  const path = "liteasy://objects/note?scope=local";
  const renderContent = () => <ReferenceSourceContext.Provider value={`${path}&revision=one`}><MarkdownContent value={"# Header\n\nEpisodic memory target\n\nLast paragraph"} renderResourceImage={() => null} /></ReferenceSourceContext.Provider>;
  act(() => revealResource({ path, line: 3, quote: "Episodic memory" }));
  const view = render(renderContent());
  expect(screen.getByText("Episodic memory target")).toHaveClass("resource-search-location");
  view.rerender(renderContent());
  await act(async () => {});
  expect(screen.getByText("Episodic memory target")).toHaveClass("resource-search-location");
  expect(revealOffset("old\nmatch\nnew match", { path, line: 3, quote: "match", expires: Date.now() + 1000 })).toBe(14);
});

test("a different account cannot consume a pending locator", () => {
  const scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
  act(() => revealResource({ path: "liteasy://objects/note?scope=user-a", line: 1, quote: "private" }));
  render(<ReferenceSourceContext.Provider value="liteasy://objects/note?scope=user-b"><MarkdownContent value="private" /></ReferenceSourceContext.Provider>);
  expect(scroll).not.toHaveBeenCalled(); expect(screen.getByText("private")).not.toHaveClass("resource-search-location");
});
