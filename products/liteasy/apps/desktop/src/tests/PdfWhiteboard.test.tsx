import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import {
  PdfWhiteboard,
  pdfWhiteboardDragMime
} from "../app/features/pdf/pdf-whiteboard/PdfWhiteboard";
import { createEmptyPdfWhiteboard } from "../app/features/pdf/pdf-whiteboard/pdfWhiteboardModel";
import type { PdfWhiteboardDocument } from "../app/features/pdf/pdf-whiteboard/pdfWhiteboard.types";

function WhiteboardHarness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [document, setDocument] = useState<PdfWhiteboardDocument>(() =>
    createEmptyPdfWhiteboard("paper-1")
  );
  return (
    <PdfWhiteboard
      document={document}
      onChange={setDocument}
      onClose={onClose}
      paperTitle="Test Paper"
    />
  );
}

test("creates a draggable whiteboard text node", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <PdfWhiteboard
      document={createEmptyPdfWhiteboard("paper-1")}
      onChange={onChange}
      onClose={vi.fn()}
      paperTitle="Test Paper"
    />
  );

  await user.click(screen.getByRole("button", { name: "文字" }));

  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange.mock.calls[0][0].nodes[0]).toMatchObject({
    content: { markdown: "" },
    kind: "markdown",
    size: { height: 120, width: 230 }
  });
  expect(screen.getByText(/已创建文字节点/u)).toBeInTheDocument();
});

test("drops a PDF excerpt at a requested whiteboard position", async () => {
  render(<WhiteboardHarness />);
  const canvas = screen.getByLabelText("可拖放的 PDF 白板画布");
  const values = new Map<string, string>([
    [pdfWhiteboardDragMime, JSON.stringify({
      kind: "markdown",
      markdown: "从正文拖入的摘录",
      source: { page: 3, paperId: "paper-1", type: "pdf" }
    })]
  ]);

  fireEvent.drop(canvas, {
    clientX: 220,
    clientY: 180,
    dataTransfer: {
      files: [],
      getData: (type: string) => values.get(type) ?? ""
    }
  });

  await waitFor(() => expect(screen.getByText("从正文拖入的摘录")).toBeInTheDocument());
  expect(screen.getByText("文字 · P3")).toBeInTheDocument();
  expect(screen.getAllByLabelText("从此节点建立连接")).toHaveLength(1);

  fireEvent.doubleClick(screen.getByLabelText("编辑白板文字", { selector: "button" }));
  const input = screen.getByLabelText("白板文字内容", { selector: "textarea" });
  await userEvent.setup().clear(input);
  await userEvent.setup().type(input, "**关键结论**");
  fireEvent.blur(input);
  expect(screen.getByText("关键结论").tagName).toBe("STRONG");
});

test("closes the whiteboard from its own header", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<WhiteboardHarness onClose={onClose} />);

  await user.click(screen.getByRole("button", { name: "收起 PDF 白板" }));
  expect(onClose).toHaveBeenCalledOnce();
});

test("pastes a screenshot as an image node", async () => {
  const onChange = vi.fn();
  render(
    <PdfWhiteboard
      document={createEmptyPdfWhiteboard("paper-1")}
      onChange={onChange}
      onClose={vi.fn()}
      paperTitle="Test Paper"
    />
  );
  const screenshot = new File([new Uint8Array([137, 80, 78, 71])], "figure.png", {
    type: "image/png"
  });

  fireEvent.paste(screen.getByLabelText("PDF 思考白板"), {
    clipboardData: {
      getData: () => "",
      items: [{ getAsFile: () => screenshot, type: "image/png" }]
    }
  });

  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange.mock.calls.at(-1)?.[0].nodes[0]).toMatchObject({
    content: {
      alt: "figure.png",
      mimeType: "image/png",
      sourceName: "figure.png"
    },
    kind: "image"
  });
  expect(onChange.mock.calls.at(-1)?.[0].nodes[0].content.dataUrl).toMatch(/^data:image\/png;base64,/u);
});
