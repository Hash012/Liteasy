import "@testing-library/jest-dom";

if (typeof ResizeObserver === "undefined") {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.assign(globalThis, { ResizeObserver: TestResizeObserver });
}
