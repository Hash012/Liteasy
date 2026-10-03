import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AnnotationApp } from "./AnnotationApp";
import { communityApi } from "./communityApi";
import { identityApi } from "./identityClient";

const fixture = vi.hoisted(() => ({
  session: { audience: "intuecho-web", email: "a@example.test", expiresAt: "2099-01-01T00:00:00Z", name: "Account A", sessionId: "token-a", userId: "a" },
  draft: { body: "A private handoff draft", targets: [], tags: [], visibility: "private", shareToPlaza: false }
}));
vi.mock("./identityClient", () => ({
  readIdentitySession: () => fixture.session,
  setAuthRequiredHandler: vi.fn(),
  identityApi: { initialize: vi.fn(async () => ({ mode: "oauth", session: fixture.session })), logout: vi.fn(), beginOAuthLogin: vi.fn() }
}));
vi.mock("./communityApi", () => ({
  communityApi: {
    preferences: vi.fn(async () => ({ preferences: [] })),
    notifications: vi.fn(async () => ({ notifications: [] })),
    myReports: vi.fn(async () => ({ reports: [] })),
    reviewReports: vi.fn(async () => ({ reports: [] })),
    annotation: vi.fn(),
    plaza: vi.fn(async () => ({ annotations: [] })),
    conversations: vi.fn(async () => ({ conversations: [] })),
    consumeAnnotationHandoff: vi.fn()
  }
}));
vi.mock("./AnnotationComposer", () => ({
  AnnotationComposer: ({ context }: { context: { draft?: { body: string } } }) => <div role="dialog">{context.draft?.body ?? "New draft"}</div>
}));

afterEach(cleanup);

vi.mock("./DevelopmentAuthForm", () => ({
  DevelopmentAuthForm: ({ onAuthenticated }: { onAuthenticated: (session: unknown) => void }) =>
    <button onClick={() => onAuthenticated({ ...fixture.session, name: "Account B", sessionId: "token-b", userId: "b" })}>Authenticate B</button>
}));

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, "", "/?handoff=synthetic-handoff-a");
  vi.mocked(identityApi.initialize).mockResolvedValue({ mode: "oauth", session: fixture.session as never });
  vi.mocked(communityApi.consumeAnnotationHandoff).mockReset();
  vi.mocked(identityApi.logout).mockReset();
});

async function logout() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Account A 的账户菜单" }));
  await user.click(screen.getByRole("menuitem", { name: "退出登录" }));
}

test("hides an account's consumed handoff immediately while remote logout is pending", async () => {
  vi.mocked(communityApi.consumeAnnotationHandoff).mockResolvedValue({ draft: fixture.draft as never, replayed: false });
  let finish!: () => void;
  vi.mocked(identityApi.logout).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<AnnotationApp />);
  expect(await screen.findByText("A private handoff draft")).toBeInTheDocument();
  await logout();
  expect(screen.queryByText("A private handoff draft")).not.toBeInTheDocument();
  await act(async () => { finish(); });
  expect(screen.queryByText("A private handoff draft")).not.toBeInTheDocument();
});

test("a handoff arriving after local logout cannot reopen the old account draft", async () => {
  let finishHandoff!: (value: Awaited<ReturnType<typeof communityApi.consumeAnnotationHandoff>>) => void;
  vi.mocked(communityApi.consumeAnnotationHandoff).mockImplementation(() => new Promise((resolve) => { finishHandoff = resolve; }));
  vi.mocked(identityApi.logout).mockResolvedValue(undefined);
  render(<AnnotationApp />);
  await waitFor(() => expect(finishHandoff).toBeDefined());
  await logout();
  await act(async () => { finishHandoff({ draft: fixture.draft as never, replayed: false }); });
  expect(screen.queryByText("A private handoff draft")).not.toBeInTheDocument();
  expect(sessionStorage.getItem("intuecho.pending-annotation-handoff.v2")).toBe("synthetic-handoff-a");
});


test("signing in as B never reuses A's consumed draft", async () => {
  vi.mocked(identityApi.initialize).mockResolvedValue({ mode: "development", session: fixture.session as never });
  vi.mocked(communityApi.consumeAnnotationHandoff).mockResolvedValue({ draft: fixture.draft as never, replayed: false });
  vi.mocked(identityApi.logout).mockResolvedValue(undefined);
  render(<AnnotationApp />);
  expect(await screen.findByText("A private handoff draft")).toBeInTheDocument();
  await logout();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "登录" }));
  await user.click(await screen.findByRole("button", { name: "Authenticate B" }));
  expect(await screen.findByRole("button", { name: "Account B 的账户菜单" })).toBeInTheDocument();
  expect(screen.queryByText("A private handoff draft")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "发布批注" }));
  expect(screen.getByText("New draft")).toBeInTheDocument();
  expect(communityApi.consumeAnnotationHandoff).toHaveBeenCalledTimes(1);
});


test("keeps work notifications separate from the plaza without a social unread badge", async () => {
  window.history.replaceState({}, "", "/");
  render(<AnnotationApp />);
  await userEvent.click(screen.getByRole("button", { name: "工作通知" }));
  expect(await screen.findByText("暂无通知。可在讨论中主动订阅。")).toBeInTheDocument();
  expect(communityApi.notifications).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "工作通知" })).not.toHaveTextContent(/[0-9]/);
});


test("a report result in the real inbox opens the current user's report records", async () => {
  window.history.replaceState({}, "", "/");
  vi.mocked(communityApi.notifications).mockResolvedValueOnce({ notifications: [{ id: "synthetic-result", available: true, kind: "report_result", createdAt: "2026-10-03T00:00:00Z", readAt: null, target: { annotationId: "synthetic-annotation", revision: 1, reportId: "synthetic-report" } }] });
  vi.mocked(communityApi.myReports).mockResolvedValueOnce({ reports: [{ id: "synthetic-report", annotationId: "synthetic-annotation", revision: 1, reason: "other", detail: "Synthetic report evidence for account A", status: "resolved", resolutionReason: "reviewed", createdAt: "2026-10-03T00:00:00Z", resolvedAt: "2026-10-03T01:00:00Z" }] });
  render(<AnnotationApp />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "工作通知" }));
  await screen.findByText("你的举报有处理结果");
  await user.click(screen.getByRole("button", { name: "查看举报记录" }));
  expect(await screen.findByText("Synthetic report evidence for account A")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "处理记录" })).toHaveAttribute("aria-current", "page");
  expect(communityApi.myReports).toHaveBeenCalledTimes(1);
  expect(communityApi.annotation).not.toHaveBeenCalled();
  expect(window.location.pathname).toBe("/");
});
