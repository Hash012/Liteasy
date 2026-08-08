import { describe, expect, test } from "vitest";
import {
  canExportFromOrganization,
  canManageOrganizationLibrary,
  canUploadToOrganization,
  type OrganizationStorageAccess
} from "../app/features/organization/organizationStoragePolicy";

function access(
  role: OrganizationStorageAccess["role"],
  uploadPolicy: OrganizationStorageAccess["uploadPolicy"],
  exportPolicy: OrganizationStorageAccess["exportPolicy"]
): OrganizationStorageAccess {
  return { exportPolicy, role, uploadPolicy };
}

describe("organization storage policy", () => {
  test.each([
    ["owner", "owner_admins", true],
    ["admin", "owner_admins", true],
    ["member", "owner_admins", false],
    ["owner", "all_members", true],
    ["admin", "all_members", true],
    ["member", "all_members", true]
  ] as const)("evaluates %s uploads under %s", (role, policy, expected) => {
    expect(canUploadToOrganization(access(role, policy, "disabled"))).toBe(expected);
  });

  test.each([
    ["owner", "disabled", true],
    ["admin", "disabled", false],
    ["member", "disabled", false],
    ["owner", "admins_only", true],
    ["admin", "admins_only", true],
    ["member", "admins_only", false],
    ["owner", "all_members", true],
    ["admin", "all_members", true],
    ["member", "all_members", true]
  ] as const)("evaluates %s exports under %s", (role, policy, expected) => {
    expect(canExportFromOrganization(access(role, "owner_admins", policy))).toBe(expected);
  });

  test("limits organization tree management to owners and admins", () => {
    expect(canManageOrganizationLibrary("owner")).toBe(true);
    expect(canManageOrganizationLibrary("admin")).toBe(true);
    expect(canManageOrganizationLibrary("member")).toBe(false);
  });
});
