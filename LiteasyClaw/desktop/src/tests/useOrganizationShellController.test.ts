import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useRef } from "react";
import { useOrganizationShellController } from "../app/controllers/useOrganizationShellController";
import { createWorkspaceStore } from "../app/features/workspace/workspace.store";
import type { AccountSession } from "../app/features/account/account.types";

const accountSession: AccountSession = {
  email: "researcher@liteasy.dev",
  expiresAt: "2026-05-15T09:30:00Z",
  membershipTier: "pro",
  name: "Liteasy Researcher",
  sessionId: "demo-session-1"
};

function createJsonResponse(payload: unknown) {
  return {
    json: async () => payload,
    ok: true,
    status: 200
  } as Response;
}

describe("useOrganizationShellController", () => {
  test("exposes organization shell model and workspace actions", async () => {
    const onAnalysisHint = vi.fn();
    const onLeftRailView = vi.fn();
    const onWorkspaceLabel = vi.fn();
    const onWorkspaceSync = vi.fn();
    const organizationListTransport = vi.fn(async () =>
      createJsonResponse({
        activeOrganizationId: "org-demo-1",
        organizations: [
          {
            memberCount: 12,
            myRole: "admin",
            name: "Liteasy AI Reading Lab",
            organizationId: "org-demo-1",
            sharedLibraryName: "组织共享文献库"
          }
        ]
      })
    );
    const organizationTransport = vi.fn(async () =>
      createJsonResponse({
        summary: {
          auditEvents: [],
          memberCount: 12,
          members: [],
          myRole: "admin",
          name: "Liteasy AI Reading Lab",
          notifications: [],
          organizationId: "org-demo-1",
          quota: {
            periodEndsAt: "2026-06-01T00:00:00Z",
            storageLimitGb: 100,
            storageUsedGb: 38
          },
          sharedLibrary: {
            documentCount: 1,
            documents: [
              {
                id: "org-doc-1",
                sourcePath: "org://org-demo-1/library/rag.pdf",
                title: "Organization Reading List: Retrieval-Augmented Generation"
              }
            ],
            name: "组织共享文献库",
            status: "available"
          },
          taskSummary: {
            failed: 0,
            running: 1
          }
        }
      })
    );
    const { result } = renderHook(() => {
      const workspaceStoreRef = useRef(createWorkspaceStore());
      return useOrganizationShellController({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        organizationListTransport,
        organizationTransport,
        onAnalysisHint,
        onLeftRailView,
        onWorkspaceLabel,
        onWorkspaceSync,
        workspaceStoreRef
      });
    });

    await waitFor(() => {
      expect(result.current.model.organizationSummary?.organizationId).toBe("org-demo-1");
    });

    let message = "";
    await act(async () => {
      message = await result.current.actions.openOrganizationSharedLibrary();
    });

    expect(message).toBe("已打开组织共享文献库：组织共享文献库。");
    expect(onWorkspaceSync).toHaveBeenCalledTimes(1);
    expect(onWorkspaceLabel).toHaveBeenCalledWith("组织共享文献库（Liteasy AI Reading Lab）");
    expect(onLeftRailView).toHaveBeenCalledWith("library");
  });
});
