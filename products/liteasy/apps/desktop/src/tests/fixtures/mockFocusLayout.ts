import { vi } from "vitest";

/**
 * jsdom has no layout: offsetParent is always null and the body has zero size.
 * Tabster treats that as a hidden document and can hide an otherwise open modal
 * after its deferred focus update. Supply geometry only for focus-based tests;
 * leave real hidden elements hidden and keep the actual focus/ARIA logic active.
 */
export function mockFocusLayout() {
  const bodyRect = vi.spyOn(document.body, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 1024, 768));
  const offsetParent = vi.spyOn(HTMLElement.prototype, "offsetParent", "get")
    .mockImplementation(function (this: HTMLElement) {
      if (!this.isConnected || this === document.body) return null;
      for (let node: HTMLElement | null = this; node; node = node.parentElement) {
        if (node.hidden || getComputedStyle(node).display === "none") return null;
        const parent = node.parentElement;
        if (parent instanceof HTMLDetailsElement && !parent.open && node.tagName !== "SUMMARY") return null;
      }
      return this.parentElement;
    });
  return () => { offsetParent.mockRestore(); bodyRect.mockRestore(); };
}
