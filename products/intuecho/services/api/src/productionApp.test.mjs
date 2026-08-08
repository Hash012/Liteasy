import assert from "node:assert/strict";
import test from "node:test";
import { createProductionIntuechoApp } from "./productionApp.mjs";

function config() {
  return {
    allowedOrigins: ["http://web.test"],
    database: { sslMode: "require" },
    environment: "test",
    identity: { issuer: "http://identity.test", webClientId: "intuecho-web" }
  };
}

function runtime(overrides = {}) {
  const calls = [];
  const annotationCommunityRepository = {
    async consumeHandoff(handoffId, viewerId) { calls.push({ consumeAnnotationHandoff: { handoffId, viewerId } }); return { draft: { body: "", shareToPlaza: true, tags: [], targets: [], visibility: "public" }, replayed: false }; },
    async createHandoff(viewerId, input) { calls.push({ createAnnotationHandoff: { input, viewerId } }); return { expiresAt: new Date("2026-08-07T00:05:00.000Z"), handoffId: "annotation-handoff-1" }; },
    async listAdminAnnotations() { calls.push({ listAdminAnnotations: true }); return []; },
    async listTagAppeals(status) { calls.push({ listTagAppeals: status }); return []; },
    async moderateAnnotation(input) { calls.push({ moderateAnnotation: input }); return { action: input.action, annotationId: input.annotationId, ok: true }; },
    async plaza() { return []; },
    async resolveTagAppeal(appealId, adminId, input, traceId) { calls.push({ resolveTagAppeal: { adminId, appealId, input, traceId } }); return { appealId, decision: input.decision }; },
    ...overrides.annotationCommunityRepository
  };
  const repository = {
    async communityRecommendations(scope) { calls.push({ communityRecommendations: scope }); return []; },
    async consumeDraftHandoff(handoffId, viewerId) { calls.push({ consumeDraftHandoff: { handoffId, viewerId } }); return { draftId: "draft-1", replayed: false }; },
    async createDraftHandoff(viewerId, input) { calls.push({ createDraftHandoff: { input, viewerId } }); return { expiresAt: new Date("2026-08-07T00:05:00.000Z"), handoffId: "handoff-1" }; },
    async createTopic(input) { calls.push({ createTopic: input }); return { id: "topic-1", ...input }; },
    async listAdminPosts() { return []; },
    async listPosts(viewerId, criteria) { calls.push({ criteria, listPosts: viewerId }); return []; },
    async listTopics(viewerId) { calls.push({ listTopics: viewerId }); return []; },
    async moderatePost(input) { calls.push({ moderatePost: input }); return { action: input.action, ok: true, postId: input.postId }; },
    async syncCommunityAnnotations(viewerId, items) { calls.push({ syncCommunityAnnotations: { items, viewerId } }); return []; },
    ...overrides.repository
  };
  return {
    accountLifecycleRepository: {
      async deleteAccount(input) {
        calls.push({ deleteAccount: input });
        return {
          completedAt: "2026-08-07T00:00:00.000Z",
          operationId: input.idempotencyKey,
          result: { deletedDrafts: 1 },
          subjectId: input.subjectId
        };
      },
      ...overrides.accountLifecycleRepository
    },
    annotationCommunityRepository,
    adminAuthorizer: {
      async assertPlatformAdmin(identity) { calls.push({ adminAuthorization: identity.subject }); },
      ...overrides.adminAuthorizer
    },
    calls,
    identityVerifier: {
      async verifyAuthorizationHeader(header, audience) {
        calls.push({ audience, header });
        if (audience === "liteasy-admin") return {
          audience,
          authenticationMethods: ["pwd", "mfa"],
          authTime: Date.now() / 1000,
          subject: "admin-1",
          token: "admin-token"
        };
        return { audience, name: "同名研究者", subject: "user-1", token: "user-token" };
      },
      ...overrides.identityVerifier
    },
    readiness: { postgres: { writable: true } },
    repository
  };
}

test("keeps public reads anonymous and exposes only public identity client metadata", async () => {
  const instance = runtime();
  const app = await createProductionIntuechoApp(instance, config());
  try {
    const topics = await app.inject({ method: "GET", url: "/v1/topics" });
    const identity = await app.inject({ method: "GET", url: "/v1/identity/web-config" });
    assert.equal(topics.statusCode, 200);
    assert.deepEqual(instance.calls[0], { listTopics: undefined });
    assert.deepEqual(identity.json(), {
      audience: "intuecho-web",
      authorizationFlow: "authorization_code_pkce",
      clientId: "intuecho-web",
      issuer: "http://identity.test"
    });
  } finally {
    await app.close();
  }
});

test("derives forum ownership from an intuecho-web Bearer token", async () => {
  const instance = runtime();
  const app = await createProductionIntuechoApp(instance, config());
  try {
    const mine = await app.inject({
      headers: { authorization: "Bearer user-token" },
      method: "GET",
      url: "/v1/me/posts"
    });
    assert.equal(mine.statusCode, 200);
    assert.deepEqual(instance.calls.find((item) => item.listPosts), {
      criteria: { authorId: "user-1" },
      listPosts: "user-1"
    });
    assert.equal(instance.calls.find((item) => item.audience).audience, "intuecho-web");
  } finally {
    await app.close();
  }
});

test("isolates desktop integration routes from Web draft consumption by audience", async () => {
  const instance = runtime();
  const app = await createProductionIntuechoApp(instance, config());
  try {
    const created = await app.inject({
      headers: { authorization: "Bearer desktop-token" },
      method: "POST",
      payload: { context: { language: "zh-CN", topicId: "topic-1" } },
      url: "/v1/integrations/desktop/draft-handoffs"
    });
    assert.equal(created.statusCode, 201, created.body);
    const createCall = instance.calls.find((item) => item.createDraftHandoff).createDraftHandoff;
    assert.equal(createCall.viewerId, "user-1");
    assert.equal(instance.calls.find((item) => item.audience === "liteasy-desktop").audience, "liteasy-desktop");

    const consumed = await app.inject({
      headers: { authorization: "Bearer web-token" },
      method: "POST",
      url: "/v1/draft-handoffs/handoff-1/consume"
    });
    assert.equal(consumed.statusCode, 200, consumed.body);
    assert.deepEqual(instance.calls.find((item) => item.consumeDraftHandoff).consumeDraftHandoff, {
      handoffId: "handoff-1",
      viewerId: "user-1"
    });
    assert.equal(instance.calls.filter((item) => item.audience === "intuecho-web").length, 1);
  } finally {
    await app.close();
  }
});

test("uses the desktop audience for topic-free annotation handoff and Web audience for consumption", async () => {
  const instance = runtime();
  const app = await createProductionIntuechoApp(instance, config());
  const literature = {
    identity: { id: "doi:10.1000/reliable", kind: "doi", source: "metadata", value: "10.1000/reliable" },
    metadata: { authors: ["Author"], title: "Reliable Paper", year: 2025 }
  };
  try {
    const created = await app.inject({
      headers: { authorization: "Bearer desktop-token" },
      method: "POST",
      payload: { body: "", shareToPlaza: true, tags: [], targets: [{ kind: "whole_document", literature }], visibility: "public" },
      url: "/v1/integrations/desktop/annotation-handoffs"
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(instance.calls.find((item) => item.createAnnotationHandoff).createAnnotationHandoff.viewerId, "user-1");
    assert.equal(instance.calls.some((item) => item.audience === "liteasy-desktop"), true);

    const consumed = await app.inject({
      headers: { authorization: "Bearer web-token" },
      method: "POST",
      url: "/v1/annotation-handoffs/annotation-handoff-1/consume"
    });
    assert.equal(consumed.statusCode, 200, consumed.body);
    assert.deepEqual(instance.calls.find((item) => item.consumeAnnotationHandoff).consumeAnnotationHandoff, { handoffId: "annotation-handoff-1", viewerId: "user-1" });
  } finally {
    await app.close();
  }
});

test("requires a centrally confirmed administrator and fresh MFA for moderation", async () => {
  const instance = runtime();
  const app = await createProductionIntuechoApp(instance, config());
  try {
    const response = await app.inject({
      headers: { authorization: "Bearer admin-token" },
      method: "POST",
      payload: { action: "withdraw", reason: "违反社区规范" },
      url: "/v1/admin/posts/post-1/moderate"
    });
    assert.equal(response.statusCode, 200);
    assert.equal(instance.calls.some((item) => item.adminAuthorization === "admin-1"), true);
    const moderation = instance.calls.find((item) => item.moderatePost).moderatePost;
    assert.equal(moderation.adminId, "admin-1");
    assert.match(moderation.traceId, /^req-/);
  } finally {
    await app.close();
  }
});

test("governs annotations and platform tag appeals through the isolated admin boundary", async () => {
  const instance = runtime();
  const app = await createProductionIntuechoApp(instance, config());
  const headers = { authorization: "Bearer admin-token" };
  try {
    const annotations = await app.inject({ headers, method: "GET", url: "/v1/admin/annotations" });
    assert.equal(annotations.statusCode, 200, annotations.body);
    const moderated = await app.inject({
      headers,
      method: "POST",
      payload: { action: "withdraw", reason: "批注违反已经确认的社区治理规则。" },
      url: "/v1/admin/annotations/annotation-1/moderate"
    });
    assert.equal(moderated.statusCode, 200, moderated.body);
    const appeals = await app.inject({
      headers,
      method: "GET",
      url: "/v1/admin/annotation-tag-appeals?status=pending"
    });
    assert.equal(appeals.statusCode, 200, appeals.body);
    const resolved = await app.inject({
      headers,
      method: "POST",
      payload: { decision: "accepted", reason: "复核文献证据后确认平台标签分类错误。" },
      url: "/v1/admin/annotation-tag-appeals/appeal-1/resolve"
    });
    assert.equal(resolved.statusCode, 200, resolved.body);

    assert.equal(instance.calls.filter((item) => item.audience === "liteasy-admin").length, 4);
    assert.equal(instance.calls.filter((item) => item.adminAuthorization === "admin-1").length, 4);
    assert.equal(instance.calls.some((item) => item.listAdminAnnotations), true);
    assert.equal(instance.calls.some((item) => item.listTagAppeals === "pending"), true);
    const moderation = instance.calls.find((item) => item.moderateAnnotation).moderateAnnotation;
    assert.equal(moderation.adminId, "admin-1");
    assert.equal(moderation.annotationId, "annotation-1");
    assert.match(moderation.traceId, /^req-/);
    const resolution = instance.calls.find((item) => item.resolveTagAppeal).resolveTagAppeal;
    assert.equal(resolution.adminId, "admin-1");
    assert.equal(resolution.appealId, "appeal-1");
    assert.match(resolution.traceId, /^req-/);
  } finally {
    await app.close();
  }
});

test("re-verifies platform administration and fresh MFA before account deletion", async () => {
  const instance = runtime();
  const app = await createProductionIntuechoApp(instance, config());
  try {
    const response = await app.inject({
      headers: { authorization: "Bearer admin-token" },
      method: "POST",
      payload: { idempotencyKey: "delete-user-0001:intuecho", reason: "Approved account deletion" },
      url: "/v1/admin/accounts/user-1/delete"
    });
    assert.equal(response.statusCode, 200, response.body);
    const call = instance.calls.find((item) => item.deleteAccount).deleteAccount;
    assert.equal(call.requestedBy, "admin-1");
    assert.equal(call.subjectId, "user-1");
    assert.match(call.traceId, /^req-/);
    assert.equal(instance.calls.some((item) => item.adminAuthorization === "admin-1"), true);
  } finally {
    await app.close();
  }
});

test("returns stable errors with a trace id and never exposes internal exceptions", async () => {
  const instance = runtime({ repository: {
    async listTopics() { throw new Error("SELECT secret FROM internal_table"); }
  } });
  const app = await createProductionIntuechoApp(instance, config());
  try {
    const response = await app.inject({ method: "GET", url: "/v1/topics" });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(Object.keys(response.json()).sort(), ["code", "message", "traceId"]);
    assert.equal(response.body.includes("SELECT secret"), false);
  } finally {
    await app.close();
  }
});
