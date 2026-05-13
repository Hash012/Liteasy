import { buildImportedChunksForPaper } from "../app/features/import/importFixtures";

test("builds bert fixture chunks for an imported paper", () => {
  const chunks = buildImportedChunksForPaper({
    id: "demo-2",
    title: "BERT: Pre-training of Deep Bidirectional Transformers"
  });

  expect(chunks).toHaveLength(2);
  expect(chunks[0]?.paperId).toBe("demo-2");
  expect(chunks[0]?.summary).toContain("双向预训练");
  expect(chunks[1]?.tags).toContain("预训练目标");
});
