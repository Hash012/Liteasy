import { vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(""),
  convertFileSrc: () => "",
}));

vi.mock("pdfjs-dist", () => {
  const mockPDFDocumentProxy = {
    numPages: 1,
    getPage: () => Promise.resolve({
      getViewport: () => ({ width: 600, height: 800, clone: () => ({ width: 600, height: 800 }) }),
      getTextContent: () => Promise.resolve({ items: [] }),
      render: () => ({ promise: Promise.resolve() }),
    }),
    destroy: () => {},
  };
  return {
    default: {
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({
        promise: Promise.resolve(mockPDFDocumentProxy),
      }),
      TextLayer: class {
        render() { return Promise.resolve(); }
      },
    },
    getDocument: () => ({
      promise: Promise.resolve(mockPDFDocumentProxy),
    }),
    GlobalWorkerOptions: { workerSrc: "" },
    TextLayer: class {
      render() { return Promise.resolve(); }
    },
  };
});

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/fake-worker.js",
}));

import { ReaderPane } from "../app/features/reader/ReaderPane";

test("renders reader pane structure with no file path", () => {
  render(
    <ReaderPane
      filePath=""
      pageNumber={1}
      scale={1.2}
      highlights={[]}
      onPageChange={() => {}}
      onScaleChange={() => {}}
      onTotalPages={() => {}}
      onTextSelect={() => {}}
    />,
  );

  // Verify the toolbar renders
  expect(screen.getByText(/页/)).toBeInTheDocument();
  expect(screen.getByText("◀")).toBeInTheDocument();
  expect(screen.getByText("▶")).toBeInTheDocument();
});
