import { createDesktopAgentService } from "../app/controllers/agent/createDesktopAgentService";
import { buildImportedChunksForPaper } from "../app/features/import/importFixtures";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { Paper } from "../app/features/workspace/workspace.types";

const paper: Paper = {
  id: "demo-1",
  sourcePath: "fixtures/demo-1.pdf",
  title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
};

test("preserves mindmap artifact workflow metadata on assistant messages", async () => {
  let sequence = 0;
  const api = createDesktopAgentService({
    createId(prefix) {
      sequence += 1;
      return `${prefix}-${sequence}`;
    },
    getEnvironment: () => ({
      knowledge: {
        importedChunksByPaperId: {
          [paper.id]: buildImportedChunksForPaper(paper)
        },
        selectedPapers: [paper],
        settings: createSettingsStore().getState()
      },
      runtime: {
        contextView: {
          cloud: { connected: false },
          profile: { enabled: false, requiresConfirmation: false },
          selection: {
            importedCount: 1,
            issues: [],
            locked: true,
            ready: true,
            selectedCount: 1
          },
          workspace: { type: "local" }
        }
      } as never
    }),
    listCapabilities: () => [],
    now: () => new Date("2026-07-26T00:00:00.000Z")
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) {
    throw new Error(session.error.message);
  }

  const run = await api.submitTurn({
    idempotencyKey: "mindmap-run-1",
    input: {
      artifactType: "mindmap",
      message: "生成 ColBERT 思维导图",
      mode: "qa"
    },
    sessionId: session.data.sessionId
  });

  expect(run).toMatchObject({ data: { status: "completed" }, ok: true });
  if (!run.ok) {
    throw new Error(run.error.message);
  }
  const assistantMessage = run.data.events.find((event) => event.type === "assistant.message");
  expect(assistantMessage).toMatchObject({
    metadata: {
      artifactWorkflow: {
        mindmap: {
          verification: { status: "pass" }
        },
        status: "verified"
      }
    }
  });
});
