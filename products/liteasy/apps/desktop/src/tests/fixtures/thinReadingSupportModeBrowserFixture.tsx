import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { ThinReadingTab } from "../../app/features/thin-reading/ThinReadingTab";
import type { ThinReadingDocument } from "../../app/features/thin-reading/thinReading.types";
import { createThinReadingDocument } from "../../app/features/thin-reading/thinReadingProjection";

const summary = "在没有可信外部来源时，这里仅给出 AI 对跨论文问题的独立理解，并明确区分事实依据与模型解释。";

function createAiInterpretationDocument() {
  return createThinReadingDocument({
    artifactId: "artifact-thin-reading-ai-interpretation",
    papers: [{ id: "paper-ai-interpretation", title: "跨论文问题的薄读解释" }],
    rootSeed: {
      evidence: {
        anchors: [],
        claims: [],
        externalKnowledge: [],
        externalSources: [],
        generationAudit: {
          aiInterpretationReview: {
            reason: "正文没有冒充论文或外部来源结论。",
            unsafeSentenceIds: [],
            verdict: "pass"
          },
          externalFallback: {
            attemptedRoutes: ["support", "context", "challenge"],
            carriedSourceCount: 0,
            completedRoutes: ["support", "context", "challenge"],
            reason: "no_trusted_sources",
            trustedSourceCount: 0
          },
          model: { id: "fixture-model", provider: "fixture" },
          qualityGate: { attempts: 1, repaired: false, repairReasons: [] },
          version: "liteasy.thin-reading-agent/v2"
        },
        paperEvidence: [],
        paperEvidenceSpans: [],
        summarySentences: [{
          evidenceIds: [],
          externalKnowledge: [],
          id: "sentence-ai-interpretation-fixture",
          status: "unsupported",
          supportMode: "ai_interpretation",
          text: summary
        }]
      },
      omittedSections: [],
      recommendations: [],
      summary,
      supportMode: "ai_interpretation",
      withinPaperClosure: false
    },
    targetLanguage: "zh-CN"
  });
}

function ThinReadingSupportModeBrowserFixture() {
  const [document, setDocument] = useState<ThinReadingDocument>(() =>
    createAiInterpretationDocument()
  );

  return (
    <FluentProvider theme={webLightTheme}>
      <ThinReadingTab
        artifactId={document.artifactId}
        document={document}
        onUpdateDocument={(_, nextDocument) => setDocument(nextDocument)}
        papers={[{ id: "paper-ai-interpretation", title: "跨论文问题的薄读解释" }]}
      />
    </FluentProvider>
  );
}

export async function mountThinReadingSupportModeBrowserFixture(container: HTMLElement | null) {
  if (!container) throw new Error("Thin-reading support-mode fixture mount point is missing.");
  document.documentElement.style.overflowX = "hidden";
  document.body.style.margin = "0";
  container.style.minHeight = "100vh";
  createRoot(container).render(<ThinReadingSupportModeBrowserFixture />);
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
