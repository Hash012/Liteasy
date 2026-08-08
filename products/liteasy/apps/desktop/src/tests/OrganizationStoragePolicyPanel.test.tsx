import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  OrganizationStoragePolicyPanel,
  type OrganizationStoragePolicyClient
} from "../app/features/organization/OrganizationStoragePolicyPanel";
import type { OrganizationSummary } from "../app/features/organization/organization.types";

function summary(myRole: OrganizationSummary["myRole"]): OrganizationSummary {
  return {
    auditEvents: [],
    memberCount: 1,
    members: [],
    myRole,
    name: "Research Group",
    notifications: [],
    organizationId: "organization-1",
    quota: { periodEndsAt: "2026-09-01", storageLimitGb: 10, storageUsedGb: 1 },
    sharedLibrary: { documentCount: 0, documents: [], name: "Library", status: "available" },
    taskSummary: { failed: 0, running: 0 }
  };
}

function policy(revision = 4) {
  return {
    exportPolicy: "disabled" as const,
    revision,
    role: "owner" as const,
    updatedAt: "2026-08-06T00:00:00.000Z",
    updatedBy: "owner-1",
    uploadPolicy: "owner_admins" as const
  };
}

describe("OrganizationStoragePolicyPanel", () => {
  test("saves owner changes against the server revision", async () => {
    const client: OrganizationStoragePolicyClient = {
      getOrganizationStoragePolicy: vi.fn(async () => policy()),
      updateOrganizationStoragePolicy: vi.fn(async (input) => ({
        ...policy(5),
        exportPolicy: input.exportPolicy,
        uploadPolicy: input.uploadPolicy
      }))
    };
    render(
      <OrganizationStoragePolicyPanel
        client={client}
        endpoint="https://cloud.example.test"
        summary={summary("owner")}
      />
    );

    await waitFor(() => expect(screen.getByLabelText("允许上传")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("允许上传"), { target: { value: "all_members" } });
    fireEvent.change(screen.getByLabelText("允许复制出库"), { target: { value: "admins_only" } });
    fireEvent.click(screen.getByRole("button", { name: "保存策略" }));

    await waitFor(() => expect(client.updateOrganizationStoragePolicy).toHaveBeenCalledWith({
      expectedRevision: 4,
      exportPolicy: "admins_only",
      organizationId: "organization-1",
      uploadPolicy: "all_members"
    }));
    expect(await screen.findByText("组织存储策略已更新。")).toBeInTheDocument();
  });

  test("keeps policy read-only for non-owners", async () => {
    const client: OrganizationStoragePolicyClient = {
      getOrganizationStoragePolicy: vi.fn(async () => ({ ...policy(), role: "member" })),
      updateOrganizationStoragePolicy: vi.fn()
    };
    render(
      <OrganizationStoragePolicyPanel
        client={client}
        endpoint="https://cloud.example.test"
        summary={summary("member")}
      />
    );

    expect(client.getOrganizationStoragePolicy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("允许上传")).toBeDisabled();
    expect(screen.getByLabelText("允许上传")).toHaveValue("owner_admins");
    expect(screen.queryByRole("button", { name: "保存策略" })).not.toBeInTheDocument();
  });
});
