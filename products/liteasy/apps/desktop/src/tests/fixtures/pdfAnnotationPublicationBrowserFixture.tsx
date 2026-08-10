import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createRoot } from "react-dom/client";
import { useMemo, useRef, useState } from "react";
import { usePdfAnnotationPublicationController } from "../../app/controllers/usePdfAnnotationPublicationController";
import { LiteratureResolutionDialog } from "../../app/features/forum/LiteratureResolutionDialog";
import type {
  ForumAnnotationPublicationOperation,
  ForumLiteratureConfirmInput
} from "../../app/features/forum/forum.types";
import type { LiteratureRecord } from "../../app/features/paper-identity/literature.types";
import { PdfReader } from "../../app/features/pdf/PdfReader";
import { createWorkspaceStore } from "../../app/features/workspace/workspace.store";
import type { Paper } from "../../app/features/workspace/workspace.types";

type FixtureMode = "candidate" | "manual";

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
  title: "ColBERT",
  year: 2020
};

function manualLiterature(input: Extract<ForumLiteratureConfirmInput, { mode: "manual" }>): LiteratureRecord {
  return {
    ...input.record,
    identifiers: input.record.identifiers.length > 0 ? input.record.identifiers : [{
      kind: "title_authors_year_hash",
      source: "manual",
      value: "manual-browser-fixture"
    }],
    literatureId: "literature-manual",
    provenance: {
      confirmedAt: "2026-08-10T00:00:00.000Z",
      mode: "manual"
    }
  };
}

function PdfAnnotationPublicationBrowserFixture({ mode }: { mode: FixtureMode }) {
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
    async confirmLiterature(input: ForumLiteratureConfirmInput) {
      const literature = input.mode === "candidate"
        ? candidateLiterature
        : manualLiterature(input);
      literatureRef.current = literature;
      return { literature };
    },
    async resolveLiterature() {
      return mode === "manual" ? {
        candidates: [] as [],
        status: "not_found" as const,
        unavailableProviders: []
      } : {
        candidates: [{
          candidateKey: "candidate-colbert",
          provider: "crossref" as const,
          record: candidateLiterature
        }],
        status: "ambiguous" as const,
        unavailableProviders: []
      };
    }
  }), [mode]);
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
            onSelectCandidate={controller.actions.selectCandidate}
            onSubmitManual={controller.actions.submitManual}
          />
        ) : null}
      </main>
    </FluentProvider>
  );
}

export async function mountPdfAnnotationPublicationBrowserFixture(
  container: HTMLElement | null,
  mode: FixtureMode
) {
  if (!container) throw new Error("PDF annotation publication fixture container is missing");
  window.localStorage.clear();
  createRoot(container).render(<PdfAnnotationPublicationBrowserFixture mode={mode} />);
}
