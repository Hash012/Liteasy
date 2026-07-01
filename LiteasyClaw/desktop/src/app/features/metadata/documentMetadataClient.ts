import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { DocumentMetadataSyncInput, DocumentMetadataSyncResult } from "./metadata.types";

export type DocumentMetadataTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type DocumentMetadataTransport = (
  request: DocumentMetadataTransportRequest
) => Promise<ModelTransportResponse>;

type CreateDocumentMetadataClientInput = {
  endpoint: string;
  transport?: DocumentMetadataTransport;
};

type DocumentMetadataPayload = {
  result: DocumentMetadataSyncResult;
};

function buildDocumentMetadataUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/documents/metadata-sync`;
}

function isDocumentMetadataPayload(payload: unknown): payload is DocumentMetadataPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "result" in payload &&
    typeof payload.result === "object" &&
    payload.result !== null &&
    "acceptedCount" in payload.result &&
    typeof payload.result.acceptedCount === "number" &&
    "rejectedCount" in payload.result &&
    typeof payload.result.rejectedCount === "number" &&
    "syncId" in payload.result &&
    typeof payload.result.syncId === "string" &&
    "syncedAt" in payload.result &&
    typeof payload.result.syncedAt === "string"
  );
}

async function defaultTransport(
  request: DocumentMetadataTransportRequest
): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function createDocumentMetadataClient({
  endpoint,
  transport = defaultTransport
}: CreateDocumentMetadataClientInput) {
  return async (input: DocumentMetadataSyncInput): Promise<DocumentMetadataSyncResult> => {
    const response = await transport({
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      url: buildDocumentMetadataUrl(endpoint)
    });

    if (!response.ok) {
      throw new Error(`文献元数据同步失败（${response.status}）`);
    }

    const payload = await response.json();
    if (!isDocumentMetadataPayload(payload)) {
      throw new Error("文献元数据同步返回格式无效");
    }

    return payload.result;
  };
}
