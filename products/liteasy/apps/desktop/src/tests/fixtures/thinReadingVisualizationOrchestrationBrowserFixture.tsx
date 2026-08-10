import { Button, FluentProvider, webLightTheme } from "@fluentui/react-components";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useThinReadingVisualizationController } from "../../app/controllers/useThinReadingVisualizationController";
import type { MultimodalVisualizationCapability } from "../../app/features/account/accountCapabilitiesClient";
import { ThinReadingTab } from "../../app/features/thin-reading/ThinReadingTab";
import type { ThinReadingDocumentV2 } from "../../app/features/thin-reading/thinReading.types";
import { createVisualizationOrchestrationClient } from "../../app/features/visualization/visualizationOrchestrationClient";
import { propsWithVisualAndFigure } from "./thinReadingVisualProps";

type FixtureOptions = {
  authorized?: boolean;
  recover?: boolean;
};

const allowedCapability: MultimodalVisualizationCapability = {
  allowed: true,
  availableModalities: ["semantic_graph"],
  enabled: true,
  explicitRequestsAllowed: true,
  quota: { available: true },
  serviceAvailable: true
};

const deniedCapability: MultimodalVisualizationCapability = {
  allowed: false,
  availableModalities: [],
  enabled: false,
  explicitRequestsAllowed: false,
  quota: { available: false },
  serviceAvailable: false
};

function initialDocument() {
  const document = propsWithVisualAndFigure.document as ThinReadingDocumentV2;
  const root = document.nodes[document.rootNodeId];
  return {
    ...document,
    nodes: {
      ...document.nodes,
      [root.id]: {
        ...root,
        evidence: {
          ...root.evidence,
          recommendedFigures: [{
            evidenceIds: ["evidence-attention-self-attention"],
            figureId: "figure-fixture",
            reason: "source evidence"
          }]
        },
        visualizationDecision: {
          intent: {
            candidateModalities: ["semantic_graph"],
            evidenceIds: ["evidence-attention-self-attention"],
            expectedLearningGain: "high",
            nodeId: root.id,
            purpose: "show_process",
            requestedBy: "automatic"
          },
          status: "accepted"
        },
        visualizations: []
      }
    }
  } satisfies ThinReadingDocumentV2;
}

function statusText(status: ReturnType<typeof useThinReadingVisualizationController>["statuses"][string]) {
  if (!status) return "idle";
  return status.status === "omitted" ? `${status.status}:${status.reasonCode}` : status.status;
}

export function mountThinReadingVisualizationOrchestrationBrowserFixture(
  container: HTMLElement | null,
  options: FixtureOptions = {}
) {
  if (!container) throw new Error("Thin-reading orchestration fixture mount point is missing.");

  function Fixture() {
    const [capability, setCapability] = useState<MultimodalVisualizationCapability>(
      options.authorized === false ? deniedCapability : allowedCapability
    );
    const capabilityRef = useRef(capability);
    const [document, setDocument] = useState(initialDocument);
    const documentRef = useRef(document);
    const [loggedOut, setLoggedOut] = useState(false);
    const clientRef = useRef<ReturnType<typeof createVisualizationOrchestrationClient>>();
    if (!clientRef.current) {
      clientRef.current = createVisualizationOrchestrationClient({
        endpoint: window.location.origin,
        getAccessToken: () => "browser-visualization-token",
        getCapability: () => capabilityRef.current,
        storage: window.localStorage,
        subjectId: "browser-visualization-subject"
      });
    }
    const controller = useThinReadingVisualizationController({
      cancelGeneration: clientRef.current.cancel,
      generateVisualization: clientRef.current.startAndWait,
      getCapability: () => capabilityRef.current,
      getThinReadingDocument: (artifactId) => (
        documentRef.current.artifactId === artifactId ? documentRef.current : undefined
      ),
      onDocumentUpdated: (nextDocument) => {
        documentRef.current = nextDocument;
        setDocument(nextDocument);
      },
      resumeVisualization: clientRef.current.resumeAndWait,
      saveThinReadingDocument: async (_artifactId, nextDocument, signal) => {
        if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
        documentRef.current = nextDocument;
        setDocument(nextDocument);
      }
    });
    const root = document.nodes[document.rootNodeId];
    const recoveredRef = useRef(false);

    useEffect(() => {
      if (!options.recover || recoveredRef.current) return;
      recoveredRef.current = true;
      clientRef.current?.pending().forEach((request) => {
        void controller.resumePendingVisualization(request);
      });
    }, []);

    if (loggedOut) {
      return <output data-testid="visualization-orchestration-status">logged_out</output>;
    }

    return (
      <main aria-label="Thin-reading visualization orchestration fixture">
        <div aria-label="Visualization request actions">
          <Button
            onClick={() => {
              void controller.startVisualization({
                artifactId: document.artifactId,
                document,
                node: root
              });
            }}
          >
            Start visualization
          </Button>
          <Button onClick={() => void controller.cancelVisualization(root.id, "user_cancelled")}>
            Cancel visualization
          </Button>
          <Button
            onClick={() => {
              const disabled = { ...capabilityRef.current, enabled: false };
              capabilityRef.current = disabled;
              setCapability(disabled);
              void controller.setEnabled(false);
            }}
          >
            Disable visualization
          </Button>
          <Button
            onClick={() => {
              controller.dispose();
              setLoggedOut(true);
            }}
          >
            Log out
          </Button>
        </div>
        <output data-testid="visualization-orchestration-status">
          {statusText(controller.statuses[root.id])}
        </output>
        <ThinReadingTab
          {...propsWithVisualAndFigure}
          document={document}
          figures={propsWithVisualAndFigure.figures?.map((figure) => ({
            ...figure,
            dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
          }))}
          onToggleVisualization={(enabled) => {
            const next = { ...capabilityRef.current, enabled };
            capabilityRef.current = next;
            setCapability(next);
            void controller.setEnabled(enabled);
          }}
          onUpdateDocument={(_artifactId, nextDocument) => {
            if (nextDocument.version !== "liteasy.thin-reading/v2") return;
            documentRef.current = nextDocument;
            setDocument(nextDocument);
          }}
          visualizationArtifacts={controller.readyArtifacts}
          visualizationCapability={capability}
          visualizationStatus={controller.statuses[root.id]}
        />
      </main>
    );
  }

  createRoot(container).render(
    <FluentProvider theme={webLightTheme}>
      <Fixture />
    </FluentProvider>
  );
}
