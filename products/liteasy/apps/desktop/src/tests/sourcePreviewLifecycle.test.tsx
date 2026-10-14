import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createResourceReferenceService } from "../app/features/resource-links/resourceReferenceService";
import { ResourceReferencesContext } from "../app/features/resource-links/ResourceReferencesContext";
import { ResourceLink } from "../app/features/resource-links/ResourceReferenceView";
import type { AgentAssetService } from "../app/features/resource-filesystem/agentAssetService";
import { createPreviewRequest, previewDiagnostics } from "../app/features/resource-links/previewRequest";
const path = "liteasy://papers/paper?scope=test";
function fixture() {
  const asset = { path, title: "原文", kind: "paper", revision: "v1", capabilities: [] };
  const read = vi.fn(async () => ({ asset, text: "原文", truncated: false, totalCharacters: 2 }));
  const assets = { read, stat: vi.fn(async () => asset), search: vi.fn(async () => []) } as unknown as AgentAssetService;
  const service = createResourceReferenceService({ scope: "test", assets, active: () => true, catalog: () => [asset] });
  return { service, read, refs: { service, open: vi.fn(), capture: vi.fn(), suggestions: [] } };
}
afterEach(() => vi.useRealTimers());
it("never prepares a paper when reading a hover preview", async () => {
  const f = fixture(); await f.service.document(path);
  expect(f.read).toHaveBeenCalledWith(path, expect.objectContaining({ preparation: "cached", signal: expect.any(AbortSignal) }));
});
it("Escape clears a pending hover timer", async () => {
  vi.useFakeTimers(); const f = fixture();
  render(<ResourceReferencesContext.Provider value={f.refs}><ResourceLink locator={`${path}#C0:1`}>出处</ResourceLink></ResourceReferencesContext.Provider>);
  fireEvent.mouseEnter(screen.getByRole("link")); fireEvent.keyDown(screen.getByRole("link"), { key: "Escape" });
  await act(async () => vi.advanceTimersByTime(500));
  expect(f.read).not.toHaveBeenCalled();
});
it("preserves character locator when opening a source", async () => {
  const f = fixture(); render(<ResourceReferencesContext.Provider value={f.refs}><ResourceLink locator={`${path}#C0:1`}>出处</ResourceLink></ResourceReferencesContext.Provider>);
  fireEvent.click(screen.getByRole("link"));
  await act(async () => {});
  expect(f.refs.open).toHaveBeenCalledWith(`${path}#C0:1`);
});
it("aborts the underlying read on timeout and records a safe stage code", async () => {
  vi.useFakeTimers(); let cancelled = false;
  const request = createPreviewRequest({ timeoutMs: 50, generation: 4 });
  const result = request.stage("read", (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => { cancelled = true; reject(signal.reason); })));
  const rejected = expect(result).rejects.toMatchObject({ code: "timeout" });
  await vi.advanceTimersByTimeAsync(51); await rejected; request.dispose();
  expect(cancelled).toBe(true);
  expect(previewDiagnostics().at(-1)).toMatchObject({ generation: 4, stage: "read", code: "timeout", outcome: "cancelled" });
});
