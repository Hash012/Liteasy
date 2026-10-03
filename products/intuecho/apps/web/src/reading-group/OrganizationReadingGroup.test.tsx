import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OrganizationAccessSnapshot } from "@intuecho/contracts";
import { communityApi } from "../communityApi";
import { OrganizationReadingGroup } from "./OrganizationReadingGroup";
import { annotationFixture, replyFixture } from "./readingGroupFixtures";

vi.mock("../communityApi", () => ({ communityApi: {
  academicProfile: vi.fn(async () => ({ profile: { educationStage: null, institutions: [], revision: 0 } })),
  readingSources: vi.fn(async () => ({ sources: [] })),
  annotation: vi.fn(), createAnnotation: vi.fn(), replies: vi.fn(), createReply: vi.fn(), updateReply: vi.fn()
} }));
const access: OrganizationAccessSnapshot = {
  allowedActions: ["read_metadata", "read_body", "comment"], authorizationRevision: 2,
  policyRevision: 0, denialReasons: { share_excerpt: "organization_external_use_policy_unconfirmed" },
  actionConstraints: { inviteRoles: [] }, policyExceptions: []
};
const organization = { name: "Synthetic group", organizationId: "org_x", role: "member" as const, annotations: [annotationFixture()] };
const props = { organization, access, viewerId: "host_1", actorBinding: "issuer:host_1:1" };

beforeEach(() => {
  vi.mocked(communityApi.replies).mockResolvedValue({ replies: [] });
  vi.mocked(communityApi.annotation).mockResolvedValue({ annotation: annotationFixture() });
  vi.mocked(communityApi.createAnnotation).mockImplementation(async (input) => ({ annotation: annotationFixture({ ...input, id: "created_pack", organizationId: "org_x", tags: input.tags.map((name) => ({ name, confidence: null, origin: "user", state: "active" })) }) }));
  vi.mocked(communityApi.createReply).mockImplementation(async (parentAnnotationId, input) => ({ annotation: null, reply: replyFixture({ id: "new_reply", body: input.body, parentAnnotationId, author: annotationFixture().author, viewerIsAuthor: true }) }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("creates a reading pack only after selecting material and confirming its organization preview", async () => {
  const user = userEvent.setup();
  render(<OrganizationReadingGroup {...props} />);
  await user.click(screen.getByRole("button", { name: "创建读书包" }));
  await user.type(screen.getByRole("textbox", { name: "读书主题" }), "Evidence comparison");
  await user.type(screen.getByRole("textbox", { name: "导读与讨论目标" }), "Compare the competing assumptions");
  await user.click(screen.getByRole("checkbox", { name: /已确认文献/ }));
  await user.click(screen.getByRole("button", { name: "预览读书包" }));
  expect(communityApi.createAnnotation).not.toHaveBeenCalled();
  const preview = screen.getByRole("region", { name: "提交预览" });
  expect(within(preview).getByText("仅组织内：Synthetic group")).toBeInTheDocument();
  expect(within(preview).getByText(/Evidence comparison/)).toBeInTheDocument();
  await user.click(within(preview).getByRole("button", { name: "确认提交" }));
  await waitFor(() => expect(communityApi.createAnnotation).toHaveBeenCalledWith(expect.objectContaining({
    visibility: "organization", organizationId: "org_x", shareToPlaza: false,
    targets: [{ kind: "whole_document", literature: { literatureId: "literature_1" } }]
  }), expect.any(String)));
});

test("contributes questions and source locations as normal replies without independent publishing", async () => {
  const user = userEvent.setup();
  render(<OrganizationReadingGroup {...props} viewerId="member_1" actorBinding="issuer:member_1:1" />);
  await user.type(screen.getByRole("textbox", { name: "问题或原文对照" }), "Which condition is missing?");
  await user.type(screen.getByRole("textbox", { name: "原文位置（自行核对）" }), "Reading 1, section 3");
  await user.click(screen.getByRole("button", { name: "预览贡献" }));
  expect(communityApi.createReply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  await waitFor(() => expect(communityApi.createReply).toHaveBeenCalledWith("pack_1", expect.objectContaining({
    publishAsAnnotation: false, tags: [], targets: [], body: expect.stringContaining("Reading 1, section 3")
  }), expect.any(String)));
  expect(screen.queryByRole("textbox", { name: "主持人手动摘要" })).not.toBeInTheDocument();
});

test("host summaries preserve unresolved disagreements and selected reply revisions", async () => {
  const user = userEvent.setup();
  vi.mocked(communityApi.replies).mockResolvedValue({ replies: [replyFixture({ body: "A disagreement remains", revision: 3 })] });
  render(<OrganizationReadingGroup {...props} />);
  await screen.findByText("A disagreement remains");
  await user.type(screen.getByRole("textbox", { name: "主持人手动摘要" }), "Provisional finding");
  await user.type(screen.getByRole("textbox", { name: "未解决项与异议" }), "The assumption still needs evidence");
  await user.click(screen.getByRole("checkbox", { name: /引用 Synthetic contributor/ }));
  await user.click(screen.getByRole("button", { name: "预览主持人摘要" }));
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  await waitFor(() => expect(communityApi.createReply).toHaveBeenCalledWith("pack_1", expect.objectContaining({
    body: expect.stringContaining("修订 3"), publishAsAnnotation: false
  }), expect.any(String)));
  const sent = vi.mocked(communityApi.createReply).mock.calls[0][1].body;
  expect(sent).toContain("The assumption still needs evidence");
  expect(sent).toContain("不代表全员共识");
  expect(sent).not.toContain("A disagreement remains");
});

test("permission changes invalidate a pending preview before any write", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<OrganizationReadingGroup {...props} />);
  await user.type(screen.getByRole("textbox", { name: "问题或原文对照" }), "Pending question");
  await user.click(screen.getByRole("button", { name: "预览贡献" }));
  rerender(<OrganizationReadingGroup {...props} access={{ ...access, authorizationRevision: 3, allowedActions: [] }} />);
  expect(screen.queryByRole("button", { name: "确认提交" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Read and compare/)).not.toBeInTheDocument();
  expect(communityApi.createReply).not.toHaveBeenCalled();
});

test("late replies from an old actor are ignored and old writing cannot be submitted by the new actor", async () => {
  let finish!: (value: Awaited<ReturnType<typeof communityApi.replies>>) => void;
  vi.mocked(communityApi.replies).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const user = userEvent.setup();
  const { rerender } = render(<OrganizationReadingGroup {...props} />);
  await user.type(screen.getByRole("textbox", { name: "问题或原文对照" }), "OLD_ACTOR_DRAFT");
  rerender(<OrganizationReadingGroup {...props} viewerId="member_2" actorBinding="issuer:member_2:2" />);
  finish({ replies: [replyFixture({ body: "OLD_ACTOR_LATE_BODY" })] });
  await waitFor(() => expect(communityApi.replies).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("OLD_ACTOR_LATE_BODY")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "问题或原文对照" })).toHaveValue("");
  expect(communityApi.createReply).not.toHaveBeenCalled();
});

test("exports only actively written personal reflection and its source reference", async () => {
  const onExportNote = vi.fn();
  const user = userEvent.setup();
  render(<OrganizationReadingGroup {...props} onExportNote={onExportNote} />);
  await user.type(screen.getByRole("textbox", { name: "个人复盘" }), "My own reflection");
  await user.click(screen.getByRole("checkbox", { name: "确认仅导出我在此填写的个人复盘与来源引用" }));
  await user.click(screen.getByRole("button", { name: "导出个人笔记" }));
  expect(onExportNote).toHaveBeenCalledWith({ filename: "reading-group-note.md", content: expect.stringContaining("My own reflection") });
  expect(onExportNote.mock.calls[0][0].content).not.toMatch(/Read and compare|PRIVATE_REPLY_BODY|Synthetic group/);
});

test("a changed cited reply requires a new summary preview before any write", async () => {
  const user = userEvent.setup();
  vi.mocked(communityApi.replies).mockResolvedValueOnce({ replies: [replyFixture({ body: "Original observation", revision: 1 })] })
    .mockResolvedValueOnce({ replies: [replyFixture({ body: "Corrected observation", revision: 2 })] });
  render(<OrganizationReadingGroup {...props} />);
  await screen.findByText("Original observation");
  await user.type(screen.getByRole("textbox", { name: "主持人手动摘要" }), "Provisional finding");
  await user.type(screen.getByRole("textbox", { name: "未解决项与异议" }), "Still disputed");
  await user.click(screen.getByRole("checkbox", { name: /引用 Synthetic contributor/ }));
  await user.click(screen.getByRole("button", { name: "预览主持人摘要" }));
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  await screen.findByText("引用的回复已更新，请重新查看后整理摘要。");
  expect(communityApi.createReply).not.toHaveBeenCalled();
  expect(screen.getByText("Corrected observation")).toBeInTheDocument();
});

test("contributors can correct only their own reply and see the new authoritative revision", async () => {
  const user = userEvent.setup();
  const own = replyFixture({ viewerIsAuthor: true });
  vi.mocked(communityApi.replies).mockResolvedValue({ replies: [own] });
  vi.mocked(communityApi.updateReply).mockResolvedValue({ reply: { ...own, body: "Corrected reasoning", revision: 2 } });
  render(<OrganizationReadingGroup {...props} viewerId="member_1" actorBinding="issuer:member_1:1" />);
  await user.click(await screen.findByRole("button", { name: "更正我的贡献" }));
  const edit = screen.getByRole("textbox", { name: "更正内容" });
  await user.clear(edit);
  await user.type(edit, "Corrected reasoning");
  await user.click(screen.getByRole("button", { name: "预览更正" }));
  expect(communityApi.updateReply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  await waitFor(() => expect(communityApi.updateReply).toHaveBeenCalledWith("reply_1", { body: "Corrected reasoning", expectedRevision: 1 }));
  const thread = screen.getByRole("region", { name: "读书组讨论" });
  expect(within(thread).getByText("Corrected reasoning")).toBeInTheDocument();
  expect(within(thread).getByText("修订 2")).toBeInTheDocument();
});

test("late write receipts cannot update another actor's discussion or call its refresh handler", async () => {
  let finish!: (value: Awaited<ReturnType<typeof communityApi.createReply>>) => void;
  vi.mocked(communityApi.createReply).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const onChanged = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(<OrganizationReadingGroup {...props} onChanged={onChanged} />);
  await user.type(screen.getByRole("textbox", { name: "问题或原文对照" }), "Original account question");
  await user.click(screen.getByRole("button", { name: "预览贡献" }));
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  expect(communityApi.createReply).toHaveBeenCalledTimes(1);
  rerender(<OrganizationReadingGroup {...props} viewerId="member_2" actorBinding="issuer:member_2:2" onChanged={onChanged} />);
  finish({ annotation: null, reply: replyFixture({ body: "OLD_ACTOR_COMMITTED", author: annotationFixture().author }) });
  await waitFor(() => expect(communityApi.replies).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("OLD_ACTOR_COMMITTED")).not.toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
});

test("editing approved writing cancels confirmation and embedded HTML is rendered as text", async () => {
  const user = userEvent.setup();
  vi.mocked(communityApi.replies).mockResolvedValue({ replies: [replyFixture({ body: '<img src=x onerror="alert(1)">' })] });
  render(<OrganizationReadingGroup {...props} />);
  const hostileText = await screen.findByText('<img src=x onerror="alert(1)">');
  expect(hostileText.querySelector("img")).toBeNull();
  await user.type(screen.getByRole("textbox", { name: "问题或原文对照" }), "Version one");
  await user.click(screen.getByRole("button", { name: "预览贡献" }));
  expect(screen.getByRole("button", { name: "确认提交" })).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "问题或原文对照" }), " revised");
  expect(screen.queryByRole("button", { name: "确认提交" })).not.toBeInTheDocument();
  expect(communityApi.createReply).not.toHaveBeenCalled();
});

test("a fresh authorization rejection removes active organization content despite the old permission snapshot", async () => {
  const user = userEvent.setup();
  vi.mocked(communityApi.createReply).mockRejectedValueOnce(new Error("ORGANIZATION_ACCESS_DENIED"));
  render(<OrganizationReadingGroup {...props} />);
  expect(screen.getByText(/Read and compare/)).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "问题或原文对照" }), "A question after membership removal");
  await user.click(screen.getByRole("button", { name: "预览贡献" }));
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  await screen.findByText("当前无法访问此读书包，请刷新组织权限。");
  expect(screen.queryByText(/Read and compare/)).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "问题或原文对照" })).not.toBeInTheDocument();
});


test("reading task notifications require an unchecked explicit choice and a confirmed audience preview", async () => {
  const user = userEvent.setup();
  render(<OrganizationReadingGroup {...props} />);
  await user.click(screen.getByRole("button", { name: "创建读书包" }));
  await user.type(screen.getByRole("textbox", { name: "读书主题" }), "Reading task");
  await user.type(screen.getByRole("textbox", { name: "导读与讨论目标" }), "Review the evidence");
  await user.click(screen.getByRole("checkbox", { name: /已确认文献/ }));
  const notify = screen.getByRole("checkbox", { name: "作为阅读任务提醒已订阅成员" });
  expect(notify).not.toBeChecked();
  await user.click(notify);
  await user.click(screen.getByRole("button", { name: "预览读书包" }));
  expect(within(screen.getByRole("region", { name: "提交预览" })).getByText(/阅读任务提醒仅发给已订阅且未静音的成员/)).toBeInTheDocument();
  expect(communityApi.createAnnotation).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  await waitFor(() => expect(communityApi.createAnnotation).toHaveBeenCalledWith(expect.objectContaining({ notificationIntent: "reading_task", visibility: "organization", shareToPlaza: false }), expect.any(String)));
});

test("mention choices use loaded participants, require preview, and reset for another actor", async () => {
  const user = userEvent.setup();
  vi.mocked(communityApi.replies).mockResolvedValue({ replies: [replyFixture()] });
  const { rerender } = render(<OrganizationReadingGroup {...props} />);
  const mention = await screen.findByRole("checkbox", { name: "提及 Synthetic contributor" });
  expect(mention).not.toBeChecked();
  await user.click(mention);
  await user.type(screen.getByRole("textbox", { name: "问题或原文对照" }), "Please check this assumption");
  await user.click(screen.getByRole("button", { name: "预览贡献" }));
  expect(within(screen.getByRole("region", { name: "提交预览" })).getByText(/将提及：Synthetic contributor/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  await waitFor(() => expect(communityApi.createReply).toHaveBeenCalledWith("pack_1", expect.objectContaining({ mentionedUserIds: ["member_1"], publishAsAnnotation: false }), expect.any(String)));
  rerender(<OrganizationReadingGroup {...props} viewerId="member_2" actorBinding="issuer:member_2:2" />);
  expect(await screen.findByRole("checkbox", { name: "提及 Synthetic contributor" })).not.toBeChecked();
  expect(screen.queryByRole("region", { name: "提交预览" })).not.toBeInTheDocument();
});

test("an empty organization selects a confirmed material without creating a placeholder annotation", async () => {
  const user = userEvent.setup();
  const record = annotationFixture().targets[0].literature.literatureRecord!;
  vi.mocked(communityApi.readingSources).mockResolvedValueOnce({ sources: [] }).mockResolvedValueOnce({ sources: [record] });
  render(<OrganizationReadingGroup {...props} organization={{ ...organization, annotations: [] }} />);
  await user.click(screen.getByRole("button", { name: "创建读书包" }));
  await user.type(screen.getByRole("textbox", { name: "读书主题" }), "First reading");
  await user.type(screen.getByRole("textbox", { name: "导读与讨论目标" }), "Review this confirmed source");
  await user.type(screen.getByRole("textbox", { name: "查找已确认资料" }), "Synthetic reading");
  await user.click(screen.getByRole("button", { name: "查找可用资料" }));
  expect(communityApi.readingSources).toHaveBeenCalledWith("org_x", "Synthetic reading");
  await user.click(await screen.findByRole("checkbox", { name: record.title }));
  await user.click(screen.getByRole("button", { name: "预览读书包" }));
  expect(communityApi.createAnnotation).not.toHaveBeenCalled();
  await user.click(await screen.findByRole("button", { name: "确认提交" }));
  expect(communityApi.createAnnotation).toHaveBeenCalledTimes(1);
  expect(communityApi.createAnnotation).toHaveBeenCalledWith(expect.objectContaining({ collaboration: { schemaVersion: 1, kind: "reading_pack", sourceRefs: [{ sourceNamespace: "intuecho.literature", sourceId: "literature_1", revision: 1, locator: { kind: "whole_document" } }] } }), expect.any(String));
});

test("server source-revision conflicts preserve summary writing instead of silently accepting the client precheck", async () => {
  const user = userEvent.setup();
  vi.mocked(communityApi.replies).mockResolvedValue({ replies: [replyFixture()] });
  vi.mocked(communityApi.createReply).mockRejectedValueOnce(new Error("SOURCE_REVISION_CONFLICT"));
  render(<OrganizationReadingGroup {...props} owner="actor-a" />);
  await user.type(screen.getByRole("textbox", { name: "主持人手动摘要" }), "My retained summary");
  await user.type(screen.getByRole("textbox", { name: "未解决项与异议" }), "An unresolved disagreement");
  await user.click(await screen.findByRole("checkbox", { name: /引用 Synthetic contributor/ }));
  await user.click(screen.getByRole("button", { name: "预览主持人摘要" }));
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  expect(await screen.findByText("SOURCE_REVISION_CONFLICT")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "主持人手动摘要" })).toHaveValue("My retained summary");
  expect(Object.values(localStorage).join("")).toContain("My retained summary");
});

test("a second group visit surfaces the previous host summary, unresolved items and pinned evidence", async () => {
  const previousSummary = replyFixture({
    id: "previous-summary", author: annotationFixture().author,
    body: "## 主持人手动摘要\nPrevious round finding\n\n## 未解决项与异议\nBoundary condition still disputed\n\n## 讨论依据\n/source/ref",
    collaboration: { schemaVersion: 1, kind: "host_summary", parentPackId: "pack_1", sourceRefs: [{ sourceNamespace: "intuecho.reply", sourceId: "evidence-reply", revision: 2 }] }
  });
  const question = replyFixture({ id: "question", body: "Which assumption remains?", collaboration: { schemaVersion: 1, kind: "question", parentPackId: "pack_1", sourceRefs: [] } });
  vi.mocked(communityApi.replies).mockResolvedValue({ replies: [question, previousSummary] });
  render(<OrganizationReadingGroup {...props} />);
  const resume = await screen.findByRole("region", { name: "继续上次讨论" });
  expect(within(resume).getByText("Previous round finding")).toBeInTheDocument();
  expect(within(resume).getByText("Boundary condition still disputed")).toBeInTheDocument();
  expect(within(resume).getByText(/不代表所有问题已解决/)).toBeInTheDocument();
  await userEvent.click(within(resume).getByRole("button", { name: "查看前次摘要与证据" }));
  const thread = screen.getByRole("region", { name: "读书组讨论" });
  expect(within(thread).queryByText("Which assumption remains?")).not.toBeInTheDocument();
  expect(within(thread).getByRole("link", { name: "在 Liteasy 打开此来源版本" })).toHaveAttribute("href", "liteasy://community-sources/intuecho.reply/evidence-reply?revision=2");
  await userEvent.click(screen.getByRole("button", { name: "问题 (1)" }));
  expect(within(thread).getByText("Which assumption remains?")).toBeInTheDocument();
  expect(communityApi.createReply).not.toHaveBeenCalled();
});

test("personal reflection survives contribution success and switching packs without entering the remote payload", async () => {
  localStorage.clear();
  const owner = "synthetic-owner-reflection";
  const first = annotationFixture();
  const second = annotationFixture({ id: "pack_2", body: "# Another round", revision: 1 });
  const user = userEvent.setup();
  const view = render(<OrganizationReadingGroup {...props} owner={owner} organization={{ ...organization, annotations: [first, second] }} />);
  await user.type(screen.getByRole("textbox", { name: "个人复盘" }), "MY_PRIVATE_REFLECTION");
  await user.type(screen.getByRole("textbox", { name: "问题或原文对照" }), "A public-to-group question");
  await user.click(screen.getByRole("button", { name: "预览贡献" }));
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  await screen.findByText("已保存到组织讨论。");
  expect(JSON.stringify(vi.mocked(communityApi.createReply).mock.calls[0])).not.toContain("MY_PRIVATE_REFLECTION");
  await user.selectOptions(screen.getByRole("combobox", { name: "选择读书包" }), "pack_2");
  await user.selectOptions(screen.getByRole("combobox", { name: "选择读书包" }), "pack_1");
  const { draftRecords } = await import("../communityPersistence");
  expect(draftRecords<{ reflection: string }>(owner, "reading-group:org_x:pack_1").some((draft) => draft.value.reflection === "MY_PRIVATE_REFLECTION")).toBe(true);
  view.unmount();
  render(<OrganizationReadingGroup {...props} owner={owner} organization={{ ...organization, annotations: [first, second] }} />);
  const restoreButtons = await screen.findAllByRole("button", { name: /恢复本机草稿/ });
  await user.click(restoreButtons[0]);
  expect(screen.getByRole("textbox", { name: "个人复盘" })).toHaveValue("MY_PRIVATE_REFLECTION");
});

test("personal export keeps the original source revision after the discussion updates and rechecks current access", async () => {
  const onExportNote = vi.fn();
  const user = userEvent.setup();
  const view = render(<OrganizationReadingGroup {...props} onExportNote={onExportNote} />);
  await user.type(screen.getByRole("textbox", { name: "个人复盘" }), "My reading of revision two");
  const corrected = annotationFixture({ revision: 3, body: "# Corrected current group material" });
  view.rerender(<OrganizationReadingGroup {...props} organization={{ ...organization, annotations: [corrected] }} onExportNote={onExportNote} />);
  vi.mocked(communityApi.annotation).mockResolvedValueOnce({ annotation: corrected });
  await user.click(screen.getByRole("checkbox", { name: "确认仅导出我在此填写的个人复盘与来源引用" }));
  await user.click(screen.getByRole("button", { name: "导出个人笔记" }));
  await waitFor(() => expect(onExportNote).toHaveBeenCalledTimes(1));
  expect(onExportNote.mock.calls[0][0].content).toContain("revision: 2");
  expect(onExportNote.mock.calls[0][0].content).toContain("revision=2");
  expect(communityApi.annotation).toHaveBeenCalledWith("pack_1");
  expect(onExportNote.mock.calls[0][0].content).not.toContain("Corrected current group material");
});

test("fresh access denial prevents personal export despite a stale permission snapshot", async () => {
  const onExportNote = vi.fn();
  vi.mocked(communityApi.annotation).mockRejectedValueOnce(new Error("ORGANIZATION_ACCESS_DENIED"));
  const user = userEvent.setup();
  render(<OrganizationReadingGroup {...props} onExportNote={onExportNote} />);
  await user.type(screen.getByRole("textbox", { name: "个人复盘" }), "Private reflection must stay local");
  await user.click(screen.getByRole("checkbox", { name: "确认仅导出我在此填写的个人复盘与来源引用" }));
  await user.click(screen.getByRole("button", { name: "导出个人笔记" }));
  await screen.findByText("当前无法访问此读书包，请刷新组织权限。");
  expect(onExportNote).not.toHaveBeenCalled();
});
