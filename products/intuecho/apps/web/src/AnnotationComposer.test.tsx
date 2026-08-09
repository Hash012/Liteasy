import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AnnotationCard, ReplyItem, ReplyThread } from "./AnnotationApp";
import { AnnotationComposer } from "./AnnotationComposer";
import { canonicalizeInheritedTargets } from "./canonicalizeInheritedTargets";
import { communityApi } from "./communityApi";
import type { CommunityAnnotation, CommunityReply } from "./community.types";

vi.mock("./communityApi", () => ({
  communityApi: {
    createAnnotation: vi.fn(),
    createReply: vi.fn(),
    confirmLiterature: vi.fn(),
    replies: vi.fn(),
    resolveLiterature: vi.fn(),
    updateAnnotation: vi.fn(),
    updateReply: vi.fn(),
    updateReplyPublication: vi.fn()
  }
}));

const createReply = vi.mocked(communityApi.createReply);
const confirmLiterature = vi.mocked(communityApi.confirmLiterature);
const replies = vi.mocked(communityApi.replies);
const resolveLiterature = vi.mocked(communityApi.resolveLiterature);
const updateAnnotation = vi.mocked(communityApi.updateAnnotation);
const updateReply = vi.mocked(communityApi.updateReply);
const updateReplyPublication = vi.mocked(communityApi.updateReplyPublication);

const publicParent: CommunityAnnotation = {
  author: {
    id: "author-1",
    initials: "AA",
    name: "Annotation Author",
    profile: { educationStage: "研究生", institutions: [{ name: "Liteasy University" }] }
  },
  body: "Parent annotation",
  createdAt: "2026-08-09T00:00:00.000Z",
  id: "annotation-parent",
  organizationId: null,
  originalReply: null,
  ratingAverage: null,
  ratingCount: 0,
  revision: 1,
  shareToPlaza: true,
  tags: [],
  targets: [{
    kind: "whole_document",
    literature: {
      identity: { id: "doi:10.1000/parent", kind: "doi", source: "metadata", value: "10.1000/parent" },
      metadata: {
        authors: ["A. Author"],
        title: "Inherited Literature",
        year: 2026
      }
    }
  }],
  updatedAt: "2026-08-09T00:00:00.000Z",
  viewerCanModerate: false,
  viewerIsAuthor: false,
  viewerSaved: false,
  viewerRating: null,
  visibility: "public",
  withdrawnAt: null
};

const publishedReply: CommunityReply = {
  author: publicParent.author,
  body: "A linked reply",
  createdAt: "2026-08-09T01:00:00.000Z",
  derivedAnnotationId: "annotation-derived/1",
  derivedAnnotationState: "published",
  id: "reply-1",
  parentAnnotationId: publicParent.id,
  revision: 1,
  updatedAt: "2026-08-09T01:00:00.000Z",
  viewerIsAuthor: true
};

const legacyCandidate = {
  candidateKey: "crossref:doi:10.1000/parent",
  provider: "crossref" as const,
  record: {
    authors: ["A. Author"],
    identifiers: [{ kind: "doi" as const, source: "public_registry" as const, value: "10.1000/parent" }],
    title: "Inherited Literature",
    year: 2026
  }
};

const confirmedLiterature = {
  ...legacyCandidate.record,
  literatureId: "literature-parent",
  provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry" as const, provider: "crossref" as const }
};

beforeEach(() => {
  vi.clearAllMocks();
  createReply.mockResolvedValue({ annotation: null, reply: { ...publishedReply, derivedAnnotationId: null, derivedAnnotationState: "none" } });
  resolveLiterature.mockResolvedValue({ candidate: legacyCandidate, status: "exact", unavailableProviders: [] });
  confirmLiterature.mockResolvedValue({ literature: confirmedLiterature });
  updateReply.mockResolvedValue({ reply: publishedReply });
});
afterEach(() => cleanup());

test("keeps a reply pure until independent publication is explicitly enabled", async () => {
  const user = userEvent.setup();
  render(<AnnotationComposer context={{ replyTo: publicParent }} onClose={vi.fn()} onSaved={vi.fn()} />);

  expect(screen.getByRole("checkbox", { name: "同时发布为独立批注" })).not.toBeChecked();
  expect(screen.queryByText("关联文献")).not.toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: "同时发布为独立批注" }));

  expect(await screen.findByText("文献 literature-parent")).toBeVisible();
});

test("submits a pure reply with the canonical empty publication payload", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  render(<AnnotationComposer context={{ replyTo: publicParent }} onClose={vi.fn()} onSaved={onSaved} />);

  await user.type(screen.getByLabelText("批注内容"), "Thread only");
  await user.click(screen.getByRole("button", { name: "发布" }));

  await waitFor(() => expect(createReply).toHaveBeenCalledWith("annotation-parent", {
    body: "Thread only",
    publishAsAnnotation: false,
    tags: [],
    targets: []
  }));
  expect(onSaved).toHaveBeenCalledOnce();
});

test("canonicalizes inherited legacy targets before publishing a reply", async () => {
  const user = userEvent.setup();
  render(<AnnotationComposer context={{ replyTo: publicParent }} onClose={vi.fn()} onSaved={vi.fn()} />);

  await user.type(screen.getByLabelText("批注内容"), "Published reply");
  await user.click(screen.getByRole("checkbox", { name: "同时发布为独立批注" }));
  await waitFor(() => expect(confirmLiterature).toHaveBeenCalledWith({ candidateKey: legacyCandidate.candidateKey, mode: "candidate" }));
  await user.click(screen.getByRole("button", { name: "发布" }));

  await waitFor(() => expect(createReply).toHaveBeenCalledOnce());
  const payload = createReply.mock.calls[0][1];
  expect(resolveLiterature).toHaveBeenCalledWith({
    hints: {
      authors: ["A. Author"],
      identifiers: [{ kind: "doi", value: "10.1000/parent" }],
      title: "Inherited Literature",
      year: 2026
    },
    purpose: "forum_compose"
  });
  expect(payload).toEqual({ body: "Published reply", publishAsAnnotation: true, tags: [], targets: [{ kind: "whole_document", literature: { literatureId: "literature-parent" } }] });
  expect(payload.targets[0]).not.toBe(publicParent.targets[0]);
});

test.each([
  { candidates: [legacyCandidate], status: "ambiguous" as const, unavailableProviders: [] },
  { retryable: true as const, status: "unavailable" as const, unavailableProviders: ["crossref" as const] }
])("fails closed when inherited literature resolution is $status", async (resolution) => {
  const user = userEvent.setup();
  resolveLiterature.mockResolvedValue(resolution);
  render(<AnnotationComposer context={{ replyTo: publicParent }} onClose={vi.fn()} onSaved={vi.fn()} />);

  await user.type(screen.getByLabelText("批注内容"), "Do not publish legacy metadata");
  await user.click(screen.getByRole("checkbox", { name: "同时发布为独立批注" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("请重新确认关联文献后再发布独立批注");
  expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
  expect(createReply).not.toHaveBeenCalled();
  expect(confirmLiterature).not.toHaveBeenCalled();
});

test("canonicalizes both the primary and evidence literature in a derived target", async () => {
  const literature = publicParent.targets[0].literature;
  const targets = await canonicalizeInheritedTargets([{
    derivedContent: { artifactId: "artifact-1", excerpt: "Derived excerpt", version: "v1" },
    evidence: [{ anchorHash: "sha256:evidence", excerpt: "Source evidence", literature, rects: [] }],
    kind: "derived_passage",
    literature
  }]);

  expect(targets).toEqual([{
    derivedContent: { artifactId: "artifact-1", excerpt: "Derived excerpt", version: "v1" },
    evidence: [{ anchorHash: "sha256:evidence", excerpt: "Source evidence", literature: { literatureId: "literature-parent" }, rects: [] }],
    kind: "derived_passage",
    literature: { literatureId: "literature-parent" }
  }]);
  expect(resolveLiterature).toHaveBeenCalledOnce();
  expect(confirmLiterature).toHaveBeenCalledOnce();
});

test.each([
  ["organization", "指定组织"],
  ["mutual_followers", "仅互相关注"],
  ["private", "仅自己"]
] as const)("shows %s as inherited and non-editable", async (visibility, label) => {
  const user = userEvent.setup();
  render(<AnnotationComposer context={{ replyTo: { ...publicParent, organizationId: visibility === "organization" ? "org-1" : null, visibility } }} onClose={vi.fn()} onSaved={vi.fn()} />);

  await user.click(screen.getByRole("checkbox", { name: "同时发布为独立批注" }));

  expect(screen.getByText(`可见范围继承自原批注：${label}`)).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "可见范围" })).not.toBeInTheDocument();
});

test("clearing inherited targets disables only independent publication", async () => {
  const user = userEvent.setup();
  render(<AnnotationComposer context={{ replyTo: publicParent }} onClose={vi.fn()} onSaved={vi.fn()} />);
  await user.type(screen.getByLabelText("批注内容"), "Still a reply");
  await user.click(screen.getByRole("checkbox", { name: "同时发布为独立批注" }));

  await user.click(screen.getByRole("button", { name: "移除关联文献" }));

  expect(screen.getByRole("checkbox", { name: "同时发布为独立批注" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "发布" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "发布" }));
  await waitFor(() => expect(createReply).toHaveBeenCalledWith(publicParent.id, {
    body: "Still a reply",
    publishAsAnnotation: false,
    tags: [],
    targets: []
  }));
});

test("edits a derived annotation through its canonical source reply", async () => {
  const user = userEvent.setup();
  const derived = { ...publicParent, body: "Old reply", id: "annotation-derived", originalReply: { replyId: "reply-source", status: "available" as const }, viewerIsAuthor: true };
  render(<AnnotationComposer context={{ edit: derived }} onClose={vi.fn()} onSaved={vi.fn()} />);

  const body = screen.getByLabelText("批注内容");
  await user.clear(body);
  await user.type(body, "Edited reply");
  await user.click(screen.getByRole("button", { name: "保存修改" }));

  await waitFor(() => expect(updateReply).toHaveBeenCalledWith("reply-source", { body: "Edited reply" }));
  expect(updateAnnotation).not.toHaveBeenCalled();
});

test("keeps a published projection visible when withdrawal fails", async () => {
  const user = userEvent.setup();
  updateReplyPublication.mockRejectedValue(new Error("network details"));
  render(<ReplyItem parent={publicParent} reply={publishedReply} session={null} onCompose={vi.fn()} />);

  expect(screen.getByText("独立批注：已发布")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "停止独立批注" }));

  expect(await screen.findByRole("status")).toHaveTextContent("撤回失败，独立批注仍公开");
  expect(screen.getByRole("link", { name: "查看同步发布的批注" })).toHaveAttribute("href", "/annotations/annotation-derived%2F1");
  expect(screen.getByRole("button", { name: "停止独立批注" })).toBeVisible();
});

test("switches a confirmed projection between published and withdrawn commands", async () => {
  const user = userEvent.setup();
  updateReplyPublication.mockResolvedValue({ annotation: null, reply: { ...publishedReply, derivedAnnotationState: "withdrawn" } });
  render(<ReplyItem parent={publicParent} reply={publishedReply} session={null} onCompose={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "停止独立批注" }));

  await waitFor(() => expect(updateReplyPublication).toHaveBeenCalledWith(publishedReply.id, { published: false }));
  expect(screen.queryByRole("link", { name: "查看同步发布的批注" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "恢复独立批注" })).toBeVisible();
});

test("canonicalizes legacy parent targets before restoring a projection", async () => {
  const user = userEvent.setup();
  const withdrawnReply = { ...publishedReply, derivedAnnotationState: "withdrawn" as const };
  updateReplyPublication.mockResolvedValue({ annotation: null, reply: { ...withdrawnReply, derivedAnnotationState: "published" } });
  render(<ReplyItem parent={publicParent} reply={withdrawnReply} session={null} onCompose={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "恢复独立批注" }));

  await waitFor(() => expect(updateReplyPublication).toHaveBeenCalledWith(withdrawnReply.id, {
    published: true,
    tags: [],
    targets: [{ kind: "whole_document", literature: { literatureId: "literature-parent" } }]
  }));
});

test("keeps a projection withdrawn when legacy parent targets cannot be canonicalized", async () => {
  const user = userEvent.setup();
  resolveLiterature.mockResolvedValue({ retryable: true, status: "unavailable", unavailableProviders: ["crossref"] });
  const withdrawnReply = { ...publishedReply, derivedAnnotationState: "withdrawn" as const };
  render(<ReplyItem parent={publicParent} reply={withdrawnReply} session={null} onCompose={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "恢复独立批注" }));

  expect(await screen.findByRole("status")).toHaveTextContent("恢复失败，父批注文献需重新确认，独立批注仍隐藏");
  expect(updateReplyPublication).not.toHaveBeenCalled();
  expect(screen.getByText("独立批注：已撤回")).toBeVisible();
});

test("renders one reply with one projection link and independent projection controls", async () => {
  replies.mockResolvedValue({ replies: [publishedReply] });
  const { rerender } = render(<ReplyThread annotation={publicParent} session={null} onCompose={vi.fn()} />);
  expect(await screen.findAllByText("A linked reply")).toHaveLength(1);
  expect(screen.getAllByRole("link", { name: "查看同步发布的批注" })).toHaveLength(1);

  rerender(<AnnotationCard annotation={{ ...publicParent, body: publishedReply.body, id: publishedReply.derivedAnnotationId!, originalReply: { replyId: publishedReply.id, status: "available" }, viewerIsAuthor: true }} session={null} onCompose={vi.fn()} />);
  expect(screen.getByText("回复了某条批注")).toBeVisible();
  expect(screen.getByRole("button", { name: "回复" })).toBeVisible();
  expect(screen.getByRole("button", { name: "收藏" })).toBeVisible();
  expect(screen.getByRole("button", { name: "编辑批注" })).toBeVisible();
});

test("shows the fixed deleted-parent context on a derived card", () => {
  render(<AnnotationCard annotation={{ ...publicParent, originalReply: { replyId: "reply-source", status: "parent_deleted" } }} session={null} onCompose={vi.fn()} />);
  expect(screen.getByText("原回复对象已删除")).toBeVisible();
});
