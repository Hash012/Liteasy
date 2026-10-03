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
