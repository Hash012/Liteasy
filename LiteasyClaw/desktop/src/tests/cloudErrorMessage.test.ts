import { describe, expect, test } from "vitest";
import { formatCloudConnectionError } from "../app/features/network/cloudErrorMessage";

describe("formatCloudConnectionError", () => {
  test("turns browser fetch failures into a control-plane hint using the current endpoint", () => {
    expect(
      formatCloudConnectionError(new TypeError("Failed to fetch"), {
        controlPlaneEndpoint: "https://demo.liteasy.example"
      })
    ).toBe(
      "云端服务当前不可用。请确认服务已启动，并检查当前云端地址：https://demo.liteasy.example。"
    );

    expect(formatCloudConnectionError(new TypeError("Failed to fetch"))).toBe(
      "云端服务当前不可用。请确认已启动 http://127.0.0.1:8787，并检查当前云端地址。"
    );
  });

  test("keeps explicit backend errors readable", () => {
    expect(formatCloudConnectionError(new Error("组织空间加载失败（404）"))).toBe("组织空间加载失败（404）");
    expect(formatCloudConnectionError("boom")).toBe("未知错误");
  });
});
