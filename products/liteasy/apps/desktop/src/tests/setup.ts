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
