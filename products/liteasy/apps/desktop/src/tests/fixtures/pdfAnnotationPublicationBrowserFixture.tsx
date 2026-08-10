import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createRoot } from "react-dom/client";
import { useMemo, useRef, useState } from "react";
import { usePdfAnnotationPublicationController } from "../../app/controllers/usePdfAnnotationPublicationController";
import { LiteratureResolutionDialog } from "../../app/features/forum/LiteratureResolutionDialog";
import type { ForumAnnotationPublicationOperation } from "../../app/features/forum/forum.types";
import type { LiteratureConfirmInput } from "../../app/features/paper-identity/literature.types";
import type { LiteratureRecord } from "../../app/features/paper-identity/literature.types";
import { PdfReader } from "../../app/features/pdf/PdfReader";
import { createWorkspaceStore } from "../../app/features/workspace/workspace.store";
import type { Paper } from "../../app/features/workspace/workspace.types";

const initialPaper: Paper = {
  doi: "10.1145/3397271.3401075",
  id: "paper-publication-browser",
  title: "ColBERT publication fixture"
};

const candidateLiterature: LiteratureRecord = {
  authors: ["Omar Khattab", "Matei Zaharia"],
  identifiers: [{
    kind: "doi",
    source: "public_registry",
    value: "10.1145/3397271.3401075"
  }],
  literatureId: "literature-colbert",
  provenance: {
    confirmedAt: "2026-08-10T00:00:00.000Z",
    mode: "public_registry",
    provider: "crossref"
  },
  revision: 1,
  status: "confirmed",
  title: "ColBERT",
  year: 2020
};

function PdfAnnotationPublicationBrowserFixture() {
  const [paper, setPaper] = useState(initialPaper);
  const literatureRef = useRef<LiteratureRecord>();
  const remoteRevisionRef = useRef(0);
  const workspaceStore = useMemo(() => createWorkspaceStore([initialPaper]), []);
  const forumClient = useMemo(() => ({
    async applyAnnotationPublications(operations: ForumAnnotationPublicationOperation[]) {
      return {
        results: operations.map((operation) => {
          if (operation.operation === "retract") {
            return {
              annotationId: operation.annotationId,
              error: "fixture timeout",
              pendingOperation: operation,
              queueKey: operation.queueKey,
              state: "failed" as const
            };
          }
          remoteRevisionRef.current += 1;
          return {
            annotationId: operation.annotationId,
            queueKey: operation.queueKey,
            remoteAnnotationId: `remote-${operation.annotationId}`,
            remoteRevision: remoteRevisionRef.current,
            sourceRevision: operation.revision,
            state: "published" as const,
            syncedAt: "2026-08-10T00:00:00.000Z"
          };
        })
      };
    },
    async confirmLiterature(_input: LiteratureConfirmInput) {
      literatureRef.current = candidateLiterature;
      return { literature: candidateLiterature };
    },
    async resolveLiterature() {
      return {
        candidates: [{
          candidateKey: "candidate-colbert",
          provider: "crossref" as const,
          record: candidateLiterature
        }],
        status: "ambiguous" as const,
        unavailableProviders: []
      };
    }
  }), []);
  const controller = usePdfAnnotationPublicationController({
    forumClient,
    literatureMetadataRepository: {
      async load() {
        return literatureRef.current;
      }
    },
    onPaperUpdated: setPaper,
    async persistPaperLiterature(currentPaper, literature) {
      literatureRef.current = literature;
      return { ...currentPaper, literature };
    },
    workspaceStore
  });

  return (
    <FluentProvider theme={webLightTheme}>
      <main style={{ height: "100vh", minWidth: 0, overflow: "hidden" }}>
        <PdfReader
          onChangeAnnotationPublication={controller.actions.changePublication}
          selectedPapers={[paper]}
          zoom={100}
        />
        {controller.model.literatureDialog ? (
          <LiteratureResolutionDialog
            model={controller.model.literatureDialog}
            onCancel={controller.actions.cancelResolution}
            onRetry={controller.actions.retryResolution}
            onSearch={controller.actions.searchLiterature}
            onSelectCandidate={controller.actions.selectCandidate}
          />
        ) : null}
      </main>
    </FluentProvider>
  );
}

export async function mountPdfAnnotationPublicationBrowserFixture(
  container: HTMLElement | null
) {
  if (!container) throw new Error("PDF annotation publication fixture container is missing");
  window.localStorage.clear();
  createRoot(container).render(<PdfAnnotationPublicationBrowserFixture />);
}
