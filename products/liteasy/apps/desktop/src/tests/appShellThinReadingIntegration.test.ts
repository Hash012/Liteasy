import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("keeps standalone thin-reading artifacts connected to cloud retrieval", () => {
  const source = readFileSync(resolve(process.cwd(), "src/app/layout/AppShell.tsx"), "utf8");
  const standaloneSurface = source.match(
    /function renderArtifactSurface\([\s\S]*?<ArtifactTabs([\s\S]*?)\/>[\s\S]*?<\/section>/u
  )?.[1];

  expect(standaloneSurface).toBeDefined();
  expect(standaloneSurface).toContain("externalKnowledgeEndpoint={externalKnowledgeEndpoint}");
  expect(standaloneSurface).toContain("paperRelationsTransport={effectiveModelTransport}");
  expect(standaloneSurface).toContain("recommendationTransport={effectiveModelTransport}");
  expect(standaloneSurface).toContain("onOpenExternalFullText={externalPapers.openExternalFullTextInReader}");
  expect(standaloneSurface).toContain(
    "onPromoteExternalPaperToLibrary={externalPapers.promoteExternalPaperToLibrary}"
  );
});
