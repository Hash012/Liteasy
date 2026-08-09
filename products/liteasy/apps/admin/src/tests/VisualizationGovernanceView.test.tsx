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
