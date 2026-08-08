export type AccountCapabilities = {
  developerDiagnostics: boolean;
};

export type AccountCapabilitiesTransportRequest = {
  headers: Record<string, string>;
  method: "GET";
  url: string;
};

export type AccountCapabilitiesTransport = (
  request: AccountCapabilitiesTransportRequest
) => Promise<{
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
}>;

async function defaultTransport(request: AccountCapabilitiesTransportRequest) {
  return fetch(request.url, {
    cache: "no-store",
    headers: request.headers,
    method: request.method
  });
}

export async function loadAccountCapabilities({
  endpoint,
  sessionId,
  transport = defaultTransport
}: {
  endpoint: string;
  sessionId: string;
  transport?: AccountCapabilitiesTransport;
}): Promise<AccountCapabilities> {
  const response = await transport({
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${sessionId}`
    },
    method: "GET",
    url: `${endpoint.replace(/\/+$/, "")}/v1/account/capabilities`
  });
  if (!response.ok) {
    throw new Error(`account_capabilities_unavailable:${response.status}`);
  }
  const payload = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !("developerDiagnostics" in payload) ||
    typeof payload.developerDiagnostics !== "boolean"
  ) {
    throw new Error("account_capabilities_invalid");
  }
  return { developerDiagnostics: payload.developerDiagnostics };
}
