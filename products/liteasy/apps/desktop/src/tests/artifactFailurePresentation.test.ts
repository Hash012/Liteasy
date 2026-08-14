import { expect, test } from "vitest";
import {
  presentArtifactFailure,
  resolveArtifactFailureCode
} from "../app/features/artifacts/artifactFailurePresentation";

test.each([
  [
    "薄读 Agent 结构质量门连续失败：句级证据映射无效。",
    "模型连续返回了不符合薄读结构要求的结果，系统未保存该结果。请重新生成。"
  ],
  [
    "薄读 Agent 结构质量门连续失败：薄读首页方向质量门未通过。",
    "薄读正文未通过首页方向审阅，系统未保存该结果。请缩小问题范围或重新生成。"
  ],
  [
    "薄读证据复核未通过：来源不能直接支持该句。",
    "薄读正文中仍有命题缺少来源直接支持，系统未保存该结果。请确认论文能够回答当前问题后重试。"
  ],
  [
    "薄读 Agent 数值命题门未通过：指标不一致。",
    "薄读正文中的数值与来源未能一致对应，系统未保存该结果。请重新生成或减少精确数值要求。"
  ],
  [
    "AI 独立理解质量审阅未通过：仍包含经验事实。",
    "AI 独立分析中仍包含无法安全确认的事实性内容，系统未保存该结果。请补充可靠来源后重试。"
  ],
  [
    "薄读成文质量审阅建议定向改写：逻辑链不完整。",
    "薄读正文的重点、逻辑或解释深度未通过审阅，系统未保存该结果。请缩小问题范围后重试。"
  ],
  [
    "薄读来源约束无法满足：外部检索未返回可追溯来源，当前任务禁止 AI 独立理解。",
    "当前论文或所选来源不足以支持这次薄读，系统未保存无可靠依据的结果。请调整问题或补充来源。"
  ]
])("classifies and explains a thin-reading quality rejection", (message, expectedMessage) => {
  expect(resolveArtifactFailureCode(message, "thin_reading_validating"))
    .toBe("artifact_verification_failed");
  expect(presentArtifactFailure({
    failedStage: "thin_reading_validating",
    message,
    occurredAt: "2026-08-11T00:00:00.000Z",
    recovery: []
  }).message).toBe(expectedMessage);
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
