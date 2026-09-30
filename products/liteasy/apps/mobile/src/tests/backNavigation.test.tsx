import { act, render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { navigateBack, useBackHandler } from "../app/features/navigation/backNavigation";

test("system back handles the top layer first and removes handlers after unmount", () => {
  const closeReader = vi.fn(); const closePanel = vi.fn();
  function Layers({ panel }: { panel: boolean }) { useBackHandler(true, closeReader, 10); useBackHandler(panel, closePanel, 40); return null; }
  const view = render(<Layers panel />);
  act(() => { expect(navigateBack()).toBe(true); });
  expect(closePanel).toHaveBeenCalledOnce(); expect(closeReader).not.toHaveBeenCalled();
  view.rerender(<Layers panel={false} />); act(() => { navigateBack(); }); expect(closeReader).toHaveBeenCalledOnce();
  view.unmount(); expect(navigateBack()).toBe(false);
});
