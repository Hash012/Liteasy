export type PendingVisualizationRequest = {
  artifactId: string;
  createdAt: string;
  nodeId: string;
  requestId: string;
  requestedArtifactCount: 1 | 2;
};

type PendingRequestStoreInput = {
  endpoint: string;
  now?: () => Date;
  storage?: Storage;
  subjectId: string;
};

const maximumAgeMs = 24 * 60 * 60 * 1000;

function identifier(value: unknown, maximum = 200): value is string {
  return typeof value === "string" && value.length <= maximum && /^[A-Za-z0-9._:-]+$/.test(value);
}

function parseRequest(value: unknown): PendingVisualizationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => ![
    "artifactId", "createdAt", "nodeId", "requestId", "requestedArtifactCount"
  ].includes(key)) || Object.keys(request).length !== 5 ||
    !identifier(request.artifactId, 160) || !identifier(request.nodeId, 160) ||
    !identifier(request.requestId) ||
    (request.requestedArtifactCount !== 1 && request.requestedArtifactCount !== 2) ||
    typeof request.createdAt !== "string" || !Number.isFinite(Date.parse(request.createdAt))) {
    return null;
  }
  return request as PendingVisualizationRequest;
}

function normalizedEndpoint(value: string) {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("visualization_endpoint_invalid");
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
}

export function createVisualizationPendingRequestStore({
  endpoint,
  now = () => new Date(),
  storage = globalThis.localStorage,
  subjectId
}: PendingRequestStoreInput) {
  if (!subjectId.trim() || subjectId.length > 300) throw new Error("visualization_subject_invalid");
  const storageKey = `liteasy.visualization.pending.v1:${encodeURIComponent(normalizedEndpoint(endpoint))}:${encodeURIComponent(subjectId)}`;

  function read() {
    let values: unknown = [];
    try {
      values = JSON.parse(storage.getItem(storageKey) ?? "[]");
    } catch {
      values = [];
    }
    const current = now().getTime();
    const requests = Array.isArray(values)
      ? values.map(parseRequest).filter((request): request is PendingVisualizationRequest => (
        request !== null && current - Date.parse(request.createdAt) >= 0 &&
        current - Date.parse(request.createdAt) <= maximumAgeMs
      )).slice(-100)
      : [];
    if (JSON.stringify(values) !== JSON.stringify(requests)) write(requests);
    return requests;
  }

  function write(requests: readonly PendingVisualizationRequest[]) {
    if (requests.length === 0) storage.removeItem(storageKey);
    else storage.setItem(storageKey, JSON.stringify(requests));
  }

  return {
    list(): readonly PendingVisualizationRequest[] {
      return read().map((request) => ({ ...request }));
    },
    put(input: PendingVisualizationRequest) {
      const request = parseRequest(input);
      if (!request) throw new Error("visualization_pending_request_invalid");
      const requests = read();
      const existing = requests.find(({ requestId }) => requestId === request.requestId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(request)) {
        throw new Error("visualization_pending_request_id_reused");
      }
      if (!existing) write([...requests, { ...request }]);
    },
    remove(requestId: string) {
      if (!identifier(requestId)) throw new Error("visualization_request_id_invalid");
      write(read().filter((request) => request.requestId !== requestId));
    }
  };
}
