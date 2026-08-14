import { expect, test } from "vitest";
import {
  presentArtifactFailure,
  resolveArtifactFailureCode
} from "../app/features/artifacts/artifactFailurePresentation";

test.each([
  "薄读 Agent 结构质量门连续失败：句级证据映射无效。",
  "薄读证据复核未通过：来源不能直接支持该句。",
  "薄读 Agent 数值命题门未通过：指标不一致。",
  "AI 独立理解质量审阅未通过：仍包含经验事实。",
  "薄读成文质量审阅建议定向改写：逻辑链不完整。",
  "薄读来源约束无法满足：外部检索未返回可追溯来源，当前任务禁止 AI 独立理解。"
])("classifies a thin-reading quality rejection as verification rather than generic generation failure", (message) => {
  expect(resolveArtifactFailureCode(message, "thin_reading_validating"))
    .toBe("artifact_verification_failed");
  expect(presentArtifactFailure({
    failedStage: "thin_reading_validating",
    message,
    occurredAt: "2026-08-11T00:00:00.000Z",
    recovery: []
  }).message).toBe("生成结果未通过结构、证据或安全校验，系统未保存该结果。");
});

test("classifies transient model 5xx responses as service failures", () => {
  expect(resolveArtifactFailureCode(
    "模型服务请求失败（cloud_proxy 503）：upstream unavailable",
    "thin_reading_validating"
  )).toBe("service_unavailable");
});

test("classifies streamed provider timeouts as service failures", () => {
  expect(resolveArtifactFailureCode(
    "模型流式请求失败（cloud_proxy）：model_provider_timeout: The model provider timed out.",
    "thin_reading_validating"
  )).toBe("service_unavailable");
});
