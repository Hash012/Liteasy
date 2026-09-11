import { expect, test } from "vitest";
import { requestedArtifactType } from "../app/features/artifacts/artifactInvocation";

test.each(["/薄读", "/生成薄读", "请为这篇论文做一个符合薄读风格的讲解", "thin-reading"])("recognizes the shared thin-reading capability: %s", (request) => {
  expect(requestedArtifactType(request)).toBe("thin_reading");
});
test.each(["薄读是什么？", "不要薄读，只回答我的问题", "你好"])("does not turn a question or negation into paid generation: %s", (request) => {
  expect(requestedArtifactType(request)).toBeNull();
});
