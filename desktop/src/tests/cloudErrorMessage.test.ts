import { describe, expect, test } from "vitest";
import { formatCloudConnectionError } from "../app/features/network/cloudErrorMessage";

describe("formatCloudConnectionError", () => {
  test("turns browser fetch failures into a control-plane hint using the current endpoint", () => {
    expect(
      formatCloudConnectionError(new TypeError("Failed to fetch"), {
        controlPlaneEndpoint: "https://demo.liteasy.example"
      })
    ).toBe(
      "无法连接开发云服务。请确认服务已启动，并检查当前控制平面端点：https://demo.liteasy.example。"
    );

    expect(formatCloudConnectionError(new TypeError("Failed to fetch"))).toBe(
      "无法连接开发云服务。请确认已启动 http://127.0.0.1:8787，并检查设置里的控制平面端点。"
    );
  });

  test("keeps explicit backend errors readable", () => {
    expect(formatCloudConnectionError(new Error("组织空间加载失败（404）"))).toBe("组织空间加载失败（404）");
    expect(formatCloudConnectionError("boom")).toBe("未知错误");
  });
});
