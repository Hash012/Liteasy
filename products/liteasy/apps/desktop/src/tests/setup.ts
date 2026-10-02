import "@testing-library/jest-dom";
import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { webcrypto } from "node:crypto";

if (typeof globalThis.DOMMatrix === "undefined") {
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
}

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto
  });
}

if (typeof ResizeObserver === "undefined") {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.assign(globalThis, { ResizeObserver: TestResizeObserver });
}

// CodeMirror measures text ranges in a real browser. JSDOM has no layout engine;
// layout, scrolling and cursor placement are covered by the browser suite.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}
