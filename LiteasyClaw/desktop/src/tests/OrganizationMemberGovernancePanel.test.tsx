import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { AccountSession } from "../app/features/account/account.types";
import { OrganizationMemberGovernancePanel } from "../app/features/organization/OrganizationMemberGovernancePanel";
import type { OrganizationActionTransport } from "../app/features/organization/organizationActionsClient";
import type { OrganizationSummary } from "../app/features/organization/organization.types";

const accountSession: AccountSession = {
  email: "owner@example.com",
  expiresAt: "2026-08-20T00:00:00.000Z",
  name: "Owner",
  sessionId: "access-token",
  userId: "owner-1"
};

const summary: OrganizationSummary = {
  auditEvents: [],
  memberCount: 3,
  members: [
    { id: "owner-1", name: "Owner", revision: 9, role: "owner", status: "active", subject: "owner-1" },
    { id: "admin-1", name: "Admin", revision: 2, role: "admin", status: "active", subject: "admin-1" },
    { id: "member-1", name: "Member", revision: 4, role: "member", status: "active", subject: "member-1" }
  ],
  myMemberRevision: null,
  myRole: "owner",
  name: "Research Group",
  notifications: [],
  organizationId: "org-1",
  quota: { configured: false, storageLimitGb: 0, storageUsedGb: 0 },
  revision: 9,
  sharedLibrary: {
    documentCount: 0,
    documents: [],
    name: "Research Group 共享文献库",
    status: "available"
  }
};

function response(payload: unknown = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200
  });
}

test("confirms and submits owner-only member role changes with revisions", async () => {
  const user = userEvent.setup();
  const onChanged = vi.fn();
  const transport = vi.fn<OrganizationActionTransport>(async () => response());
  render(
    <OrganizationMemberGovernancePanel
      accountSession={accountSession}
      endpoint="https://cloud.example"
      onChanged={onChanged}
      summary={summary}
      transport={transport}
    />
  );

  await user.click(screen.getByRole("button", { name: "展开成员治理" }));
  await user.click(screen.getByRole("button", { name: "设为管理员 Member" }));
  expect(screen.getByRole("alertdialog", { name: "确认成员治理操作" })).toHaveTextContent("设为管理员：Member");
  await user.click(screen.getByRole("button", { name: "确认" }));

  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0].url).toBe("https://cloud.example/v1/org/members/role");
  expect(transport.mock.calls[0][0].headers.Authorization).toBe("Bearer access-token");
  expect(JSON.parse(transport.mock.calls[0][0].body)).toEqual(expect.objectContaining({
    expectedMemberRevision: 4,
    expectedRevision: 9,
    organizationId: "org-1",
    role: "admin",
    targetSubject: "member-1"
  }));
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test("does not let an organization administrator govern another administrator", async () => {
  const user = userEvent.setup();
  render(
    <OrganizationMemberGovernancePanel
      accountSession={{ ...accountSession, name: "Admin", userId: "admin-1" }}
      endpoint="https://cloud.example"
      onChanged={() => undefined}
      summary={{ ...summary, myMemberRevision: 2, myRole: "admin" }}
      transport={async () => response()}
    />
  );

  await user.click(screen.getByRole("button", { name: "展开成员治理" }));
  expect(screen.queryByRole("button", { name: "暂停成员 Admin" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "暂停成员 Member" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /转移所有权/ })).not.toBeInTheDocument();
});
