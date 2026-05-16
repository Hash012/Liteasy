export type ResourceClass =
  | "local_private"
  | "user_cloud_private"
  | "organization_cloud_shared"
  | "platform_configuration"
  | "cloud_cache";

export type ResourceOwner =
  | { type: "device_user"; userId?: string }
  | { type: "user_account"; userId: string }
  | { type: "organization"; organizationId: string }
  | { type: "platform" }
  | { type: "cache_context"; scopeKey: string };

export type ResourceDescriptor = {
  owner: ResourceOwner;
  resourceClass: ResourceClass;
};
