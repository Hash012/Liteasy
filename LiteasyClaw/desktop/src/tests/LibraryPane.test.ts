import { describe, expect, test } from "vitest";
import { personalLibraryScopeId } from "../app/features/library/LibraryPane";

describe("personalLibraryScopeId", () => {
  test("normalizes account ids to the server-owned personal library scope", () => {
    expect(personalLibraryScopeId("account-1")).toBe("user:account-1");
    expect(personalLibraryScopeId("user:account-1")).toBe("user:account-1");
    expect(personalLibraryScopeId()).toBe("");
  });
});
