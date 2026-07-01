import { buildArtifactPreview } from "../app/features/artifacts/artifactPreview";

test("builds a mindmap-friendly preview from imported chunks", () => {
  const preview = buildArtifactPreview(
    [
      {
        id: "demo-2",
        title: "BERT: Pre-training of Deep Bidirectional Transformers"
      }
    ],
    {
      "demo-2": [
        {
          page: 7,
          paperId: "demo-2",
          paperTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
          snippet: "deep bidirectional representations are pre-trained by jointly conditioning on left and right context",
          summary: "核心方法是先做深度双向预训练，再把表示迁移到下游语言理解任务。",
          tags: ["核心方法", "双向预训练"]
        },
        {
          page: 8,
          paperId: "demo-2",
          paperTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
          snippet: "masked language model and next sentence prediction are used for pre-training",
          summary: "预训练目标主要包括掩码语言模型和下一句预测。",
          tags: ["预训练目标", "掩码语言模型"]
        }
      ]
    }
  );

  expect(preview?.rootLabel).toBe("BERT: Pre-training of Deep Bidirectional Transformers");
  expect(preview?.nodes).toContain("双向预训练");
  expect(preview?.nodes).toContain("预训练目标");
});
