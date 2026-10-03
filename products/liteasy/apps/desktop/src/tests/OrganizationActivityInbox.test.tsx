import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrganizationActivityInbox } from "../app/features/organization/OrganizationActivityInbox";
import { clearStoredAccountSession, storeAccountSession } from "../app/features/account/accountSessionStorage";
import type { AccountSession } from "../app/features/account/account.types";
const session = { userId: "synthetic-a", name: "Reader A", sessionId: "synthetic-token", audience: "liteasy-desktop", issuer: "https://identity.example.test", endpoint: "https://cloud.example.test" } as AccountSession;
beforeEach(() => { localStorage.clear(); storeAccountSession(session); });
afterEach(() => { clearStoredAccountSession(); vi.unstubAllGlobals(); });
const enable = () => { fireEvent.click(screen.getByLabelText("查看我的权限与加入结果")); fireEvent.click(screen.getByText("刷新我的动态")); };
it("does not request activity before opting in and refreshing", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ activities: [{ id: "own-role-event", available: true, organizationName: "Synthetic Group", kind: "permissions_changed" }] })));
  vi.stubGlobal("fetch", fetch);
  render(<OrganizationActivityInbox session={session} endpoint={session.endpoint!} />);
  expect(fetch).not.toHaveBeenCalled();
  enable();
  expect(await screen.findByText("Synthetic Group · 成员权限已变化")).toBeInTheDocument();
  fireEvent.click(screen.getByText("标为已读"));
  expect(screen.getByText("已读")).toBeInTheDocument();
  expect(localStorage.getItem(`liteasy.organization-activity.v1:${JSON.stringify([session.endpoint, session.issuer, session.userId])}`)).not.toContain(session.sessionId);
});
it("hides late activity after switching account and after disabling the view", async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise((done) => { resolve = done; })));
  const { rerender } = render(<OrganizationActivityInbox session={session} endpoint={session.endpoint!} />);
  enable();
  const next = { ...session, userId: "synthetic-b", sessionId: "token-b" };
  storeAccountSession(next);
  rerender(<OrganizationActivityInbox session={next} endpoint={session.endpoint!} />);
  await act(async () => resolve(new Response(JSON.stringify({ activities: [{ id: "a", available: true, organizationName: "A private name", kind: "permissions_changed" }] }))));
  expect(screen.queryByText(/A private name/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("查看我的权限与加入结果")).not.toBeChecked();
});
it("never sends the account credential to a different endpoint", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<OrganizationActivityInbox session={session} endpoint="https://other.example.test" />);
  enable();
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("账号或服务地址已变化"));
  expect(fetch).not.toHaveBeenCalled();
});
