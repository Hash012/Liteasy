import type { ModelTransportResponse } from "../models/modelHttpClient";
import type {
  OrganizationSharedLibraryManifest,
  OrganizationSharedLibraryManifestInput
} from "./organization.types";

export type OrganizationSharedLibraryManifestTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type OrganizationSharedLibraryManifestTransport = (
  request: OrganizationSharedLibraryManifestTransportRequest
) => Promise<ModelTransportResponse>;

type CreateOrganizationSharedLibraryManifestClientInput = {
  endpoint: string;
  transport?: OrganizationSharedLibraryManifestTransport;
};

type OrganizationSharedLibraryManifestPayload = {
  manifest: OrganizationSharedLibraryManifest;
};

function buildOrganizationSharedLibraryManifestUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/org/shared-library/manifest`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasStringField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === "string";
}

function isSharedLibraryStatus(value: unknown) {
  return value === "available" || value === "syncing" || value === "unavailable";
}

function isManifestPayload(payload: unknown): payload is OrganizationSharedLibraryManifestPayload {
  if (!isRecord(payload) || !isRecord(payload.manifest)) {
    return false;
  }

  const manifest = payload.manifest;
  return (
    Array.isArray(manifest.documents) &&
    manifest.documents.every(
      (document) =>
        isRecord(document) &&
        hasStringField(document, "folderId") &&
        hasStringField(document, "id") &&
        hasStringField(document, "sourcePath") &&
        hasStringField(document, "title")
    ) &&
    Array.isArray(manifest.folders) &&
    manifest.folders.every(
      (folder) =>
        isRecord(folder) &&
        hasStringField(folder, "id") &&
        hasStringField(folder, "name") &&
        (typeof folder.parentId === "string" || folder.parentId === null) &&
        hasStringField(folder, "path")
    ) &&
    hasStringField(manifest, "name") &&
    hasStringField(manifest, "organizationId") &&
    hasStringField(manifest, "rootFolderId") &&
    isSharedLibraryStatus(manifest.status)
  );
}

async function defaultTransport(
  request: OrganizationSharedLibraryManifestTransportRequest
): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function createOrganizationSharedLibraryManifestClient({
  endpoint,
  transport = defaultTransport
}: CreateOrganizationSharedLibraryManifestClientInput) {
  return async (input: OrganizationSharedLibraryManifestInput): Promise<OrganizationSharedLibraryManifest> => {
    const response = await transport({
      body: JSON.stringify({
        organizationId: input.organizationId,
        sessionId: input.sessionId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      url: buildOrganizationSharedLibraryManifestUrl(endpoint)
    });

    if (!response.ok) {
      throw new Error(`组织共享文献库目录加载失败（${response.status}）`);
    }

    const payload = await response.json();
    if (!isManifestPayload(payload)) {
      throw new Error("组织共享文献库目录返回格式无效");
    }

    return payload.manifest;
  };
}
