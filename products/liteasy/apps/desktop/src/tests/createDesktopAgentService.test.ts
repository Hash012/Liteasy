import { createDesktopAgentService } from "../app/controllers/agent/createDesktopAgentService";
import { buildImportedChunksForPaper } from "./fixtures/retrievalFixtures";
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
        auditTransport: async () => ({
          json: async () => ({ audit: { rationale: "grounded", score: 0.9, verdict: "pass" } }),
          ok: true,
          status: 200
        }),
        importedChunksByPaperId: {
          [paper.id]: buildImportedChunksForPaper(paper)
        },
        modelTransport: async () => {
          const answer = "- ColBERT\n  - Late interaction [evidence-1]";
          const encoder = new TextEncoder();
          return {
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode(`${JSON.stringify({ delta: answer, type: "delta" })}\n`));
                controller.enqueue(encoder.encode(`${JSON.stringify({
                  answer,
                  execution: { backend: "test_cloud", mode: "live", provider: "openai" },
                  type: "completed"
                })}\n`));
                controller.close();
              }
            }),
            json: async () => ({}),
            ok: true,
            status: 200
          };
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

  if (!run.ok) {
    throw new Error(run.error.message);
  }
  expect(run).toMatchObject({ data: { status: "completed" }, ok: true });
  const assistantMessage = run.data.events.find((event) => event.type === "assistant.message");
  expect(assistantMessage).toMatchObject({
    metadata: {
      artifactWorkflow: {
        mindmap: {
          verification: { status: "pass" }
        },
        status: "verified",
        workflowTrace: {
          internalOnly: true,
          steps: expect.arrayContaining([
            expect.objectContaining({
              kind: "verification",
              status: "completed",
              summary: "确定性校验通过"
            })
          ])
        }
      }
    }
  });
});

test("passes submitted request attachments into the resolved desktop environment", async () => {
  const observedAttachments: unknown[] = [];
  const api = createDesktopAgentService({
    getEnvironment: (input) => {
      observedAttachments.push(input?.request?.attachments);
      return {
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
      };
    },
    listCapabilities: () => [],
    now: () => new Date("2026-07-26T00:00:00.000Z")
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) {
    throw new Error(session.error.message);
  }

  await api.submitTurn({
    attachments: [
      {
        metadata: {
          paperIds: ["demo-1", "demo-2"]
        },
        source: "selection",
        uri: "liteasy://selection/current"
      }
    ],
    idempotencyKey: "request-context-1",
    input: {
      artifactType: "mindmap",
      message: "生成指定论文思维导图",
      mode: "qa"
    },
    sessionId: session.data.sessionId
  });

  expect(observedAttachments).toContainEqual([
    {
      metadata: {
        paperIds: ["demo-1", "demo-2"]
      },
      source: "selection",
      uri: "liteasy://selection/current"
    }
  ]);
});
