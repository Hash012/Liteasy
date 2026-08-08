import { describe, expect, test, vi } from "vitest";
import { createAcademicProfileClient } from "../app/features/profile/academicProfileClient";

const session = {
  email: "reader@example.com",
  expiresAt: "2027-01-01T00:00:00.000Z",
  name: "Reader",
  sessionId: "access-token-1",
  userId: "reader"
};

const snapshot = {
  enabled: true,
  personalizationVersion: 8,
  profile: { disciplines: [], profileVersion: 2, stage: "博士研究生" },
  tags: []
};

describe("academic profile cloud contract", () => {
  test("uses bearer authorization, optimistic versions, and idempotency for writes", async () => {
    const transport = vi.fn(async () => ({
      json: async () => snapshot,
      ok: true,
      status: 200
    }));
    const client = createAcademicProfileClient({
      endpoint: "https://cloud.example.test",
      transport
    });

    await client.save(session, { disciplines: [], stage: "博士研究生" }, 5);
    await client.setEnabled(session, false, 6);
    await client.clear(session, 7);

    expect(transport).toHaveBeenCalledTimes(3);
    const requests = transport.mock.calls.map(([request]) => ({
      ...request,
      parsedBody: JSON.parse(request.body)
    }));
    expect(requests.map(({ url }) => url)).toEqual([
      "https://cloud.example.test/v1/profile/save",
      "https://cloud.example.test/v1/personalization/settings/update",
      "https://cloud.example.test/v1/profile/clear"
    ]);
    for (const request of requests) {
      expect(request.headers.Authorization).toBe("Bearer access-token-1");
      expect(request.parsedBody.sessionId).toBe("access-token-1");
      expect(request.parsedBody.idempotencyKey).toMatch(/^personalization:/);
    }
    expect(requests[0].parsedBody.expectedVersion).toBe(5);
    expect(requests[1].parsedBody).toMatchObject({ enabled: false, expectedVersion: 6 });
    expect(requests[2].parsedBody.expectedVersion).toBe(7);
    expect(new Set(requests.map(({ parsedBody }) => parsedBody.idempotencyKey)).size).toBe(3);
  });
});
