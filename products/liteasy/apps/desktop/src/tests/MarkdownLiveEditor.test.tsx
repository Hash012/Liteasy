import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { expect, test } from "vitest";
import { MarkdownLiveEditor } from "../app/features/markdown/MarkdownLiveEditor";

function Harness() {
  const [text, setText] = useState("# Title\n\n**Source** with $x^2$.\n\nLast block.");
  return <><MarkdownLiveEditor documentKey="test" value={text} onChange={setText} /><output data-testid="stored-source">{text}</output><button onClick={() => setText("# External revision")}>载入其他版本</button></>;
}

test("live blocks preserve Markdown source, toolbar undo, and discard undo on an external revision", async () => {
  render(<Harness />);
  await screen.findByRole("heading", { name: "Title" });
  const view = EditorView.findFromDOM(screen.getByRole("textbox", { name: "Markdown 正文" }))!;
  const before = view.state.doc.toString(), start = before.indexOf("Source");
  act(() => view.dispatch({ selection: { anchor: start, head: start + 6 } }));
  fireEvent.click(screen.getByRole("button", { name: "删除线", exact: true }));
  expect(screen.getByTestId("stored-source").textContent).toContain("**~~Source~~**");
  fireEvent.click(screen.getByRole("button", { name: "撤销", exact: true }));
  expect(screen.getByTestId("stored-source").textContent).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "载入其他版本" }));
  await waitFor(() => expect(view.state.doc.toString()).toBe("# External revision"));
  expect(screen.getByRole("button", { name: "撤销", exact: true })).toBeDisabled();
});
