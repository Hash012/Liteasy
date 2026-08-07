import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

Object.defineProperty(globalThis, "NodeFilter", {
  configurable: true,
  value: window.NodeFilter ?? { FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3, SHOW_ELEMENT: 1 }
});

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
