import { expect, test, vi } from "vitest";
import { createForumClient } from "../app/features/forum/forumClient";
import type { PublicationActorBinding } from "../app/features/forum/publicationActorBinding";
const actor: PublicationActorBinding = { endpoint: "https://community.example.invalid", issuer: "https://id.example.invalid", subject: "owner", scopeType: "user", scopeId: "owner", sessionGeneration: "runtime:1" };
const value = { author: { id: "owner", name: "Synthetic Owner", initials: "SO" }, profile: { revision: 4, educationStage: "undergraduate", institutions: [{ name: "Synthetic University" }] } };

test("reads only the verified actor profile used by publication and rejects substituted subjects", async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => value }) as Response);
  const client = createForumClient({ apiBaseUrl: actor.endpoint, sessionId: "synthetic", getActorBinding: () => actor, fetchImpl: fetchImpl as typeof fetch });
  expect(await client.readPublicationAuthorProfile(actor)).toEqual(value);
  expect(fetchImpl.mock.calls[0]).toEqual([`${actor.endpoint}/v1/integrations/desktop/publication-profile`, expect.objectContaining({ method: "POST", body: "{}" })]);
  fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => ({ ...value, author: { ...value.author, id: "another" } }) } as Response);
  await expect(client.readPublicationAuthorProfile(actor)).rejects.toThrow();
});

test("holds profile responses across session changes and rejects missing revision", async () => {
  let current = actor;
  const fetchImpl = vi.fn(async () => { current = { ...actor, sessionGeneration: "runtime:2" }; return { ok: true, json: async () => value } as Response; });
  const client = createForumClient({ apiBaseUrl: actor.endpoint, sessionId: "synthetic", getActorBinding: () => current, fetchImpl: fetchImpl as typeof fetch });
  await expect(client.readPublicationAuthorProfile(actor)).rejects.toThrow("会话");
  current = actor;
  fetchImpl.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ ...value, profile: { ...value.profile, revision: undefined } }) }) as Response);
  await expect(client.readPublicationAuthorProfile(actor)).rejects.toThrow();
});


test("previews every frozen target and evidence excerpt, including multiple derived sources", async () => {
  const { thinReadingPublicationExcerpts } = await import("../app/features/thin-reading/thinReadingIntuechoSyncQueue");
  const evidence = (excerpt: string, literatureId: string) => ({ kind: "source_passage" as const, anchorHash: "synthetic-anchor", excerpt, literature: { literatureId }, page: 2, rects: [] });
  const pendingOperation = { annotationId: "local", queueKey: "artifact:local", body: "Reader note", status: "pending_public" as const,
    createdAt: "2026-10-03T01:00:00.000Z", updatedAt: "2026-10-03T01:00:00.000Z", targets: [
      evidence("First source", "source-1"), { kind: "derived_passage" as const, literature: { literatureId: "source-1" },
        derivedContent: { artifactId: "artifact", nodeId: "node", version: "v1", excerpt: "Derived excerpt" },
        evidence: [evidence("Second source", "source-2"), evidence("Third source", "source-3")] }
    ] };
  const result = thinReadingPublicationExcerpts({ pendingOperation } as Parameters<typeof thinReadingPublicationExcerpts>[0]);
  expect(result.map(({ text }) => text)).toEqual(["First source", "Derived excerpt", "Second source", "Third source"]);
  expect(result[3].label).toContain("source-3");
});
