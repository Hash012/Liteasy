import { expect, test } from "vitest";
import { pdfVisiblePage } from "../app/features/pdf/pdfVisiblePage";

test("opening the short final PDF page survives intermediate scroll events near the bottom", () => {
  const viewport = { top: 177, bottom: 943 };
  for (const offset of [0, 11, 23, 24]) {
    const pages = [{ page: 1, top: 129.5 - offset, bottom: 519.5 - offset },
      { page: 2, top: 525.5 - offset, bottom: 967.3 - offset }];
    expect(pdfVisiblePage(viewport, pages, 1)).toBe(2);
    expect(pdfVisiblePage(viewport, pages, 2)).toBe(2);
  }
});

test("explicit navigation remains stable when both short pages fit in the viewport", () => {
  const pages = [{ page: 1, top: 10, bottom: 200 }, { page: 2, top: 210, bottom: 400 }];
  for (const selected of [1, 2]) expect(pdfVisiblePage({ top: 0, bottom: 500 }, pages, selected)).toBe(selected);
});

test("manual scrolling selects the page with the most visible content", () => {
  const pages = [{ page: 1, top: -800, bottom: 200 }, { page: 2, top: 210, bottom: 1210 }];
  expect(pdfVisiblePage({ top: 0, bottom: 700 }, pages, 1)).toBe(2);
  expect(pdfVisiblePage({ top: -700, bottom: 0 }, pages, 2)).toBe(1);
  expect(pdfVisiblePage({ top: 0, bottom: 700 }, [], 2)).toBe(2);
  expect(pdfVisiblePage({ top: 0, bottom: 0 }, pages, 2)).toBe(2);
});
