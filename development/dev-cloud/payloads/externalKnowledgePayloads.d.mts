export type ExternalKnowledgeTransportResponse = {
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
};

export type ExternalKnowledgeTransport = (
  url: string,
  options: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }
) => Promise<ExternalKnowledgeTransportResponse>;

export type ExternalKnowledgeSearchResult = {
  anchorReferenceResolution?: {
    resolved: number;
    unmatched: string[];
  };
  provider: string;
  query: string;
  queryVariants?: string[];
  sources: unknown[];
  status: "available" | "empty";
};

export function listExternalKnowledgeProviderIds(): string[];

export function searchExternalKnowledge(
  body: unknown,
  options?: Record<string, unknown>
): Promise<ExternalKnowledgeSearchResult>;

export function searchOpenAlexExternalKnowledge(
  body: unknown,
  options?: {
    anchorReferenceMode?: "exclusive" | "off";
    openAlexApiKey?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    transport?: ExternalKnowledgeTransport;
  }
): Promise<ExternalKnowledgeSearchResult>;

export function mergeExternalSources(
  sources: unknown[],
  limit: number,
  options?: { rerank?: boolean }
): unknown[];

export class ExternalKnowledgeError extends Error {
  code: string;
  statusCode: number;
}
