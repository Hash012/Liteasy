import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  LiteratureHydrationStatus,
  personalLibraryScopeId
} from "../app/features/library/LibraryPane";

describe("personalLibraryScopeId", () => {
  test("normalizes account ids to the server-owned personal library scope", () => {
    expect(personalLibraryScopeId("account-1")).toBe("user:account-1");
    expect(personalLibraryScopeId("user:account-1")).toBe("user:account-1");
    expect(personalLibraryScopeId()).toBe("");
  });
});

test("surfaces recoverable literature hydration issues through the library status pattern", () => {
  render(LiteratureHydrationStatus({
    hydration: {
      issues: [{ message: "文献元数据文件不是有效 JSON", paperId: "paper-corrupt" }],
      status: "recoverable_error"
    }
  }));

  expect(screen.getByRole("status")).toHaveTextContent("1 篇文献的身份信息暂时无法恢复");
  expect(screen.getByRole("status")).toHaveTextContent("本地文献与其他身份信息仍可使用");
});
