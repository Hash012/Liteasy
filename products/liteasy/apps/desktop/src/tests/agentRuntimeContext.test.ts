import { expect, test } from "vitest";
import { validateAgentContextForDocumentWork } from "../app/features/agent-runtime/contextValidation";
import type { AgentContextSnapshot } from "../app/features/agent-runtime/agentRuntime.types";

function createContext(overrides: Partial<AgentContextSnapshot> = {}): AgentContextSnapshot {
  return {
    account: null,
    ingestion: {
      byDocumentId: {
        "paper-1": "ready"
      }
    },
    organization: null,
    selection: {
      documentIds: ["paper-1"],
      documents: [
        {
          id: "paper-1",
          sourcePath: "/tmp/LiteasyLibrary/paper-1.pdf",
          title: "Paper 1"
        }
      ],
      locked: true,
      workspaceRevision: 1,
      workspaceSource: {
        rootPath: "/tmp/LiteasyLibrary",
        type: "local_library"
      }
    },
    settings: {
      "assistant.default_output_mode": "structured",
      "assistant.language": "zh-CN",
      "models.cloud_proxy_endpoint": "http://127.0.0.1:8787",
      "models.control_plane_endpoint": "http://127.0.0.1:8787",
      "models.default_provider": "openai",
      "network.recommendation.enabled": true,
      "network.recommendation.sort_mode": "relevance",
      "profile.enabled": false
    },
    workspace: {
      papers: [
        {
          id: "paper-1",
          sourcePath: "/tmp/LiteasyLibrary/paper-1.pdf",
          title: "Paper 1"
        }
      ],
      revision: 1,
      source: {
        rootPath: "/tmp/LiteasyLibrary",
        type: "local_library"
      }
    },
    ...overrides
  };
}

test("accepts document work when selection is locked and ingested", () => {
  expect(validateAgentContextForDocumentWork(createContext())).toEqual({ ok: true });
});

test("asks for selection when selected document set is empty", () => {
  expect(
    validateAgentContextForDocumentWork(
      createContext({
        selection: {
          documentIds: [],
          documents: [],
          locked: false,
          workspaceRevision: 1,
          workspaceSource: {
            rootPath: "/tmp/LiteasyLibrary",
            type: "local_library"
          }
        }
      })
    )
  ).toEqual({
    missing: ["selected_document_set"],
    ok: false
  });
});

test("asks for ingestion when selected documents are not ready", () => {
  expect(
    validateAgentContextForDocumentWork(
      createContext({
        ingestion: {
          byDocumentId: {
            "paper-1": "running"
          }
        }
      })
    )
  ).toEqual({
    missing: ["ingested_documents"],
    ok: false
  });
});
