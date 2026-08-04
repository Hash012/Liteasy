import { expect, test } from "vitest";
import {
  createPaperTranslationRepository,
  paperTranslationSourceFingerprint
} from "../app/features/import/paperTranslationRepository";

function memoryRepository() {
  let snapshot: unknown = null;
  return createPaperTranslationRepository({
    load: async () => snapshot,
    save: async (value) => { snapshot = value; }
  });
}

test("persists translations by paper, source fingerprint, and language pair", async () => {
  const repository = memoryRepository();
  const markedSource = "<!-- liteasy-anchor:segment-001 -->\nOriginal.";

  await repository.save({
    content: "<!-- liteasy-anchor:segment-001 -->\n第一版。",
    markedSource,
    paperId: "paper-1",
    sourceLanguage: "English",
    targetLanguage: "中文"
  });
  await repository.save({
    content: "<!-- liteasy-anchor:segment-001 -->\n第二版。",
    markedSource,
    paperId: "paper-1",
    sourceLanguage: "English",
    targetLanguage: "中文"
  });
  await repository.save({
    content: "<!-- liteasy-anchor:segment-001 -->\n日本語版。",
    markedSource,
    paperId: "paper-1",
    sourceLanguage: "English",
    targetLanguage: "日本語"
  });

  const saved = await repository.list({ markedSource, paperId: "paper-1" });
  expect(saved).toHaveLength(2);
  expect(saved.find(({ targetLanguage }) => targetLanguage === "中文")?.content).toContain("第二版");
  expect(saved.map(({ targetLanguage }) => targetLanguage).sort()).toEqual(["中文", "日本語"].sort());
});

test("does not return a stale translation after the extracted source changes", async () => {
  const repository = memoryRepository();
  await repository.save({
    content: "<!-- liteasy-anchor:segment-001 -->\n译文。",
    markedSource: "<!-- liteasy-anchor:segment-001 -->\nOriginal.",
    paperId: "paper-1",
    sourceLanguage: "English",
    targetLanguage: "中文"
  });

  await expect(repository.list({
    markedSource: "<!-- liteasy-anchor:segment-001 -->\nUpdated original.",
    paperId: "paper-1"
  })).resolves.toEqual([]);
  expect(paperTranslationSourceFingerprint("one")).not.toBe(paperTranslationSourceFingerprint("two"));
});
