import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createOrganizationListClient } from "../app/features/organization/organizationListClient";
import { createOrganizationSummaryClient } from "../app/features/organization/organizationSummaryClient";
import { OrganizationOverview } from "../app/features/organization/OrganizationOverview";
import { organizationUiSummary } from "./fixtures/organizationUiFixtures";

const memberSnapshot = {
  actionConstraints: { inviteRoles: [] },
  allowedActions: ["read_metadata", "read_body", "comment"],
  authorizationRevision: 12,
  denialReasons: {
    change_role: "organization_owner_required",
    edit_own: "organization_resource_context_required",
    export_original: "organization_export_forbidden",
    invite: "organization_role_forbidden",
    moderate: "organization_role_forbidden",
    publish_public: "organization_external_use_policy_unconfirmed",
    run_external_model: "organization_external_use_policy_unconfirmed",
    share_excerpt: "organization_external_use_policy_unconfirmed",
    transfer_owner: "organization_owner_required",
    upload: "organization_upload_forbidden"
  },
  policyExceptions: [],
  policyRevision: 7
};

function fetchSummary(snapshot: Record<string, unknown>) {
  return createOrganizationSummaryClient({
    endpoint: "https://synthetic.invalid",
    transport: async () => ({
      json: async () => ({ summary: { ...organizationUiSummary, ...snapshot } }),
      ok: true,
      status: 200
    })
  })({ sessionId: "synthetic-token", organizationId: "research" });
}

test("carries the authoritative snapshot through both organization clients", async () => {
  const summary = await fetchSummary(memberSnapshot);
  const list = await createOrganizationListClient({
    endpoint: "https://synthetic.invalid",
    transport: async () => ({
      json: async () => ({ organizations: [{ ...organizationUiSummary, ...memberSnapshot }] }),
      ok: true,
      status: 200
    })
  })({ sessionId: "synthetic-token" });
  expect(summary.accessSnapshot).toEqual(memberSnapshot);
  expect(list.organizations[0].accessSnapshot).toEqual(memberSnapshot);
});

test("shows allowed actions and explains export and external-use denials for members", async () => {
  const user = userEvent.setup();
  render(<OrganizationOverview summary={await fetchSummary(memberSnapshot)} />);
  await user.click(screen.getByText("我的组织权限"));
  const permissions = screen.getByRole("list", { name: "组织权限明细" });
  const readRow = within(permissions).getByText("阅读组织内容").closest("li")!;
  expect(within(readRow).getByText("可用")).toBeInTheDocument();
  const exportRow = within(permissions).getByText("导出原文件").closest("li")!;
  expect(within(exportRow).getByText("不可用")).toBeInTheDocument();
  expect(within(exportRow).getByText("当前组织策略不允许你导出原文件。")).toBeInTheDocument();
  const externalRow = within(permissions).getByText("使用外部 AI").closest("li")!;
  expect(within(externalRow).getByText("尚未获得组织材料外发授权。")).toBeInTheDocument();
  expect(screen.getByText("策略版本 7 · 组织版本 12")).toBeInTheDocument();
});

test("explains the existing owner export exception and constrained invitation roles", async () => {
  const { export_original, invite, change_role, transfer_owner, moderate, upload, ...denialReasons } = memberSnapshot.denialReasons;
  render(<OrganizationOverview summary={await fetchSummary({
    ...memberSnapshot,
    actionConstraints: { inviteRoles: ["admin", "member"] },
    allowedActions: [...memberSnapshot.allowedActions, "export_original", "invite", "change_role", "transfer_owner", "moderate", "upload"],
    denialReasons,
    myRole: "owner",
    policyExceptions: ["owner_export"]
  })} />);
  await userEvent.setup().click(screen.getByText("我的组织权限"));
  expect(screen.getByText("组织已限制导出；所有者仍可导出原文件。此例外仅适用于原文件导出，不授予公开发布或外部 AI 使用权限。")).toBeInTheDocument();
  expect(screen.getByText("可邀请管理员或成员。")).toBeInTheDocument();
});

test.each([
  {},
  { ...memberSnapshot, policyRevision: -1 },
  { ...memberSnapshot, allowedActions: [...memberSnapshot.allowedActions, "export_original"] }
])("does not invent approved actions when the snapshot is absent or inconsistent", async (snapshot) => {
  const summary = await fetchSummary(snapshot);
  expect(summary.accessSnapshot).toBeUndefined();
  render(<OrganizationOverview summary={summary} />);
  await userEvent.setup().click(screen.getByText("我的组织权限"));
  expect(screen.getByText("暂无法获取权限说明，请刷新组织空间后重试。")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "组织权限明细" })).not.toBeInTheDocument();
});
