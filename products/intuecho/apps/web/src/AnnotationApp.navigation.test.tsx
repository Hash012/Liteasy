import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AnnotationApp } from "./AnnotationApp";
import { communityApi } from "./communityApi";
import { identityApi, readIdentitySession } from "./identityClient";
import type { IdentitySession } from "./identity.types";

vi.mock("./communityApi", () => ({
  communityApi: {
    academicProfile: vi.fn(),
    conversations: vi.fn(),
    followingAnnotations: vi.fn(),
    myAnnotations: vi.fn(),
    organizationAnnotations: vi.fn(),
    plaza: vi.fn()
  }
}));

vi.mock("./identityClient", () => ({
  identityApi: {
    initialize: vi.fn(),
    logout: vi.fn()
  },
  readIdentitySession: vi.fn(),
  setAuthRequiredHandler: vi.fn()
}));

const session: IdentitySession = {
  audience: "intuecho-web",
  email: "reader@example.edu",
  expiresAt: "2026-08-13T00:00:00.000Z",
  name: "Test Reader",
  sessionId: "test-access-token",
  userId: "user-1"
};

const annotation = {
  author: {
    id: "user-2",
    initials: "TR",
    name: "Test Researcher",
    profile: { educationStage: "研究生", institutions: [{ name: "Example University" }] }
  },
  body: "Portal regression annotation",
  createdAt: "2026-08-12T00:00:00.000Z",
  id: "annotation-1",
  organizationId: null,
  originalReply: null,
  ratingAverage: null,
  ratingCount: 0,
  revision: 1,
  shareToPlaza: true,
  tags: [],
  targets: [],
  updatedAt: "2026-08-12T00:00:00.000Z",
  viewerCanModerate: false,
  viewerIsAuthor: false,
  viewerSaved: false,
  viewerRating: null,
  visibility: "public" as const,
  withdrawnAt: null
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const initialize = vi.mocked(identityApi.initialize);
const readSession = vi.mocked(readIdentitySession);
const academicProfile = vi.mocked(communityApi.academicProfile);
const conversations = vi.mocked(communityApi.conversations);
const followingAnnotations = vi.mocked(communityApi.followingAnnotations);
const myAnnotations = vi.mocked(communityApi.myAnnotations);
const organizationAnnotations = vi.mocked(communityApi.organizationAnnotations);
const plaza = vi.mocked(communityApi.plaza);

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
  readSession.mockReturnValue(session);
  initialize.mockResolvedValue({ mode: "oauth", session });
  academicProfile.mockResolvedValue({
    profile: { educationStage: "研究生", institutions: [{ name: "Example University" }], revision: 1 }
  });
  followingAnnotations.mockResolvedValue({ annotations: [] });
  myAnnotations.mockResolvedValue({ annotations: [] });
  organizationAnnotations.mockResolvedValue({ organizations: [] });
  plaza.mockResolvedValue({ annotations: [], filters: { sort: "recommended" } });
});

afterEach(() => cleanup());

test("keeps the new annotation control free of dynamic tooltip portals", async () => {
  const user = userEvent.setup();
  conversations.mockResolvedValue({ conversations: [] });
  render(<AnnotationApp />);

  const publish = screen.getByRole("button", { name: "发布批注" });
  expect(publish).toHaveAttribute("title", "发布批注");
  await user.hover(publish);
  expect(screen.queryByRole("tooltip", { name: "发布批注" })).not.toBeInTheDocument();
});

test("does not copy the application layout class onto tooltip portals", async () => {
  const user = userEvent.setup();
  conversations.mockResolvedValue({ conversations: [] });
  plaza.mockResolvedValue({ annotations: [annotation], filters: { sort: "recommended" } });
  render(<AnnotationApp />);

  const follow = await screen.findByRole("button", { name: "关注发布者" });
  await user.hover(follow);
  const tooltip = await screen.findByRole("tooltip", { name: "关注发布者" });
  const portal = tooltip.closest("[data-portal-node='true']");

  expect(portal).toBeInTheDocument();
  expect(portal).not.toHaveClass("annotation-app");
});

test.each([
  { navigation: null, pageName: "广场" },
  { navigation: "关注", pageName: "关注" },
  { navigation: "信息", pageName: "私聊" },
  { navigation: "我的批注", pageName: "我的批注" },
  { navigation: "组织批注", pageName: "组织批注" }
])("keeps the new annotation composer open on $pageName while inbox data updates", async ({ navigation }) => {
  const user = userEvent.setup();
  const inbox = deferred<Awaited<ReturnType<typeof communityApi.conversations>>>();
  conversations.mockReturnValue(inbox.promise);
  const { container } = render(<AnnotationApp />);

  if (navigation) await user.click(screen.getByRole("button", { name: navigation }));
  await user.click(screen.getByRole("button", { name: "发布批注" }));

  const dialog = screen.getByRole("dialog", { name: "发布批注" });
  expect(dialog).toBeVisible();
  expect(container).not.toContainElement(dialog);
  expect(dialog.closest("[data-portal-node='true']")).toBeInTheDocument();
  expect(document.body).toHaveStyle({ overflow: "hidden" });

  inbox.resolve({
    conversations: [{
      canSend: true,
      createdAt: "2026-08-12T00:00:00.000Z",
      id: "conversation-1",
      lastMessage: null,
      participant: {
        id: "user-2",
        initials: "TR",
        name: "Test Researcher",
        profile: { educationStage: "研究生", institutions: [{ name: "Example University" }] }
      },
      unreadCount: 1
    }]
  });
  await waitFor(() => expect(screen.getAllByLabelText("1 条未读消息").length).toBeGreaterThan(0));
  expect(conversations).toHaveBeenCalledOnce();
  expect(dialog).toBeVisible();

  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(document.body.style.overflow).toBe("");
});

test("keeps the new annotation composer open on the academic profile page", async () => {
  const user = userEvent.setup();
  conversations.mockResolvedValue({ conversations: [] });
  const { container } = render(<AnnotationApp />);

  await user.click(screen.getByRole("button", { name: "Test Reader 的账户菜单" }));
  await user.click(await screen.findByRole("menuitem", { name: "学术资料" }));
  await screen.findByRole("heading", { name: "学术资料" });
  await user.click(screen.getByRole("button", { name: "发布批注" }));

  const dialog = screen.getByRole("dialog", { name: "发布批注" });
  expect(dialog).toBeVisible();
  expect(container).not.toContainElement(dialog);
  expect(dialog.closest("[data-portal-node='true']")).toBeInTheDocument();
  expect(document.body).toHaveStyle({ overflow: "hidden" });

  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(document.body.style.overflow).toBe("");
});
