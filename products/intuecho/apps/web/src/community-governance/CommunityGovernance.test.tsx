import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { annotationFixture } from "../reading-group/readingGroupFixtures";
import { AnnotationGovernanceControls, AnnotationVisibilityGate, CommunityReportHistory, QuietInbox, SubscriptionControls } from "./CommunityGovernance";
import type { CommunityGovernanceApi, CommunityNotification, CommunityReport } from "./governance.types";
import { preferenceFor } from "./governance";

const report: CommunityReport = { id: "report_1", annotationId: "pack_1", revision: 1, reason: "privacy", detail: "A concrete synthetic privacy concern", status: "pending", createdAt: "2026-10-03T12:00:00.000Z", resolvedAt: null, resolutionReason: null };
function apiFixture(): CommunityGovernanceApi {
  return { preferences: vi.fn().mockResolvedValue({ preferences: [] }), setPreference: vi.fn().mockImplementation(async (preference) => ({ preference })), notifications: vi.fn().mockResolvedValue({ notifications: [] }), markNotificationRead: vi.fn().mockImplementation(async (id) => ({ id, read: true })), reportAnnotation: vi.fn().mockResolvedValue({ report }), myReports: vi.fn().mockResolvedValue({ reports: [report] }), reviewReports: vi.fn().mockResolvedValue({ reports: [report] }), resolveReport: vi.fn().mockResolvedValue({ report: { ...report, status: "resolved" } }) };
}
afterEach(cleanup);

test("reports need a material preview and explicit confirmation bound to the displayed revision", async () => {
  const api = apiFixture();
  const user = userEvent.setup();
  render(<AnnotationGovernanceControls annotation={annotationFixture({ revision: 3 })} api={api} actorBinding="member1" preferences={[]} />);
  await user.click(screen.getByRole("button", { name: "举报" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "举报类型" }), "privacy");
  await user.type(screen.getByRole("textbox", { name: "具体说明" }), report.detail);
  await user.click(screen.getByRole("button", { name: "预览举报" }));
  expect(api.reportAnnotation).not.toHaveBeenCalled();
  expect(within(screen.getByRole("region", { name: "举报确认" })).getByText(/修订 3/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "确认提交举报" }));
  await waitFor(() => expect(api.reportAnnotation).toHaveBeenCalledWith("pack_1", { revision: 3, reason: "privacy", detail: report.detail }));
  expect(await screen.findByText(/举报已提交/)).toBeInTheDocument();
});

test("editing report evidence cancels its preview; old actor completion does not notify the new actor", async () => {
  const api = apiFixture();
  let finish!: (result: { preference: ReturnType<typeof preferenceFor> }) => void;
  vi.mocked(api.setPreference).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const user = userEvent.setup();
  const onChanged = vi.fn();
  const { rerender } = render(<AnnotationGovernanceControls annotation={annotationFixture()} api={api} actorBinding="member1" preferences={[]} onPreferencesChanged={onChanged} />);
  await user.click(screen.getByRole("button", { name: "举报" }));
  await user.type(screen.getByRole("textbox", { name: "具体说明" }), report.detail);
  await user.click(screen.getByRole("button", { name: "预览举报" }));
  await user.type(screen.getByRole("textbox", { name: "具体说明" }), " changed");
  expect(screen.queryByRole("button", { name: "确认提交举报" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "隐藏此作者内容" }));
  rerender(<AnnotationGovernanceControls annotation={annotationFixture()} api={api} actorBinding="member2" preferences={[]} onPreferencesChanged={onChanged} />);
  finish({ preference: preferenceFor([], "author", "host_1") });
  await waitFor(() => expect(screen.queryByText(/已隐藏此作者内容及其新回复提醒/)).not.toBeInTheDocument());
  expect(onChanged).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox", { name: "具体说明" })).not.toBeInTheDocument();
});

test("author hiding and low ratings collapse content with an explicit one-time reveal", async () => {
  const user = userEvent.setup();
  const annotation = annotationFixture({ ratingAverage: 1.5, ratingCount: 3 });
  const { rerender } = render(<AnnotationVisibilityGate annotation={annotation} actorBinding="member1" preferences={[]}><p>Synthetic protected content</p></AnnotationVisibilityGate>);
  expect(screen.queryByText("Synthetic protected content")).not.toBeInTheDocument();
  expect(screen.getByText(/评分不代表研究结论真伪/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "本次展开" }));
  expect(screen.getByText("Synthetic protected content")).toBeInTheDocument();
  rerender(<AnnotationVisibilityGate annotation={annotation} actorBinding="member2" preferences={[{ ...preferenceFor([], "author", annotation.author.id), blocked: true }]}><p>Synthetic protected content</p></AnnotationVisibilityGate>);
  expect(screen.queryByText("Synthetic protected content")).not.toBeInTheDocument();
  expect(screen.getByText(/已按你的设置隐藏/)).toBeInTheDocument();
});

test("subscription and mute buttons send explicit values, and unsubscribe is persisted", async () => {
  const api = apiFixture();
  const user = userEvent.setup();
  render(<SubscriptionControls api={api} actorBinding="member1" label="此讨论" preference={preferenceFor([], "thread", "pack_1")} />);
  const subscribed = screen.getByRole("checkbox", { name: "订阅此讨论" });
  expect(subscribed).not.toBeChecked();
  await user.click(subscribed);
  await waitFor(() => expect(api.setPreference).toHaveBeenLastCalledWith({ targetKind: "thread", targetId: "pack_1", subscribed: true, muted: false, blocked: false }));
  await user.click(screen.getByRole("checkbox", { name: "静音此讨论" }));
  await waitFor(() => expect(api.setPreference).toHaveBeenLastCalledWith(expect.objectContaining({ subscribed: true, muted: true })));
  await user.click(subscribed);
  await waitFor(() => expect(api.setPreference).toHaveBeenLastCalledWith(expect.objectContaining({ subscribed: false, muted: true })));
});

test("generic revoked notifications offer marking read without a target or a content link", async () => {
  const api = apiFixture();
  vi.mocked(api.notifications).mockResolvedValue({ notifications: [{ id: "opaque_1", available: false }] });
  const user = userEvent.setup();
  const onOpen = vi.fn();
  render(<QuietInbox actorBinding="member1" api={api} onOpenAnnotation={onOpen} />);
  expect(await screen.findByText("相关内容当前不可访问。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "查看讨论" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "标为已读" }));
  await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith("opaque_1"));
  expect(await screen.findByText("已读")).toBeInTheDocument();
  expect(onOpen).not.toHaveBeenCalled();
});

test("notification refresh and actor changes clear earlier targets and ignore late inbox responses", async () => {
  const api = apiFixture();
  let finish!: (result: { notifications: CommunityNotification[] }) => void;
  vi.mocked(api.notifications).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const onOpen = vi.fn();
  const { rerender } = render(<QuietInbox actorBinding="member1" api={api} onOpenAnnotation={onOpen} />);
  rerender(<QuietInbox actorBinding="member2" api={api} onOpenAnnotation={onOpen} />);
  expect(await screen.findByText(/暂无通知/)).toBeInTheDocument();
  finish({ notifications: [{ id: "old_notification", available: true, kind: "reply", createdAt: "now", readAt: null, target: { annotationId: "private_old_target", revision: 1 } }] });
  await waitFor(() => expect(screen.queryByRole("button", { name: "查看讨论" })).not.toBeInTheDocument());
});

test("report history shows status and review records a reason without changing annotation content", async () => {
  const api = apiFixture();
  const user = userEvent.setup();
  const { rerender } = render(<CommunityReportHistory api={api} actorBinding="member1" />);
  expect(await screen.findByText(/隐私问题 · 待处理/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "记录处理完成" })).not.toBeInTheDocument();
  rerender(<CommunityReportHistory api={api} actorBinding="moderator" review />);
  await screen.findByRole("button", { name: "记录处理完成" });
  await user.selectOptions(screen.getByRole("combobox", { name: "处理说明" }), "insufficient_evidence");
  await user.click(screen.getByRole("button", { name: "记录不予采纳" }));
  await waitFor(() => expect(api.resolveReport).toHaveBeenCalledWith("report_1", { status: "dismissed", reason: "insufficient_evidence" }));
});


test("available structured events identify their purpose and report results open the user's records", async () => {
  const api = apiFixture();
  const kinds = ["mention", "reading_task", "report_result", "tag_appeal_result", "moderation"] as const;
  vi.mocked(api.notifications).mockResolvedValue({ notifications: kinds.map((kind) => ({ id: kind, available: true, kind, createdAt: "now", readAt: null, target: { annotationId: "pack_1", revision: 1 } })) });
  const onOpenReports = vi.fn();
  const onOpenAnnotation = vi.fn();
  const user = userEvent.setup();
  render(<QuietInbox api={api} actorBinding="member1" onOpenAnnotation={onOpenAnnotation} onOpenReports={onOpenReports} />);
  await screen.findByText("讨论中有人提及了你");
  expect(screen.getByText("订阅的组织有新的阅读任务")).toBeInTheDocument();
  expect(screen.getByText("你的举报有处理结果")).toBeInTheDocument();
  expect(screen.getByText("你的标签申诉有处理结果")).toBeInTheDocument();
  expect(screen.getByText("你的内容有治理状态变化")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看举报记录" }));
  expect(onOpenReports).toHaveBeenCalledTimes(1);
  expect(onOpenAnnotation).not.toHaveBeenCalled();
});
