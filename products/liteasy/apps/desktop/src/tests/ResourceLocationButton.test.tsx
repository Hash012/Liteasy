import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ResourceLocationButton } from "../app/features/resource-filesystem/ResourceLocationButton";
import { ObjectWorkbenchContext, type ObjectWorkbenchPort } from "../app/features/objects/objectWorkbenchPort";
import type { ResourceLocation } from "../app/features/resource-filesystem/liteasyPath";

test("copies a usable Liteasy Path even when the backing file is unavailable", async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const port = { scopeId: "local", describeResource: vi.fn(async () => { throw new Error("磁盘未连接"); }) } as unknown as ObjectWorkbenchPort;
  render(<ObjectWorkbenchContext.Provider value={port}><ResourceLocationButton target={{ kind: "artifact", artifactId: "deck" }} /></ObjectWorkbenchContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "位置与 Liteasy Path" }));
  expect(await screen.findByText("磁盘未连接")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "复制 Liteasy Path" }));
  expect(writeText).toHaveBeenCalledWith("liteasy://agent-artifacts/deck?scope=local");
  expect(await screen.findByText("已复制 Liteasy Path。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "在文件管理器中显示" })).toBeDisabled();
});

test("does not show a late physical location after switching accounts", async () => {
  let finish!: (value: ResourceLocation) => void;
  const first = { scopeId: "user:A", describeResource: vi.fn(() => new Promise<ResourceLocation>((resolve) => { finish = resolve; })) } as unknown as ObjectWorkbenchPort;
  const second = { scopeId: "user:B", describeResource: vi.fn() } as unknown as ObjectWorkbenchPort;
  const view = (port: ObjectWorkbenchPort) => <ObjectWorkbenchContext.Provider value={port}><ResourceLocationButton target={{ kind: "artifact", artifactId: "deck" }} /></ObjectWorkbenchContext.Provider>;
  const { rerender } = render(view(first));
  fireEvent.click(screen.getByRole("button", { name: "位置与 Liteasy Path" }));
  rerender(view(second));
  await act(async () => { finish({ liteasyPath: "old", physicalPath: "D:/AccountA/private.json", physicalKind: "file", canReveal: true }); });
  expect(screen.getByRole("textbox", { name: "Liteasy Path", exact: true })).toHaveValue("liteasy://agent-artifacts/deck?scope=user%3AB");
  expect(screen.getByRole("textbox", { name: "资源实际位置" })).not.toHaveValue("D:/AccountA/private.json");
});
