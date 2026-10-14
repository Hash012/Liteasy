import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContextAssetBrowser } from "../app/features/assistant/ContextAssetBrowser";
import { ContextAssetThumbnail } from "../app/features/assistant/ContextAssetThumbnail";
const image = { text: "", images: [{ url: "data:image/png;base64,AA==", label: "图一" }] };
const asset = { id: "image", trigger: "@" as const, label: "图一", category: "图片", token: { id: "image", kind: "object" as const, label: "图一", prompt: "" } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function raster() {
  vi.stubGlobal("Image", class { src = ""; naturalWidth = 640; naturalHeight = 320; decode = vi.fn(async () => {}); });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/webp;base64,thumbnail");
}
it("shows an image before selecting or previewing it, without capturing context", async () => {
  raster(); const loadThumbnail = vi.fn(async () => image); const loadPreview = vi.fn(); const add = vi.fn();
  render(<ContextAssetBrowser suggestions={[{ ...asset, loadThumbnail, loadPreview }]} onClose={vi.fn()} onAddContextToken={add} />);
  fireEvent.click(screen.getByRole("button", { name: "图库" }));
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
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  rerender(<div>另一账号</div>);
  await act(async () => { finish.forEach((resolve) => resolve(image)); });
  await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
  expect(load).toHaveBeenCalledTimes(2);
});

it("retries the underlying bytes read after failure", async () => {
  raster(); const loadThumbnail = vi.fn().mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "unavailable" })).mockResolvedValue(image);
  render(<ContextAssetThumbnail asset={{ ...asset, loadThumbnail }} />);
  fireEvent.click(await screen.findByRole("button", { name: "重试缩略图" }));
  expect(await screen.findByRole("img")).toBeVisible();
  expect(loadThumbnail).toHaveBeenCalledTimes(2);
});
it("cancels the active read on unmount", async () => {
  raster(); let signal: AbortSignal | undefined;
  const loadThumbnail = vi.fn((value?: AbortSignal) => { signal = value; return new Promise<typeof image>((_, reject) => value?.addEventListener("abort", () => reject(value.reason), { once: true })); });
  const view = render(<ContextAssetThumbnail asset={{ ...asset, loadThumbnail }} />);
  await waitFor(() => expect(loadThumbnail).toHaveBeenCalledOnce());
  view.unmount(); expect(signal?.aborted).toBe(true);
});
it("releases a cancelled queue slot so a different image can finish", async () => {
  raster(); const pending = vi.fn((signal?: AbortSignal) => new Promise<typeof image>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true })));
  const ready = vi.fn(async () => image);
  render(<><ContextAssetThumbnail asset={{ ...asset, loadThumbnail: pending }} /><ContextAssetThumbnail asset={{ ...asset, loadThumbnail: pending }} /><ContextAssetThumbnail asset={{ ...asset, loadThumbnail: ready }} /></>);
  await waitFor(() => expect(pending).toHaveBeenCalledTimes(2)); expect(ready).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "取消缩略图读取" })[0]);
  expect(await screen.findByRole("img")).toBeVisible(); expect(ready).toHaveBeenCalledOnce();
});
it("clears the browser image source when decoding is cancelled", async () => {
  raster(); let decoded!: { src: string };
  vi.stubGlobal("Image", class { src = ""; constructor() { decoded = this; } decode() { return new Promise<void>(() => {}); } });
  const view = render(<ContextAssetThumbnail asset={{ ...asset, loadThumbnail: async () => image }} />);
  await waitFor(() => expect(decoded?.src).toBe(image.images[0].url)); view.unmount();
  expect(decoded.src).toBe("");
});
it("aborts pending reads offscreen, restarts on re-entry, and retains a completed thumbnail", async () => {
  raster(); let intersect!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { intersect = callback; } observe() {} disconnect = disconnect; });
  const signals: AbortSignal[] = [];
  const loadThumbnail = vi.fn((signal?: AbortSignal) => {
    signals.push(signal!);
    if (signals.length > 1) return Promise.resolve(image);
    return new Promise<typeof image>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  render(<ContextAssetThumbnail asset={{ ...asset, loadThumbnail }} />);
  const visible = (value: boolean) => act(() => intersect([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver));
  visible(true); await waitFor(() => expect(loadThumbnail).toHaveBeenCalledOnce());
  visible(false); expect(signals[0].aborted).toBe(true);
  visible(true); expect(await screen.findByRole("img")).toBeVisible(); expect(loadThumbnail).toHaveBeenCalledTimes(2);
  visible(false); visible(true);
  expect(screen.getByRole("img")).toBeVisible(); expect(loadThumbnail).toHaveBeenCalledTimes(2);
  expect(disconnect).not.toHaveBeenCalled();
});
it("removes an offscreen queued thumbnail before a slot becomes available", async () => {
  raster(); const observers: IntersectionObserverCallback[] = [];
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { observers.push(callback); } observe() {} disconnect() {} });
  const pending = vi.fn((signal?: AbortSignal) => new Promise<typeof image>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true })));
  const queued = vi.fn(async () => image);
  render(<><ContextAssetThumbnail asset={{ ...asset, loadThumbnail: pending }} /><ContextAssetThumbnail asset={{ ...asset, loadThumbnail: pending }} /><ContextAssetThumbnail asset={{ ...asset, loadThumbnail: queued }} /></>);
  const visible = (index: number, value: boolean) => act(() => observers[index]([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver));
  visible(0, true); visible(1, true); visible(2, true);
  await waitFor(() => expect(pending).toHaveBeenCalledTimes(2)); expect(queued).not.toHaveBeenCalled();
  visible(2, false); visible(0, false);
  await act(async () => {}); expect(queued).not.toHaveBeenCalled();
  visible(2, true); expect(await screen.findByRole("img")).toBeVisible(); expect(queued).toHaveBeenCalledOnce();
});
