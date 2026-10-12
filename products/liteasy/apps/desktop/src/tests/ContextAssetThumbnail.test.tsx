import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContextAssetBrowser } from "../app/features/assistant/ContextAssetBrowser";
import { ContextAssetThumbnail } from "../app/features/assistant/ContextAssetThumbnail";
const image = { text: "", images: [{ url: "data:image/png;base64,AA==", label: "图一" }] };
const asset = { id: "image", trigger: "@" as const, label: "图一", category: "图片", token: { id: "image", kind: "object" as const, label: "图一", prompt: "" } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function raster() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob())));
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 320, height: 160, close: vi.fn() })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/webp;base64,thumbnail");
}
it("shows an image before selecting or previewing it, without capturing context", async () => {
  raster(); const loadThumbnail = vi.fn(async () => image); const loadPreview = vi.fn(); const add = vi.fn();
  render(<ContextAssetBrowser suggestions={[{ ...asset, loadThumbnail, loadPreview }]} onClose={vi.fn()} onAddContextToken={add} />);
  expect(await screen.findByRole("img", { name: "图一 缩略图" })).toHaveAttribute("src", "data:image/webp;base64,thumbnail");
  expect(loadThumbnail).toHaveBeenCalledOnce(); expect(loadPreview).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled();
});
it("defers offscreen thumbnails until they enter the viewport", async () => {
  raster(); let intersect!: IntersectionObserverCallback;
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { intersect = callback; } observe() {} disconnect() {} });
  const loadThumbnail = vi.fn(async () => image);
  render(<ContextAssetThumbnail asset={{ ...asset, loadThumbnail }} />);
  expect(loadThumbnail).not.toHaveBeenCalled();
  act(() => intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(await screen.findByRole("img")).toBeInTheDocument();
});
it("bounds parallel image reads and discards replies after a catalog changes", async () => {
  raster(); const finish: Array<(value: typeof image) => void> = [];
  const load = vi.fn(() => new Promise<typeof image>((resolve) => finish.push(resolve)));
  const { rerender } = render(<>{[0, 1, 2, 3].map((id) => <ContextAssetThumbnail key={id} asset={{ ...asset, id: String(id), loadThumbnail: load }} />)}</>);
  expect(load).toHaveBeenCalledTimes(2);
  rerender(<div>另一账号</div>);
  await act(async () => { finish.forEach((resolve) => resolve(image)); });
  await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
  expect(load).toHaveBeenCalledTimes(2);
});
