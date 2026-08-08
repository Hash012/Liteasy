import type { OrganizationRole } from "./organization.types";

export type OrganizationUploadPolicy = "owner_admins" | "all_members";
export type OrganizationExportPolicy = "disabled" | "admins_only" | "all_members";

export type OrganizationStoragePolicy = {
  exportPolicy: OrganizationExportPolicy;
  uploadPolicy: OrganizationUploadPolicy;
};

export type OrganizationStorageAccess = OrganizationStoragePolicy & {
  role: OrganizationRole;
};

export function canManageOrganizationLibrary(role: OrganizationRole) {
  return role === "owner" || role === "admin";
}

export function canUploadToOrganization(access: OrganizationStorageAccess) {
  return canManageOrganizationLibrary(access.role) || access.uploadPolicy === "all_members";
}

export function canExportFromOrganization(access: OrganizationStorageAccess) {
  return access.role === "owner" || access.exportPolicy === "all_members" || (
    access.role === "admin" && access.exportPolicy === "admins_only"
  );
}
