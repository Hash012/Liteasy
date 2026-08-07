import { expect, test, vi } from "vitest";
import { loadAccountCapabilities } from "../app/features/account/accountCapabilitiesClient";

test("loads capabilities with the authenticated desktop bearer session", async () => {
  const transport = vi.fn(async () => ({
    json: async () => ({ developerDiagnostics: true }),
    ok: true,
    status: 200
  }));

  await expect(loadAccountCapabilities({
    endpoint: "https://api.liteasy.example/",
    sessionId: "desktop-access-token",
    transport
  })).resolves.toEqual({ developerDiagnostics: true });
  expect(transport).toHaveBeenCalledWith({
    headers: {
      Accept: "application/json",
      Authorization: "Bearer desktop-access-token"
    },
    method: "GET",
    url: "https://api.liteasy.example/v1/account/capabilities"
  });
});

test("rejects missing or non-boolean server authorization results", async () => {
  await expect(loadAccountCapabilities({
    endpoint: "https://api.liteasy.example",
    sessionId: "desktop-access-token",
    transport: async () => ({
      json: async () => ({ developerDiagnostics: "yes" }),
      ok: true,
      status: 200
    })
  })).rejects.toThrow("account_capabilities_invalid");
});
