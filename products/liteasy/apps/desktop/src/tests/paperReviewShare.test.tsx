import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { createPaperReviewShareStore, paperReviewShareStore } from "../app/features/pdf/paperReviewShare";
import { PaperReviewSharePanel } from "../app/features/pdf/PaperReviewSharePanel";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import type { PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import { clearStoredAccountSession, storeAccountSession } from "../app/features/account/accountSessionStorage";
import type { AccountSession } from "../app/features/account/account.types";

function annotation(id = "comment-1", note = "我的疑问"): PdfAnnotationV2 {
  return { id, note, kind: "highlight", page: 3, revision: 2, text: "高亮", excerpt: "Original passage",
    paperIdentity: resolvePaperIdentity({ id: "paper", title: "A paper" }), rects: [],
    createdAt: "2026-09-21", updatedAt: "2026-09-21", publication: { desiredVisibility: "private", state: "not_published" } };
}
function source() {
  return { title: "A paper", annotations: [annotation()], pageTexts: { 3: "Context on page 3", 4: "Not shared" } };
}
afterEach(() => { cleanup(); clearStoredAccountSession(); });

test("sharing is explicit, immutable, bounded to comments and revocable", () => {
  const store = createPaperReviewShareStore();
  expect(() => store.read({ operation: "current" })).toThrow("review_not_shared");
  const input = source();
  input.annotations.push(annotation("highlight-only", ""));
  const reviewId = store.share(input, () => true);
  input.annotations[0].note = "later edit";
  input.pageTexts[3] = "later page";
  expect(store.read({ operation: "current" })).toMatchObject({ totalComments: 1, excludedAnnotations: 1 });
  expect(store.read({ operation: "comments", reviewId })).toMatchObject({ comments: [{ comment: "我的疑问", page: 3 }], nextOffset: null });
  expect(store.read({ operation: "page", reviewId, page: 3 })).toMatchObject({ text: "Context on page 3" });
  expect(() => store.read({ operation: "page", reviewId, page: 4 })).toThrow("page_not_shared");
  store.revoke(reviewId);
  expect(() => store.read({ operation: "comments", reviewId })).toThrow("review_not_shared");
});

test("all comments and long text remain readable without confusing prior AI output with the user", () => {
  const store = createPaperReviewShareStore();
  const input = source();
  input.annotations = Array.from({ length: 23 }, (_, i) => annotation(`c-${String(i).padStart(2, "0")}`, "x".repeat(17_003)));
  input.annotations[0].quickAsk = { question: "My question", answer: "AI answer", pageText: "", abstractText: "" };
  input.annotations[1].review = { text: "Prior AI review", sourceRevision: 1, generatedAt: "", updatedAt: "" };
  const reviewId = store.share(input, () => true);
  let offset: number | null = 0;
  const ids: string[] = [];
  while (offset !== null) {
    const page = store.read({ operation: "comments", reviewId, offset, limit: 7 });
    ids.push(...(page.comments as { annotationId: string }[]).map((row) => row.annotationId));
    offset = page.nextOffset as number | null;
  }
  expect(new Set(ids).size).toBe(23);
  expect(store.read({ operation: "comment", reviewId, annotationId: "c-00", field: "comment" }).text).toBe("My question");
  expect(store.read({ operation: "comment", reviewId, annotationId: "c-00", field: "previousAnswer" }).text).toBe("AI answer");
  let text = "";
  offset = 0;
  while (offset !== null) {
    const part = store.read({ operation: "comment", reviewId, annotationId: "c-01", field: "comment", offset });
    text += part.text;
    offset = part.nextOffset as number | null;
  }
  expect(text).toBe("x".repeat(17_003));
  expect(() => store.read({ operation: "comments", reviewId, offset: -1 })).toThrow("invalid_range");
  expect(() => store.read({ operation: "comments", reviewId, limit: 0 })).toThrow();
});

test("old continuations cannot retarget a newly shared paper and account changes revoke access", () => {
  const store = createPaperReviewShareStore();
  let current = true;
  const first = store.share(source(), () => current);
  const second = store.share({ ...source(), title: "Another paper" }, () => current);
  store.revoke(first);
  expect(store.getId()).toBe(second);
  expect(() => store.read({ operation: "comments", reviewId: first })).toThrow("review_expired");
  current = false;
  expect(() => store.read({ operation: "current" })).toThrow("review_not_shared");
});

test("UI shares only after click and revokes on scope change, close, and account switch", () => {
  const view = render(<PaperReviewSharePanel scopeKey="a" ready hostAvailable source={source()} />);
  fireEvent.click(screen.getByText("ChatGPT 评论 Review"));
  expect(() => paperReviewShareStore.read({ operation: "current" })).toThrow();
  fireEvent.click(screen.getByRole("button", { name: "共享本篇评论" }));
  expect(paperReviewShareStore.read({ operation: "current" }).totalComments).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "更新共享快照" }));
  expect(paperReviewShareStore.read({ operation: "current" }).totalComments).toBe(1);
  view.rerender(<PaperReviewSharePanel scopeKey="b" ready hostAvailable source={source()} />);
  expect(() => paperReviewShareStore.read({ operation: "current" })).toThrow();
  fireEvent.click(screen.getByRole("button", { name: "共享本篇评论" }));
  act(() => {
    storeAccountSession({ userId: "someone-else", email: "user@example.test", membershipTier: "basic" } as AccountSession);
    expect(() => paperReviewShareStore.read({ operation: "current" })).toThrow();
  });
  view.rerender(<PaperReviewSharePanel scopeKey="b" ready hostAvailable source={source()} />);
  fireEvent.click(screen.getByRole("button", { name: "共享本篇评论" }));
  view.unmount();
  expect(() => paperReviewShareStore.read({ operation: "current" })).toThrow();
});

test("empty text extraction and nontext material are disclosed, not invented", () => {
  const store = createPaperReviewShareStore();
  const entry = { ...annotation(), kind: "ink" as const };
  const reviewId = store.share({ title: "Scan", annotations: [entry], pageTexts: {} }, () => true);
  expect(store.read({ operation: "comments", reviewId })).toMatchObject({
    comments: [{ quote: "", hasNonTextContent: true, pageTextAvailable: false }],
  });
  expect(store.read({ operation: "page", reviewId, page: 3 })).toMatchObject({ available: false, text: "" });
});
