import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useTeamAnnotationController } from "../app/controllers/useTeamAnnotationController";
import type { AccountSession } from "../app/features/account/account.types";
import type { OrganizationSummary } from "../app/features/organization/organization.types";
import type {
  createTeamAnnotationClient,
  TeamAnnotation
} from "../app/features/organization/teamAnnotationClient";
import type { PdfAnnotation } from "../app/features/pdf/pdfAnnotationStorage";
import type { Paper } from "../app/features/workspace/workspace.types";

const accountSession: AccountSession = {
  email: "member@liteasy.dev",
  expiresAt: "2026-08-08T00:00:00.000Z",
  membershipTier: "pro",
  name: "Member",
  sessionId: "access-token-1",
  userId: "member-1"
};

const organizationPaper: Paper = {
  id: "document-1",
  sourcePath: "org://organization-1/shared-library/document-1.pdf",
  title: "Organization paper"
};

const localPaper: Paper = {
  id: "local-document-1",
  sourcePath: "/library/local-document-1.pdf",
  title: "Local paper"
};

const annotation: TeamAnnotation = {
  annotationId: "annotation-1",
  body: {
    clientAnnotationId: "highlight-1",
    excerpt: "Evidence",
    kind: "highlight",
    page: 2,
    rects: [],
    text: "Highlight",
    updatedAt: "2026-08-07T00:00:00.000Z"
  },
  createdAt: "2026-08-07T00:00:00.000Z",
  documentId: "document-1",
  organizationId: "organization-1",
  revision: 3,
  updatedAt: "2026-08-07T00:00:00.000Z",
  uploadedBy: "user:member-1"
};

const localAnnotation: PdfAnnotation = {
  createdAt: "2026-08-07T00:00:00.000Z",
  excerpt: "Evidence",
  id: "highlight-1",
  kind: "highlight",
  page: 2,
  paperIdentity: {
    candidates: [],
    paperId: "document-1",
    primary: { kind: "local", value: "document-1" },
    title: "Organization paper"
  },
  rects: [],
  text: "Highlight",
  updatedAt: "2026-08-07T00:00:00.000Z",
  visibility: "private"
};

function organizationSummary(role: "owner" | "admin" | "member" = "member"): OrganizationSummary {
  return {
    auditEvents: [],
    memberCount: 1,
    members: [{
      id: "membership-1",
      name: "Member",
      revision: 1,
      role,
      status: "active",
      subject: "user:member-1"
    }],
    myMemberRevision: 1,
    myRole: role,
    name: "Research team",
    notifications: [],
    organizationId: "organization-1",
    quota: { configured: true, storageLimitGb: 10, storageUsedGb: 1 },
    revision: 2,
    sharedLibrary: {
      documentCount: 1,
      documents: [{
        id: "document-1",
        sourcePath: "org://organization-1/shared-library/document-1.pdf",
        title: "Organization paper"
      }],
      name: "Shared library",
      status: "available"
    }
  };
}

function renderController(input?: {
  account?: AccountSession | null;
  role?: "owner" | "admin" | "member";
  summary?: OrganizationSummary | null;
}) {
  const client = {
    create: vi.fn(async () => annotation),
    list: vi.fn(async () => ({ annotations: [annotation] })),
    remove: vi.fn(async () => ({ ...annotation, deleted: true as const })),
    update: vi.fn(async () => ({ ...annotation, revision: 4 }))
  };
  const createClient = vi.fn(() => client) as unknown as typeof createTeamAnnotationClient;
  const hook = renderHook(() => useTeamAnnotationController({
    accountSession: input?.account === undefined ? accountSession : input.account,
    createClient,
    endpoint: "https://cloud.example.test",
    organizationSummary: input?.summary === undefined
      ? organizationSummary(input?.role)
      : input.summary
  }));
  return { ...hook, client, createClient };
}

test("binds authenticated organization papers and preserves revision checks", async () => {
  const { client, createClient, result } = renderController();
  const bindings = result.current.readerBindings(organizationPaper);

  expect(bindings.organizationAnnotationActorId).toBe("user:member-1");
  expect(bindings.canModerateOrganizationAnnotations).toBe(false);

  await act(async () => {
    await bindings.loadOrganizationAnnotations?.(organizationPaper);
    await bindings.onShareAnnotationToOrganization?.({
      annotation: localAnnotation,
      paper: organizationPaper
    });
    await bindings.onUpdateOrganizationAnnotation?.({
      annotation,
      note: "Reviewed",
      paper: organizationPaper
    });
    await bindings.onDeleteOrganizationAnnotation?.({ annotation, paper: organizationPaper });
  });

  expect(createClient).toHaveBeenCalledWith({
    accessToken: "access-token-1",
    endpoint: "https://cloud.example.test"
  });
  expect(client.list).toHaveBeenCalledWith({
    documentId: "document-1",
    organizationId: "organization-1"
  });
  expect(client.create).toHaveBeenCalledWith({
    annotation: localAnnotation,
    documentId: "document-1",
    organizationId: "organization-1"
  });
  expect(client.update).toHaveBeenCalledWith(expect.objectContaining({
    annotationId: "annotation-1",
    body: expect.objectContaining({ note: "Reviewed", updatedAt: expect.any(String) }),
    expectedRevision: 3,
    organizationId: "organization-1"
  }));
  expect(client.remove).toHaveBeenCalledWith({
    annotationId: "annotation-1",
    expectedRevision: 3,
    organizationId: "organization-1"
  });
});

test("exposes governance deletion only for the active organization owner or admin", () => {
  const admin = renderController({ role: "admin" });
  expect(admin.result.current.readerBindings(organizationPaper)
    .canModerateOrganizationAnnotations).toBe(true);
  admin.unmount();

  const staleSummary = renderController({
    summary: { ...organizationSummary("owner"), organizationId: "organization-2" }
  });
  expect(staleSummary.result.current.readerBindings(organizationPaper)
    .canModerateOrganizationAnnotations).toBe(false);
});

test("does not bind local papers or unauthenticated sessions", () => {
  const authenticated = renderController();
  expect(authenticated.result.current.readerBindings(localPaper)).toEqual({});
  authenticated.unmount();

  const unauthenticated = renderController({ account: null });
  expect(unauthenticated.result.current.readerBindings(organizationPaper)).toEqual({});
});
