import { describe, expect, test } from "vitest";
import {
  CloudServiceError,
  formatCloudConnectionError,
  readCloudServiceError
} from "../app/features/network/cloudErrorMessage";

describe("formatCloudConnectionError", () => {
  test("turns browser fetch failures into a retryable hint without exposing the endpoint", () => {
    expect(
      formatCloudConnectionError(new TypeError("Failed to fetch"), {
        controlPlaneEndpoint: "https://demo.liteasy.example"
      })
    ).toBe(
      "云端服务当前不可用，请检查网络连接后重试。"
    );

    expect(formatCloudConnectionError(new TypeError("Failed to fetch"))).toBe(
      "云端服务当前不可用，请检查网络连接后重试。"
    );
  });

  test("shows only structured public service errors with code and trace ID", () => {
    const error = new CloudServiceError({
      code: "organization_not_found",
      message: "未找到该组织，请刷新后重试。",
      status: 404,
      traceId: "trace_public_1"
    });
    expect(formatCloudConnectionError(error)).toBe(
      "未找到该组织，请刷新后重试。（错误码：organization_not_found，追踪编号：trace_public_1）"
    );
  });

  test("fails closed for arbitrary exceptions and internal details", () => {
    const internal = new Error(
      "SELECT password_hash FROM accounts at /srv/liteasy/private.mjs using sk-secret"
    );
    expect(formatCloudConnectionError(internal, {
      controlPlaneEndpoint: "https://private-control.example"
    })).toBe("云端操作未完成，请稍后重试。");
    expect(formatCloudConnectionError("boom")).toBe("云端操作未完成，请稍后重试。");
  });
});

describe("readCloudServiceError", () => {
  test("preserves the stable public error contract", async () => {
    const error = await readCloudServiceError({
      json: async () => ({
        code: "organization_membership_required",
        message: "当前账号不是该组织成员。",
        traceId: "trace_membership_1"
      }),
      status: 403
    }, {
      code: "organization_request_failed",
      message: "组织请求未完成，请稍后重试。"
    });

    expect(error).toMatchObject({
      code: "organization_membership_required",
      message: "当前账号不是该组织成员。",
      name: "organization_membership_required",
      status: 403,
      traceId: "trace_membership_1"
    });
  });

  test("uses stable fallbacks for malformed intermediary responses", async () => {
    const error = await readCloudServiceError({
      json: async () => ({
        code: "invalid code with spaces",
        message: "\u0000",
        traceId: "/srv/private/trace"
      }),
      status: 502
    }, {
      code: "cloud_request_failed",
      message: "云端请求未完成，请稍后重试。"
    });

    expect(error).toMatchObject({
      code: "cloud_request_failed",
      message: "云端请求未完成，请稍后重试。",
      status: 502,
      traceId: undefined
    });
  });
});
