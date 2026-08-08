import { describe, expect, test } from "vitest";
import { getCloudAvailabilityStatus } from "../app/features/network/cloudAvailability";

describe("getCloudAvailabilityStatus", () => {
  test("returns unavailable when offline", () => {
    expect(
      getCloudAvailabilityStatus({
        accountSession: {
          email: "researcher@liteasy.dev",
          expiresAt: "2026-05-15T09:30:00Z",
          membershipTier: "pro",
          name: "Liteasy Researcher",
          sessionId: "demo-session-1"
        },
        isOnline: false
      })
    ).toBe("unavailable");
  });

  test("returns unavailable when online but not logged in", () => {
    expect(
      getCloudAvailabilityStatus({
        accountSession: null,
        isCloudReachable: true,
        isOnline: true
      })
    ).toBe("unavailable");
  });

  test("returns unavailable when online and logged in but cloud is unreachable", () => {
    expect(
      getCloudAvailabilityStatus({
        accountSession: {
          email: "researcher@liteasy.dev",
          expiresAt: "2026-05-15T09:30:00Z",
          membershipTier: "pro",
          name: "Liteasy Researcher",
          sessionId: "demo-session-1"
        },
        isCloudReachable: false,
        isOnline: true
      })
    ).toBe("unavailable");
  });

  test("returns available when online and logged in", () => {
    expect(
      getCloudAvailabilityStatus({
        accountSession: {
          email: "researcher@liteasy.dev",
          expiresAt: "2026-05-15T09:30:00Z",
          membershipTier: "pro",
          name: "Liteasy Researcher",
          sessionId: "demo-session-1"
        },
        isCloudReachable: true,
        isOnline: true
      })
    ).toBe("available");
  });
});
