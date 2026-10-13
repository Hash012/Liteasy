import userEvent from "@testing-library/user-event";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AdminWorkspace } from "../AdminWorkspace";
import type { AdminApiClient } from "../api";

afterEach(cleanup);

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
  expect(await screen.findByText("MFA 有效")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "组织治理" }));
  expect(await screen.findByText("Research Team")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "模型与检索" }));
  expect(await screen.findByDisplayValue("https://models.liteasy.example")).toBeInTheDocument();
  expect(screen.getByText("Public Search")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "审计" }));
  expect(await screen.findByText("model_policy_updated")).toBeInTheDocument();
  expect(screen.getByText("trace-1")).toBeInTheDocument();
});

test("historical appeals with unknown submission audience show status without enabling review", async () => {
  const api = {
    identity: async () => ({ authentication: { fresh: true, methods: ["mfa"] }, principal: { grants: [], roles: ["platform_admin"], subjectId: "admin" } }),
    modelPolicy: async () => null,
    retrievalSources: async () => ({ sources: [] }),
    governance: async () => ({ accountStatuses: [], organizations: [], roleGrants: [], supportGrants: [] }),
    audit: async () => ({ events: [], nextBefore: null }),
    forumAnnotations: async () => ({ annotations: [] }),
    forumTagAppeals: async () => ({ appeals: [{ appealId: "legacy-appeal", annotationId: "public-annotation", annotationBody: "", authorName: "", createdAt: "2026-10-03", detailsAvailable: false, reason: "", resolvedAt: null, resolutionReason: null, status: "pending", submittedBy: "", tag: "Synthetic label" }] }),
    resolveForumTagAppeal: vi.fn()
  } as unknown as AdminApiClient;
  render(<AdminWorkspace api={api} onLogout={async () => undefined} onReauthenticate={async () => undefined} session={{ accessToken: "token", expiresAt: "2026-10-03T12:00:00.000Z", mode: "oauth", subjectId: "admin" }} />);
  fireEvent.click(screen.getByRole("button", { name: "论坛治理" }));
  expect(await screen.findByText("提交时受众未知，等待作者重新提交材料")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "移除标签" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "维持标签" })).toBeDisabled();
  expect(api.resolveForumTagAppeal).not.toHaveBeenCalled();
});


function statusApi() {
  return { identity: vi.fn(async () => ({ authentication: { fresh: true, methods: ["pwd", "mfa"] }, principal: { grants: [], roles: ["platform_admin"], subjectId: "admin" } })),
    modelPolicy: async () => null, retrievalSources: async () => ({ sources: [] }),
    governance: async () => ({ accountStatuses: [], organizations: [], roleGrants: [], supportGrants: [] }),
    audit: async () => ({ events: [], nextBefore: null }), forumAnnotations: async () => ({ annotations: [] }),
    forumTagAppeals: async () => ({ appeals: [] }), accountStatus: vi.fn(async () => undefined) } as unknown as AdminApiClient;
}
function renderStatusWorkspace(api: AdminApiClient) {
  return render(<AdminWorkspace api={api} onLogout={async () => undefined} onReauthenticate={async () => undefined}
    session={{ accessToken: "test-token", expiresAt: "2026-10-13T20:00:00.000Z", mode: "oauth", subjectId: "admin" }} />);
}

test.each([["禁用", "disabled"], ["删除", "deleted"]])("status picker submits the selected %s value only after confirmation", async (label, value) => {
  const api = statusApi(); const user = userEvent.setup();
  renderStatusWorkspace(api);
  await waitFor(() => expect(api.identity).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "账号与角色" }));
  const submit = screen.getByRole("button", { name: "提交变更" });
  const form = submit.closest("form")!;
  await user.type(within(form).getByRole("textbox", { name: /Subject ID/ }), "member-1");
  await user.type(within(form).getByRole("textbox", { name: /原因/ }), "Approved synthetic status change");
  await user.click(submit);
  expect(screen.getByText("请选择目标状态后再提交。")).toBeInTheDocument();
  expect(api.accountStatus).not.toHaveBeenCalled();
  await user.click(screen.getByRole("combobox", { name: "目标状态" }));
  await user.click(screen.getByRole("option", { name: label }));
  expect(new FormData(form).get("status")).toBe(value);
  await user.click(submit);
  expect(api.accountStatus).not.toHaveBeenCalled();
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
  await waitFor(() => expect(api.accountStatus).toHaveBeenCalledWith({ subjectId: "member-1", status: value, reason: "Approved synthetic status change" }));
});

test("a rejected status update keeps the selected value and displays its error", async () => {
  const api = statusApi(); vi.mocked(api.accountStatus).mockRejectedValue(new Error("permission denied"));
  const user = userEvent.setup(); renderStatusWorkspace(api);
  await waitFor(() => expect(api.identity).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "账号与角色" }));
  const form = screen.getByRole("button", { name: "提交变更" }).closest("form")!;
  await user.type(within(form).getByRole("textbox", { name: /Subject ID/ }), "member-1");
  await user.type(within(form).getByRole("textbox", { name: /原因/ }), "Approved synthetic status change");
  await user.click(screen.getByRole("combobox", { name: "目标状态" }));
  await user.click(screen.getByRole("option", { name: "禁用" }));
  await user.click(screen.getByRole("button", { name: "提交变更" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
  expect(await screen.findByText("permission denied")).toBeInTheDocument();
  expect(new FormData(form).get("status")).toBe("disabled");
  expect(screen.getByRole("combobox", { name: "目标状态" })).toHaveTextContent("禁用");
});


test("retrieval picker values preserve the existing named form payload", async () => {
  const api = statusApi();
  api.saveRetrievalSource = vi.fn(async (input) => ({ source: { ...input, sourceId: "new-source", revision: 1, updatedAt: "2026-10-13", updatedBy: "admin" } }));
  const user = userEvent.setup(); renderStatusWorkspace(api);
  await waitFor(() => expect(api.identity).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "模型与检索" }));
  const form = screen.getByRole("combobox", { name: "连接器" }).closest("form")!;
  await user.type(within(form).getByRole("textbox", { name: /^名称/ }), "Synthetic source");
  await user.type(within(form).getByRole("textbox", { name: /原因/ }), "Approved synthetic source");
  for (const [label, choice] of [["类型", "网站"], ["连接器", "OpenAlex"], ["状态", "停用"]]) {
    await user.click(within(form).getByRole("combobox", { name: label }));
    await user.click(screen.getByRole("option", { name: choice }));
  }
  expect(Object.fromEntries(new FormData(form))).toMatchObject({ sourceKind: "website", connectorType: "openalex", enabled: "false" });
  await user.click(within(form).getByRole("button", { name: "保存" }));
  await waitFor(() => expect(api.saveRetrievalSource).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: "website", connectorType: "openalex", enabled: false, name: "Synthetic source" })));
});
