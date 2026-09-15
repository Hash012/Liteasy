import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PdfReader } from "../app/features/pdf/PdfReader";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import type { PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";

const native = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("../app/features/library/userPaperArtifactClient", () => ({
  isUserPaperArtifactStoreAvailable: () => true,
  loadUserPaperArtifact: native.load,
  saveUserPaperArtifact: native.save,
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

test("a failed native recovery never saves an empty fallback over disk; retry restores the entry and review", async () => {
  const paper = { id: "native-review-paper", title: "Recovery paper", sourcePath: "/papers/native-review.pdf" };
  const annotation: PdfAnnotationV2 = {
    id: "durable-entry", kind: "highlight", excerpt: "Durable source", text: "高亮", note: "Durable note",
    page: 1, revision: 2, paperIdentity: resolvePaperIdentity(paper), rects: [],
    createdAt: "2026-09-14T00:00:00.000Z", updatedAt: "2026-09-14T00:00:01.000Z",
    publication: { desiredVisibility: "private", state: "not_published" },
    review: { text: "Durable review", generatedAt: "2026-09-14T00:00:01.000Z", updatedAt: "2026-09-14T00:00:01.000Z", sourceRevision: 1 },
  };
  let recover = false;
  native.load.mockImplementation(async ({ artifactKind }) => {
    if (artifactKind !== "annotations") return undefined;
    if (!recover) throw new Error("Library temporarily unavailable");
    return { version: 2, annotations: [annotation], autoPublic: false };
  });
  native.save.mockResolvedValue(undefined);
  render(<PdfReader selectedPapers={[paper]} zoom={100} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Library temporarily unavailable");
  expect(native.save.mock.calls.filter(([input]) => input.artifactKind === "annotations")).toHaveLength(0);
  recover = true;
  fireEvent.click(screen.getByRole("button", { name: "重试恢复批注" }));
  fireEvent.click(await screen.findByRole("button", { name: "编辑批注：Durable source" }));
  expect(await screen.findByText("Durable review")).toBeVisible();
  await waitFor(() => expect(native.save).toHaveBeenCalledWith({
    artifactKind: "annotations", paperId: paper.id,
    snapshot: { annotations: [annotation], autoPublic: false, version: 2 },
  }));
});
