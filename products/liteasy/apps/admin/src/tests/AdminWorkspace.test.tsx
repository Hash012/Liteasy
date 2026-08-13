import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AdminWorkspace } from "../AdminWorkspace";
import type { AdminApiClient } from "../api";

test("loads identity, policy, retrieval, audit, and forum data into task views", async () => {
  const user = userEvent.setup();
  const api = {
    accounts: vi.fn(async () => ({
      accounts: [{
        accountType: "person",
        activeRoleGrants: [{ grantId: "rolegrant-directory-user", role: "platform_admin" }],
        createdAt: "2026-08-06T00:00:00.000Z",
        email: "reader@example.com",
        emailVerified: true,
        enabled: true,
        firstName: "Lin",
        lastName: "Qiao",
        platformRoles: ["platform_admin"],
        projectedStatus: null,
        subjectId: "directory-user-id",
        username: "reader@example.com"
      }],
      first: 0,
      max: 50,
      search: "",
      total: 1
    })),
    audit: vi.fn(async () => ({ events: [{
      action: "model_policy_updated",
      actorAudience: "liteasy-admin",
      actorId: "admin-1",
      auditId: "audit-1",
      detail: {},
      occurredAt: "2026-08-07T00:00:00.000Z",
      reason: "Approved update",
      resourceId: "active",
      resourceType: "model_policy",
      scopeId: null,
      scopeType: null,
      traceId: "trace-1"
    }], nextBefore: null })),
    forumAnnotations: vi.fn(async () => ({ annotations: [] })),
    forumTagAppeals: vi.fn(async () => ({ appeals: [] })),
    governance: vi.fn(async () => ({
      accountStatuses: [],
      organizations: [{
        createdAt: "2026-08-07T00:00:00.000Z",
        limitBytes: 2097152,
        memberCount: 3,
        name: "Research Team",
        organizationId: "organization-1",
        ownerSubject: "owner-1",
        revision: 1,
        status: "active",
        updatedAt: "2026-08-07T00:00:00.000Z",
        usedBytes: 1048576
      }],
      roleGrants: [],
      supportGrants: []
    })),
    grantRole: vi.fn(async () => ({ grant: { grantId: "rolegrant-2" } })),
    revokeRole: vi.fn(async () => ({ grantId: "rolegrant-directory-user", revoked: true as const })),
    identity: vi.fn(async () => ({
      authentication: { fresh: true, methods: ["pwd", "mfa"] },
      principal: { grants: [], roles: ["platform_admin"], subjectId: "admin-1" }
    })),
    modelPolicy: vi.fn(async () => ({
      cloudProxyEndpoint: "https://models.liteasy.example",
      defaultProvider: "openai",
      policyVersion: "policy-1",
      revision: 1,
      syncedAt: "2026-08-07T00:00:00.000Z",
      updatedBy: "admin-1"
    })),
    marketingApplications: vi.fn(async () => ({ applications: [{
      applicationId: "123e4567-e89b-42d3-a456-426614174000",
      email: "reader@example.com",
      field: "信息检索",
      installerDownloadedAt: null,
      problem: "理解复杂论文",
      role: "研究生",
      source: "marketing-site",
      submittedAt: "2026-08-07T00:00:00.000Z"
    }], nextBefore: null })),
    retrievalSources: vi.fn(async () => ({ sources: [{
      baseUrl: "https://search.example",
      connectorType: "crossref",
      enabled: true,
      name: "Public Search",
      revision: 1,
      sourceId: "source-1",
      sourceKind: "website",
      updatedAt: "2026-08-07T00:00:00.000Z",
      updatedBy: "admin-1"
    }] }))
  } as unknown as AdminApiClient;

  render(<AdminWorkspace
    api={api}
    onLogout={async () => undefined}
    onReauthenticate={async () => undefined}
    session={{ accessToken: "token", expiresAt: "2026-08-07T01:00:00.000Z", mode: "oauth", subjectId: "admin-1" }}
  />);

  await waitFor(() => expect(api.identity).toHaveBeenCalled());
  expect(await screen.findByText("多因素认证有效")).toBeInTheDocument();
  expect(screen.getAllByText("平台管理员").length).toBeGreaterThan(0);
  expect(screen.getByText("高风险操作认证")).toBeInTheDocument();
  expect(screen.getByText("最近 5 分钟内已完成多因素认证")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "账号与角色" }));
  expect(await screen.findByRole("heading", { name: "账号目录" })).toBeInTheDocument();
  expect(screen.getByText("Lin Qiao")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "用于操作" }));
  const grantSection = screen.getByRole("heading", { name: "授予平台角色" }).closest("section");
  expect(grantSection).not.toBeNull();
  const grantForm = within(grantSection as HTMLElement);
  expect(grantForm.getByRole("textbox", { name: /用户标识/ })).toHaveValue("directory-user-id");
  await user.type(grantForm.getByRole("textbox", { name: /原因/ }), "预发布管理账号授权");
  await user.click(grantForm.getByRole("button", { name: "授予角色" }));
  await waitFor(() => expect(api.grantRole).toHaveBeenCalledWith({
    reason: "预发布管理账号授权",
    role: "platform_admin",
    subjectId: "directory-user-id"
  }));
  const revokeSection = screen.getByRole("heading", { name: "撤销平台角色" }).closest("section");
  expect(revokeSection).not.toBeNull();
  const revokeForm = within(revokeSection as HTMLElement);
  expect(revokeForm.getByRole("combobox", { name: /要撤销的平台角色/ })).toHaveValue("rolegrant-directory-user");
  await user.type(revokeForm.getByRole("textbox", { name: /原因/ }), "撤销不再需要的管理员授权");
  await user.click(revokeForm.getByRole("button", { name: "撤销角色" }));
  await user.click(await screen.findByRole("button", { name: "确认" }));
  await waitFor(() => expect(api.revokeRole).toHaveBeenCalledWith({
    grantId: "rolegrant-directory-user",
    reason: "撤销不再需要的管理员授权"
  }));
  fireEvent.click(screen.getByRole("button", { name: "组织治理" }));
  expect(await screen.findByText("Research Team")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "模型与检索" }));
  expect(await screen.findByDisplayValue("https://models.liteasy.example")).toBeInTheDocument();
  expect(screen.getByText("Public Search")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "体验申请" }));
  expect(await screen.findByText("reader@example.com")).toBeInTheDocument();
  expect(screen.getByText("理解复杂论文")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "审计" }));
  expect(await screen.findByText("model_policy_updated")).toBeInTheDocument();
  expect(screen.getByText("trace-1")).toBeInTheDocument();
});
