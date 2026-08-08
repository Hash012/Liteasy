import { describe, expect, test } from "vitest";
import { getCloudAvailabilityStatus } from "../app/features/network/cloudAvailability";

describe("getCloudAvailabilityStatus boundary", () => {
  test("is available only when online, signed in, and reachable", () => {
    expect(
      getCloudAvailabilityStatus({
        accountSession: null,
        isOnline: true
      })
    ).toBe("unavailable");

    expect(
      getCloudAvailabilityStatus({
        accountSession: { sessionId: "s1", membershipTier: "pro" },
        isOnline: false
      })
    ).toBe("unavailable");

    expect(
      getCloudAvailabilityStatus({
        accountSession: { sessionId: "s1", membershipTier: "pro" },
        isCloudReachable: false,
        isOnline: true
      })
    ).toBe("unavailable");

    expect(
      getCloudAvailabilityStatus({
        accountSession: { sessionId: "s1", membershipTier: "pro" },
        isOnline: true
      })
    ).toBe("available");
  });
});
