import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AdminWorkspace } from "../AdminWorkspace";
import type { AdminApiClient } from "../api";

test("loads identity, policy, retrieval, audit, and forum data into task views", async () => {
  const api = {
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
