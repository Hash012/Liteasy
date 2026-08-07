import { expect, test, vi } from "vitest";
import {
  createTeamAnnotationClient,
  resolveOrganizationDocument
} from "../app/features/organization/teamAnnotationClient";

test("shares a local annotation through an authenticated organization-scoped request", async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
    annotationId: "annotation-1",
    body: {},
    createdAt: "2026-08-06T00:00:00.000Z",
    documentId: "document-1",
    organizationId: "organization-1",
    revision: 1,
    updatedAt: "2026-08-06T00:00:00.000Z",
    uploadedBy: "member-1"
  }), { headers: { "Content-Type": "application/json" }, status: 200 }));
  const client = createTeamAnnotationClient({
    accessToken: "access-token-1",
    endpoint: "https://cloud.example.test/",
    fetchImpl: fetchImpl as unknown as typeof fetch
  });

  await client.create({
    annotation: {
      createdAt: "2026-08-06T00:00:00.000Z",
      excerpt: "Evidence",
      id: "highlight-1",
      kind: "highlight",
      page: 2,
      paperIdentity: {
        candidates: [],
        paperId: "document-1",
        primary: { kind: "local", value: "document-1" },
        title: "Paper"
      },
      rects: [{ height: 0.1, left: 0.2, top: 0.3, width: 0.4 }],
      text: "高亮",
      updatedAt: "2026-08-06T00:00:00.000Z",
      visibility: "private"
    },
    documentId: "document-1",
    organizationId: "organization-1"
  });

  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe("https://cloud.example.test/v1/org/annotations/create");
  expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer access-token-1");
  const request = JSON.parse(init?.body as string);
  expect(request).toMatchObject({
    body: { clientAnnotationId: "highlight-1", excerpt: "Evidence", page: 2 },
    documentId: "document-1",
    organizationId: "organization-1"
  });
  expect(request.idempotencyKey).toMatch(/^team-annotation:[a-f0-9]{8}$/);
});

test("recognizes only controlled organization library paths", () => {
  expect(resolveOrganizationDocument({
    id: "document-1",
    sourcePath: "org://organization-1/shared-library/folder/document-1.pdf"
  })).toEqual({ documentId: "document-1", organizationId: "organization-1" });
  expect(resolveOrganizationDocument({ id: "document-1", sourcePath: "/local/document-1.pdf" }))
    .toBeUndefined();
});

test("updates and deletes an organization annotation with optimistic revisions", async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
    annotationId: "annotation-1",
    body: {},
    createdAt: "2026-08-06T00:00:00.000Z",
    deleted: true,
    documentId: "document-1",
    organizationId: "organization-1",
    revision: 2,
    updatedAt: "2026-08-06T00:01:00.000Z",
    uploadedBy: "member-1"
  }), { headers: { "Content-Type": "application/json" }, status: 200 }));
  const client = createTeamAnnotationClient({
    accessToken: "access-token-1",
    endpoint: "https://cloud.example.test",
    fetchImpl: fetchImpl as unknown as typeof fetch
  });
  const body = {
    clientAnnotationId: "highlight-1",
    color: "yellow" as const,
    excerpt: "Evidence",
    kind: "highlight" as const,
    note: "Revised note",
    page: 2,
    rects: [{ height: 0.1, left: 0.2, top: 0.3, width: 0.4 }],
    text: "高亮",
    updatedAt: "2026-08-06T00:01:00.000Z"
  };

  await client.update({
    annotationId: "annotation-1",
    body,
    expectedRevision: 1,
    organizationId: "organization-1"
  });
  await client.remove({
    annotationId: "annotation-1",
    expectedRevision: 2,
    organizationId: "organization-1"
  });

  expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
    "https://cloud.example.test/v1/org/annotations/update",
    "https://cloud.example.test/v1/org/annotations/delete"
  ]);
  const updateRequest = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
  expect(updateRequest).toMatchObject({
    annotationId: "annotation-1",
    body: { note: "Revised note" },
    expectedRevision: 1,
    organizationId: "organization-1"
  });
  expect(updateRequest.idempotencyKey).toMatch(/^team-annotation-update:[a-f0-9]{8}$/);
  const deleteRequest = JSON.parse(fetchImpl.mock.calls[1][1]?.body as string);
  expect(deleteRequest.idempotencyKey).toMatch(/^team-annotation-delete:[a-f0-9]{8}$/);
});

test("preserves stable service errors and hides network internals", async () => {
  const denied = createTeamAnnotationClient({
    accessToken: "access-token-1",
    endpoint: "https://cloud.example.test",
    fetchImpl: vi.fn(async () => new Response(JSON.stringify({
      code: "organization_membership_required",
      message: "当前账号不是该组织成员。",
      traceId: "trace_team_annotation_1"
    }), { headers: { "Content-Type": "application/json" }, status: 403 })) as unknown as typeof fetch
  });

  await expect(denied.list({
    documentId: "document-1",
    organizationId: "organization-1"
  })).rejects.toMatchObject({
    code: "organization_membership_required",
    message: "当前账号不是该组织成员。",
    status: 403,
    traceId: "trace_team_annotation_1"
  });

  const unavailable = createTeamAnnotationClient({
    accessToken: "access-token-1",
    endpoint: "https://cloud.example.test",
    fetchImpl: vi.fn().mockRejectedValue(new Error(
      "connect /srv/liteasy/private.sock using sk-secret"
    )) as unknown as typeof fetch
  });
  const request = unavailable.list({
    documentId: "document-1",
    organizationId: "organization-1"
  });
  await expect(request).rejects.toMatchObject({
    code: "team_annotation_unavailable",
    status: 0
  });
  await expect(request).rejects.not.toThrow(/\/srv\/liteasy|sk-secret/);
});
