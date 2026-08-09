import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { VisualizationGovernanceView } from "../VisualizationGovernanceView";
import type { AdminApiClient } from "../api";

test("saves a user entitlement with revision, reason, and idempotency", async () => {
  const user = userEvent.setup();
  const api = {
    getVisualizationEntitlement: vi.fn(async () => ({ entitlement: {
      allowed: false,
      explicitRequestsAllowed: false,
      allowedModalities: [],
      revision: 3
    } })),
    listVisualizationAudit: vi.fn(async () => ({ rows: [] })),
    listVisualizationProviderRoutes: vi.fn(async () => ({ routes: [] })),
    listVisualizationQuotaPolicies: vi.fn(async () => ({ policies: [] })),
    listVisualizationUsage: vi.fn(async () => ({ rows: [] })),
    setVisualizationEntitlement: vi.fn(async () => ({ entitlement: {
      allowed: true,
      explicitRequestsAllowed: false,
      allowedModalities: [],
      revision: 4
    } }))
  } as unknown as AdminApiClient;

  render(<VisualizationGovernanceView api={api} principal={{ grants: [], roles: ["platform_admin"], subjectId: "admin-1" }} />);
  await waitFor(() => expect(api.listVisualizationProviderRoutes).toHaveBeenCalled());
  await user.type(screen.getByLabelText("用户 ID"), "user-1");
  await user.click(screen.getByRole("button", { name: "查询" }));
  await user.click(await screen.findByRole("switch", { name: "允许生成" }));
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(api.setVisualizationEntitlement).toHaveBeenCalledWith(expect.objectContaining({
    expectedRevision: 3,
    subjectId: "user-1"
  }));
});

test("fails closed for non platform administrators", () => {
  const api = {} as AdminApiClient;
  render(<VisualizationGovernanceView api={api} principal={{ grants: [], roles: [], subjectId: "reader-1" }} />);
  expect(screen.getByText("需要平台管理员角色。可视化治理不可用。")).toBeInTheDocument();
});

test("filters advanced usage and audit data through the administrator API", async () => {
  const user = userEvent.setup();
  const api = {
    listVisualizationAudit: vi.fn(async () => ({ rows: [] })),
    listVisualizationProviderRoutes: vi.fn(async () => ({ routes: [] })),
    listVisualizationQuotaPolicies: vi.fn(async () => ({ policies: [] })),
    listVisualizationUsage: vi.fn(async () => ({ rows: [] }))
  } as unknown as AdminApiClient;

  render(<VisualizationGovernanceView api={api} principal={{ grants: [], roles: ["platform_admin"], subjectId: "admin-1" }} />);
  await waitFor(() => expect(api.listVisualizationUsage).toHaveBeenCalled());
  await user.type(screen.getByLabelText("使用量用户 ID"), "user-usage");
  await user.click(screen.getByRole("button", { name: "刷新使用量" }));
  await waitFor(() => expect(api.listVisualizationUsage).toHaveBeenLastCalledWith({ limit: 50, subjectId: "user-usage" }));
  await user.type(screen.getByLabelText("审计用户 ID"), "user-audit");
  await user.type(screen.getByLabelText("审计操作"), "visualization_entitlement_updated");
  await user.type(screen.getByLabelText("开始日期"), "2026-08-01");
  await user.type(screen.getByLabelText("结束日期"), "2026-08-09");
  await user.click(screen.getByRole("button", { name: "刷新审计" }));
  await waitFor(() => expect(api.listVisualizationAudit).toHaveBeenLastCalledWith({
    action: "visualization_entitlement_updated",
    from: "2026-08-01",
    limit: 50,
    subjectId: "user-audit",
    to: "2026-08-09"
  }));
});

test("saves a provider enabled toggle and keeps sensitive route fields advanced", async () => {
  const user = userEvent.setup();
  const route = {
    circuitFailures: 0,
    circuitOpenUntil: null,
    circuitState: "closed" as const,
    dataClasses: ["paper"],
    enabled: true,
    endpoint: "https://provider.example/v1",
    maxConcurrency: 2,
    modalities: ["semantic_graph" as const],
    model: "sensitive-model",
    operations: ["validation" as const],
    priority: 100,
    providerId: "provider-1",
    region: "global",
    revision: 3,
    routeId: "route-1",
    secretRef: "viz-secret:provider-1",
    timeoutMs: 30000,
    updatedAt: null,
    updatedBy: "admin-1"
  };
  const api = {
    listVisualizationAudit: vi.fn(async () => ({ rows: [] })),
    listVisualizationProviderRoutes: vi.fn(async () => ({ routes: [route] })),
    listVisualizationQuotaPolicies: vi.fn(async () => ({ policies: [] })),
    listVisualizationUsage: vi.fn(async () => ({ rows: [] })),
    saveVisualizationProviderRoute: vi.fn(async (input: { route: typeof route }) => ({ route: { ...input.route, revision: 4 } }))
  } as unknown as AdminApiClient;

  render(<VisualizationGovernanceView api={api} principal={{ grants: [], roles: ["platform_admin"], subjectId: "admin-1" }} />);
  expect(await screen.findByText("route-1")).toBeInTheDocument();
  expect(screen.queryByText("https://provider.example/v1")).not.toBeInTheDocument();
  expect(screen.queryByText("sensitive-model")).not.toBeInTheDocument();
  expect(screen.queryByText("viz-secret:provider-1")).not.toBeInTheDocument();
  await user.click(screen.getByRole("switch", { name: "route-1 路由状态" }));
  await waitFor(() => expect(api.saveVisualizationProviderRoute).toHaveBeenCalledWith(expect.objectContaining({
    expectedRevision: 3,
    route: expect.objectContaining({ enabled: false, routeId: "route-1" })
  })));
});

test("creates a usable route with mutation-only fields and a valid initial revision", async () => {
  const user = userEvent.setup();
  const api = {
    listVisualizationAudit: vi.fn(async () => ({ rows: [] })),
    listVisualizationProviderRoutes: vi.fn(async () => ({ routes: [] })),
    listVisualizationQuotaPolicies: vi.fn(async () => ({ policies: [] })),
    listVisualizationUsage: vi.fn(async () => ({ rows: [] })),
    saveVisualizationProviderRoute: vi.fn(async (input: { route: Record<string, unknown> }) => ({
      route: { ...input.route, revision: 1, updatedAt: null, updatedBy: "admin-1" }
    }))
  } as unknown as AdminApiClient;
  render(<VisualizationGovernanceView api={api} principal={{ grants: [], roles: ["platform_admin"], subjectId: "admin-1" }} />);
  await waitFor(() => expect(api.listVisualizationProviderRoutes).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "新增路由" }));
  await user.clear(screen.getByLabelText("路由 ID"));
  await user.type(screen.getByLabelText("路由 ID"), "route-new");
  await user.clear(screen.getByLabelText("Provider ID"));
  await user.type(screen.getByLabelText("Provider ID"), "provider-new");
  await user.clear(screen.getByLabelText("Endpoint"));
  await user.type(screen.getByLabelText("Endpoint"), "https://provider.example/v1");
  await user.clear(screen.getByLabelText("Model"));
  await user.type(screen.getByLabelText("Model"), "visual-1");
  await user.clear(screen.getByLabelText("Secret Ref"));
  await user.type(screen.getByLabelText("Secret Ref"), "viz-secret:new");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(api.saveVisualizationProviderRoute).toHaveBeenCalled());
  const payload = (api.saveVisualizationProviderRoute as any).mock.calls[0][0];
  expect(payload.expectedRevision).toBe(0);
  expect(payload.route.revision).toBe(1);
  expect(payload.route.operations).toContain("structured_generation");
  expect(payload.route.modalities.length).toBeGreaterThan(0);
  expect(payload.route.dataClasses.length).toBeGreaterThan(0);
  expect(payload.route).not.toHaveProperty("updatedAt");
  expect(payload.route).not.toHaveProperty("updatedBy");
});

test("does not save entitlement flags under a different subject after switching the query", async () => {
  const user = userEvent.setup();
  const getVisualizationEntitlement = vi.fn(async ({ subjectId }: { subjectId: string }) => ({ entitlement: {
    allowed: subjectId === "user-a", explicitRequestsAllowed: false, allowedModalities: [], revision: 2
  } }));
  const api = {
    getVisualizationEntitlement,
    listVisualizationAudit: vi.fn(async () => ({ rows: [] })),
    listVisualizationProviderRoutes: vi.fn(async () => ({ routes: [] })),
    listVisualizationQuotaPolicies: vi.fn(async () => ({ policies: [] })),
    listVisualizationUsage: vi.fn(async () => ({ rows: [] })),
    setVisualizationEntitlement: vi.fn(async () => ({ entitlement: {
      allowed: true, explicitRequestsAllowed: false, allowedModalities: [], revision: 3
    } }))
  } as unknown as AdminApiClient;
  render(<VisualizationGovernanceView api={api} principal={{ grants: [], roles: ["platform_admin"], subjectId: "admin-1" }} />);
  await waitFor(() => expect(api.listVisualizationProviderRoutes).toHaveBeenCalled());
  const subject = screen.getByLabelText("用户 ID");
  await user.type(subject, "user-a");
  await user.click(screen.getByRole("button", { name: "查询" }));
  await screen.findByRole("switch", { name: "允许生成" });
  await user.clear(subject);
  await user.type(subject, "user-b");
  expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  expect(api.setVisualizationEntitlement).not.toHaveBeenCalled();
});

test("looks up and creates a quota policy with an explicit timezone", async () => {
  const user = userEvent.setup();
  const api = {
    listVisualizationAudit: vi.fn(async () => ({ rows: [] })),
    listVisualizationProviderRoutes: vi.fn(async () => ({ routes: [] })),
    listVisualizationQuotaPolicies: vi.fn(async ({ subjectId }: { subjectId?: string } = {}) => ({ policies: subjectId ? [] : [] })),
    listVisualizationUsage: vi.fn(async () => ({ rows: [] })),
    setVisualizationQuotaPolicy: vi.fn(async (input: any) => ({ policy: { ...input, revision: 1, updatedAt: null, updatedBy: "admin-1", reason: input.reason } }))
  } as unknown as AdminApiClient;
  render(<VisualizationGovernanceView api={api} principal={{ grants: [], roles: ["platform_admin"], subjectId: "admin-1" }} />);
  await waitFor(() => expect(api.listVisualizationProviderRoutes).toHaveBeenCalled());
  await user.type(screen.getByLabelText("配额用户 ID"), "user-outside-page");
  await user.click(screen.getByRole("button", { name: "查询配额" }));
  await screen.findByLabelText("user-outside-page 每日配额");
  await user.selectOptions(screen.getByLabelText("user-outside-page 时区"), "Asia/Shanghai");
  await user.click(screen.getByRole("button", { name: "保存 user-outside-page 配额" }));
  await waitFor(() => expect(api.setVisualizationQuotaPolicy).toHaveBeenCalledWith(expect.objectContaining({
    expectedRevision: 0, subjectId: "user-outside-page", timezone: "Asia/Shanghai"
  })));
});
