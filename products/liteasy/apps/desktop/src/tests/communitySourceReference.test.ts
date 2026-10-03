import { expect, test, vi } from "vitest";
import { communitySourceLink, parseCommunitySourceLink } from "../app/features/forum/communitySourceReference";
import { createForumClient } from "../app/features/forum/forumClient";
const source = { sourceNamespace: "intuecho.reply" as const, sourceId: "synthetic-reply", revision: 3, locator: { kind: "source_passage" as const, page: 2, anchorHash: "synthetic-anchor" } };
const actor = { endpoint: "https://forum.example.test", issuer: "https://identity.example.test", subject: "synthetic-a", scopeType: "user" as const, scopeId: "synthetic-a", sessionGeneration: "one" };
test("community handoff round-trips the namespace, exact revision and locator without accepting service overrides", () => {
  expect(parseCommunitySourceLink(communitySourceLink(source))).toEqual(source);
  for (const suffix of ["&endpoint=https://attacker.test", "&revision=4", "#body", "&page=0"]) expect(() => parseCommunitySourceLink(communitySourceLink(source) + suffix)).toThrow();
  expect(() => parseCommunitySourceLink("liteasy://community-sources/intuecho.reply/synthetic")).toThrow();
});
test("reads the pinned revision with current forum authentication and rejects late cross-account responses", async () => {
  let current = actor;
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ...source, currentRevision: 4, historical: true, body: "Synthetic revision three" }) }) as Response);
  const client = createForumClient({ apiBaseUrl: actor.endpoint, getActorBinding: () => current, getSessionId: () => "synthetic-forum-token", fetchImpl: fetchImpl as typeof fetch });
  expect(await client.readCommunitySource(source)).toMatchObject({ revision: 3, currentRevision: 4, historical: true, locator: source.locator });
  expect(fetchImpl).toHaveBeenCalledWith("https://forum.example.test/v1/integrations/desktop/community-sources/intuecho.reply/synthetic-reply/revisions/3", { headers: { Authorization: "Bearer synthetic-forum-token" } });
  fetchImpl.mockImplementationOnce(async () => { current = { ...actor, subject: "b", scopeId: "b" }; return { ok: true, json: async () => ({ ...source, currentRevision: 4, historical: true, body: "Must not return to B" }) } as Response; });
  await expect(client.readCommunitySource(source)).rejects.toThrow("账号或服务已变化");
});
test("mismatched revisions and withdrawn sources never yield a replacement snapshot", async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ...source, revision: 4, currentRevision: 4, historical: false, body: "Latest must not replace old" }) }) as Response);
  const client = createForumClient({ apiBaseUrl: actor.endpoint, getActorBinding: () => actor, sessionId: "synthetic", fetchImpl: fetchImpl as typeof fetch });
  await expect(client.readCommunitySource(source)).rejects.toThrow("修订无法核实");
  fetchImpl.mockImplementationOnce(async () => ({ ok: false, json: async () => ({ error: "来源当前不可访问" }) }) as Response);
  await expect(client.readCommunitySource(source)).rejects.toThrow("不可访问");
});
