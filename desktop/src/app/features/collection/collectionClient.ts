import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { CollectionItem } from "./collection.types";

export type CollectionTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type CollectionTransport = (
  request: CollectionTransportRequest
) => Promise<ModelTransportResponse>;

type CreateCollectionClientInput = {
  endpoint: string;
  transport?: CollectionTransport;
};

type CollectionPayload = {
  items: CollectionItem[];
};

function isCollectionItem(item: unknown): item is CollectionItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "id" in item &&
    typeof item.id === "string" &&
    "reason" in item &&
    typeof item.reason === "string" &&
    "savedAt" in item &&
    typeof item.savedAt === "string" &&
    "source" in item &&
    typeof item.source === "string" &&
    "title" in item &&
    typeof item.title === "string"
  );
}

function isCollectionPayload(payload: unknown): payload is CollectionPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "items" in payload &&
    Array.isArray(payload.items) &&
    payload.items.every(isCollectionItem)
  );
}

function buildCollectionListUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/collection/list`;
}

function buildCollectionSaveUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/collection/items`;
}

async function defaultTransport(request: CollectionTransportRequest): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function createCollectionClient({
  endpoint,
  transport = defaultTransport
}: CreateCollectionClientInput) {
  return {
    async list(sessionId: string): Promise<CollectionItem[]> {
      const response = await transport({
        body: JSON.stringify({ sessionId }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST",
        url: buildCollectionListUrl(endpoint)
      });

      if (!response.ok) {
        throw new Error(`云端收藏加载失败（${response.status}）`);
      }

      const payload = await response.json();
      if (!isCollectionPayload(payload)) {
        throw new Error("云端收藏返回格式无效");
      }

      return payload.items;
    },
    async save(sessionId: string, item: CollectionItem): Promise<CollectionItem[]> {
      const response = await transport({
        body: JSON.stringify({
          item,
          sessionId
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST",
        url: buildCollectionSaveUrl(endpoint)
      });

      if (!response.ok) {
        throw new Error(`云端收藏保存失败（${response.status}）`);
      }

      const payload = await response.json();
      if (!isCollectionPayload(payload)) {
        throw new Error("云端收藏返回格式无效");
      }

      return payload.items;
    }
  };
}
