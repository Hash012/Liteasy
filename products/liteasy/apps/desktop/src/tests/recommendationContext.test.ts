import { afterEach, expect, test, vi } from "vitest";
import { buildRecommendationContext } from "../app/features/recommendations/recommendationContext";
import { defaultRecommendationPreferences } from "../app/features/recommendations/recommendationPreferences";
import type { AgentAssetService } from "../app/features/resource-filesystem/agentAssetService";
import type { Paper } from "../app/features/workspace/workspace.types";
const notes = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock("../app/features/notes/pdfNotesSource", () => ({ loadPdfNotes: notes }));
afterEach(() => notes.mockReset().mockResolvedValue([]));
const options = () => ({ scope: "local", papers: [] as Paper[], preferences: defaultRecommendationPreferences, signal: new AbortController().signal });

test("reads only selected Markdown/ebook/Canvas content, preserving revisions and privacy", async () => {
  const stat = vi.fn(async (path: string) => ({ path, title: "Research", kind: path.includes("board") ? "board" : "note", revision: "r2" }));
  const read = vi.fn(async (path: string) => ({ asset: await stat(path), text: path.includes("board") ? JSON.stringify({ nodes: [{ text: "episodic memory" }, { x: 200, y: 300 }], edges: [{ label: "retrieval" }] }) : "# Retrieval\nDetails about database transactions." }));
  const assets = { stat, read, search: vi.fn() } as unknown as AgentAssetService;
  const context = await buildRecommendationContext({ ...options(), assets, selected: [{ path: "note" }, { path: "ebook" }, { path: "board" }] });
  expect(read).toHaveBeenCalledTimes(3); expect(assets.search).not.toHaveBeenCalled();
  expect(context.views).toHaveLength(3); expect(context.views.every((view) => view.private && view.revision === "r2")).toBe(true);
  expect(context.views[2].text).toContain("episodic memory\nretrieval"); expect(context.views[2].text).not.toContain("200");
  expect(context.documents.map((doc) => doc.id)).toEqual(["note", "ebook", "board"]);
});

test("user questions outrank a bare highlight; deleted annotations and disabled profile disappear", async () => {
  const annotation = { id: "a1", excerpt: "transaction ordering", updatedAt: "r1", note: "How is serializable snapshot isolation guaranteed?", quickAsk: { answer: "MODEL ANSWER MUST NOT BE A PREFERENCE" } };
  notes.mockResolvedValue([{ title: "Question", paper: { id: "paper-1" }, annotation }, { title: "Question duplicate", paper: { id: "paper-1" }, annotation }]);
  const input = { ...options(), profile: { topics: ["database"], methods: [], datasets: [], languages: ["polite"] } };
  const context = await buildRecommendationContext(input);
  expect(context.views.filter((view) => view.kind === "annotation")).toHaveLength(1);
  expect(context.views[0]).toMatchObject({ provenance: "user-note", private: true, importance: 1 });
  expect(context.views[0].text).not.toContain("MODEL ANSWER"); expect(context.views.some((view) => view.text === "polite")).toBe(false);
  notes.mockResolvedValue([]);
  const removed = await buildRecommendationContext({ ...input, preferences: { ...input.preferences, useProfile: false } });
  expect(removed.views).toEqual([]);
});
