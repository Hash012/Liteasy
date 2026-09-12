import { expect, test } from "vitest";
import { requestedArtifactType } from "../app/features/artifacts/artifactInvocation";

test.each(["/薄读", "/生成薄读", "请为这篇论文做一个符合薄读风格的讲解", "thin-reading"])("recognizes the shared thin-reading capability: %s", (request) => {
  expect(requestedArtifactType(request)).toBe("thin_reading");
});
test.each(["薄读是什么？", "不要薄读，只回答我的问题", "你好"])("does not turn a question or negation into paid generation: %s", (request) => {
  expect(requestedArtifactType(request)).toBeNull();
});

test.each([
  ["/制作PPT", "ppt"], ["/制作提纲", "tree"], ["制作学习大纲", "tree"],
  ["生成PPT大纲", "ppt"], ["/生成思维导图", "mindmap"],
  ["/生成对比表", "comparison_table"], ["/生成分层关系图", "layered_graph"],
  ["/制作PPT 包含思维导图和对比表", "ppt"],
  ["/制作提纲 不要生成PPT", "tree"]
])("resolves the selected material type and preserves supplementary requirements: %s", (message, artifactType) => {
  expect(requestedArtifactType(message)).toBe(artifactType);
});
