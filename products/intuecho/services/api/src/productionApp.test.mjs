import assert from "node:assert/strict";
import test from "node:test";
import { createProductionIntuechoApp } from "./productionApp.mjs";

function config() {
  return {
    allowedOrigins: ["http://web.test"],
    database: { sslMode: "require" },
    environment: "test",
    identity: { issuer: "http://identity.test", webClientId: "intuecho-web" },
    literatureProjection: { audience: "intuecho-internal", clientId: "liteasy-literature-service" }
  };
}

function runtime(overrides = {}) {
  const calls = [];
  const annotationCommunityRepository = {
    async applyDesktopAnnotationPublications(viewer, operations) { calls.push({ applyDesktopAnnotationPublications: { operations, viewer } }); return operations.map((operation) => ({ annotationId: operation.annotationId, queueKey: operation.queueKey, remoteAnnotationId: "annotation-remote-1", remoteRevision: operation.revision, state: operation.operation === "retract" ? "retracted" : "published", syncedAt: "2026-08-09T01:00:00.000Z" })); },
    async consumeHandoff(handoffId, viewerId) { calls.push({ consumeAnnotationHandoff: { handoffId, viewerId } }); return { draft: { body: "", shareToPlaza: true, tags: [], targets: [], visibility: "public" }, replayed: false }; },
    async createHandoff(viewerId, input) { calls.push({ createAnnotationHandoff: { input, viewerId } }); return { expiresAt: new Date("2026-08-07T00:05:00.000Z"), handoffId: "annotation-handoff-1" }; },
    async listAdminAnnotations() { calls.push({ listAdminAnnotations: true }); return []; },
    async listTagAppeals(status) { calls.push({ listTagAppeals: status }); return []; },
    async moderateAnnotation(input) { calls.push({ moderateAnnotation: input }); return { action: input.action, annotationId: input.annotationId, ok: true }; },
    async plaza() { return []; },
    async resolveTagAppeal(appealId, adminId, input, traceId) { calls.push({ resolveTagAppeal: { adminId, appealId, input, traceId } }); return { appealId, decision: input.decision }; },
    async syncDesktopAnnotations(viewer, annotations) { calls.push({ syncDesktopAnnotations: { annotations, viewer } }); return annotations.map((annotation) => ({ annotationId: annotation.annotationId, intuechoAnnotationId: "annotation-legacy-1", queueKey: annotation.queueKey, status: "synced", syncedAt: annotation.updatedAt })); },
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
    literatureResolver: {
      async confirm(owner) {
        return { literatureId: `confirmed-${owner.id}` };
      },
      async resolve(owner) {
        return { status: "exact", candidate: { candidateKey: "crossref:doi:10.1000/reliable", provider: "crossref", record: { authors: [], identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/reliable" }], title: `Reliable for ${owner.id}` } }, unavailableProviders: [] };
      },
      async verifyProjection(literatureId, revision) {
        return literatureId === "literature-verified" && revision === 3
          ? { authors: ["A. Author"], identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/verified" }], literatureId, provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry", provider: "crossref" }, revision, status: "confirmed", title: "Verified Literature" }
          : null;
      },
      ...overrides.literatureResolver
    },
    readiness: { postgres: { writable: true } },
    repository
  };
}

test("keeps public literature resolution on the Intuecho Web audience", async () => {
  const instance = runtime();
  instance.identityVerifier.verifyAuthorizationHeader = async (header, audience) => {
    instance.calls.push({ audience, header });
    return { audience, name: "同名研究者", subject: "user-1", token: header.slice("Bearer ".length) };
  };
  const app = await createProductionIntuechoApp(instance, config());
  try {
    const web = await app.inject({
      headers: { authorization: "Bearer web-token" },
      method: "POST",
      payload: { purpose: "forum_compose", query: "10.1000/reliable" },
      url: "/v1/literature:resolve"
    });
    assert.equal(web.statusCode, 200, web.body);
    assert.equal(web.json().status, "exact");
    assert.equal(instance.calls.find((item) => item.audience === "intuecho-web").audience, "intuecho-web");

    const desktop = await app.inject({
      headers: { authorization: "Bearer desktop-token" },
      method: "POST",
      payload: { purpose: "liteasy_pdf_annotation", query: "10.1000/reliable" },
      url: "/v1/literature:resolve"
    });
    assert.equal(desktop.statusCode, 200, desktop.body);
    assert.equal(instance.calls.filter((item) => item.header === "Bearer desktop-token").every(
      (item) => item.audience === "intuecho-web"
    ), true);

    const desktopConfirm = await app.inject({
      headers: { authorization: "Bearer desktop-token" },
      method: "POST",
      payload: { candidateKey: "intuecho:literature-1", mode: "candidate" },
      url: "/v1/literature:confirm"
    });
    assert.equal(desktopConfirm.statusCode, 200, desktopConfirm.body);
    assert.equal(desktopConfirm.json().literature.literatureId, "confirmed-user-1");

    const invalid = await app.inject({
      headers: { authorization: "Bearer web-token" },
      method: "POST",
      payload: { purpose: "forum_compose" },
      url: "/v1/literature:resolve"
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().code, "INVALID_LITERATURE_QUERY");

    instance.literatureResolver.confirm = async () => {
      const error = new Error("provider key=server-only-key");
      error.code = "LITERATURE_PROVIDER_UNAVAILABLE";
      throw error;
    };

    const unavailable = await app.inject({
      headers: { authorization: "Bearer web-token" },
      method: "POST",
      payload: { candidateKey: "crossref:doi:10.1000/reliable", mode: "candidate" },
      url: "/v1/literature:confirm"
    });
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.json().code, "LITERATURE_PROVIDER_UNAVAILABLE");
    assert.equal(unavailable.body.includes("server-only-key"), false);
  } finally {
    await app.close();
  }
});

test("protects authoritative literature projection verification with the dedicated service client", async () => {
  const instance = runtime();
  instance.identityVerifier.verifyAuthorizationHeader = async (header, audience) => ({
    audience,
    clientId: header === "Bearer service-token" ? "liteasy-literature-service" : "different-service",
    subject: "service-subject",
    token: header.slice("Bearer ".length)
  });
  const app = await createProductionIntuechoApp(instance, config());
  try {
    const verified = await app.inject({
      headers: { authorization: "Bearer service-token" },
      method: "POST",
      payload: { literatureId: "literature-verified", revision: 3 },
      url: "/v1/internal/literature:verify"
    });
    assert.equal(verified.statusCode, 200, verified.body);
    assert.equal(verified.json().literature.literatureId, "literature-verified");

    const stale = await app.inject({
      headers: { authorization: "Bearer service-token" },
      method: "POST",
      payload: { literatureId: "literature-verified", revision: 2 },
      url: "/v1/internal/literature:verify"
    });
    assert.equal(stale.statusCode, 409, stale.body);

    const forbidden = await app.inject({
      headers: { authorization: "Bearer other-token" },
      method: "POST",
      payload: { literatureId: "literature-verified", revision: 3 },
      url: "/v1/internal/literature:verify"
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
  } finally {
    await app.close();
  }
});

test("resolves and confirms private Liteasy literature through a service actor", async () => {
  const resolverCalls = [];
  const instance = runtime({
    literatureResolver: {
      async confirm(actor, input) {
        resolverCalls.push({ actor, input, operation: "confirm" });
        return {
          authors: ["A. Author"],
          identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/private" }],
          literatureId: "literature-private",
          provenance: {
            confirmedAt: "2026-08-11T00:00:00.000Z",
            mode: "public_registry",
            provider: "crossref"
          },
          revision: 1,
          status: "confirmed",
          title: "Private Library Resolution"
        };
      },
      async relations(literatureId) {
        resolverCalls.push({ literatureId, operation: "relations" });
        return { literatureId, versions: [] };
      },
      async resolve(actor, input) {
        resolverCalls.push({ actor, input, operation: "resolve" });
        return {
          candidate: {
            candidateKey: "crossref:doi:10.1000/private",
            provider: "crossref",
            record: {
              authors: ["A. Author"],
              identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/private" }],
              title: "Private Library Resolution"
            }
          },
          confirmationMode: "candidate",
          status: "exact",
          unavailableProviders: []
        };
      }
    }
  });
  instance.identityVerifier.verifyAuthorizationHeader = async (header, audience) => ({
    audience,
    clientId: header === "Bearer service-token" ? "liteasy-literature-service" : "different-service",
    subject: "service-subject",
    token: header.slice("Bearer ".length)
  });
  const app = await createProductionIntuechoApp(instance, config());
  try {
    const headers = { authorization: "Bearer service-token" };
    const resolved = await app.inject({
      headers,
      method: "POST",
      payload: { purpose: "liteasy_pdf_annotation", query: "10.1000/private" },
      url: "/v1/internal/literature:resolve"
    });
    assert.equal(resolved.statusCode, 200, resolved.body);

    const confirmed = await app.inject({
      headers,
      method: "POST",
      payload: { candidateKey: "crossref:doi:10.1000/private", mode: "candidate" },
      url: "/v1/internal/literature:confirm"
    });
    assert.equal(confirmed.statusCode, 200, confirmed.body);

    const relations = await app.inject({
      headers,
      method: "GET",
      url: "/v1/internal/literature/literature-private/relations"
    });
    assert.equal(relations.statusCode, 200, relations.body);
    assert.deepEqual(resolverCalls.map((call) => call.operation), ["resolve", "confirm", "relations"]);
    assert.deepEqual(resolverCalls[0].actor, { id: "liteasy-literature-service" });
    assert.deepEqual(resolverCalls[1].actor, { id: "liteasy-literature-service" });
    assert.equal(JSON.stringify(resolverCalls).includes("user-1"), false);

    const rejected = await app.inject({
      headers: { authorization: "Bearer wrong-service" },
      method: "POST",
      payload: { purpose: "liteasy_pdf_annotation", query: "10.1000/private" },
      url: "/v1/internal/literature:resolve"
    });
    assert.equal(rejected.statusCode, 403);
  } finally {
    await app.close();
  }
});

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

test("accepts a stable OpenAlex identity at the public forum filter boundary", async () => {
  let observedFilters;
  const instance = runtime({
    annotationCommunityRepository: {
      async plaza(_viewer, filters) {
        observedFilters = filters;
        return [];
      }
    }
  });
  const app = await createProductionIntuechoApp(instance, config());
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/plaza?literatureIdentityKind=openalex_id&literatureIdentityValue=W123"
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(observedFilters.literatureIdentityKind, "openalex_id");
    assert.equal(observedFilters.literatureIdentityValue, "W123");
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
  const literature = { literatureId: "literature-reliable" };
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

test("routes desktop publication operations through the desktop audience and repository contract", async () => {
  const instance = runtime();
  const app = await createProductionIntuechoApp(instance, config());
  try {
    const response = await app.inject({
      headers: { authorization: "Bearer desktop-token" },
      method: "POST",
      payload: {
        operations: [{
          annotationId: "desktop-annotation-1",
          body: "这条桌面批注只引用已确认的文献记录。",
          literatureId: "literature-publication-1",
          operation: "upsert",
          queueKey: "paper-publication-1:desktop-annotation-1",
          revision: 1,
          sourcePassage: { anchorHash: "sha256:publication-source", excerpt: "A source passage retained by the desktop annotation.", page: 3, rects: [] },
          updatedAt: "2026-08-09T01:00:00.000Z"
        }]
      },
      url: "/v1/pdf-annotations:sync"
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().results[0].state, "published");
    assert.deepEqual(instance.calls.find((item) => item.applyDesktopAnnotationPublications).applyDesktopAnnotationPublications.viewer, {
      id: "user-1",
      initials: "同名",
      name: "同名研究者"
    });
  } finally {
    await app.close();
  }
});

test("rejects the legacy desktop annotation write payload", async () => {
  const instance = runtime();
  const app = await createProductionIntuechoApp(instance, config());
  try {
    const response = await app.inject({
      headers: { authorization: "Bearer desktop-token" },
      method: "POST",
      payload: {
        annotations: [{
          annotationId: "desktop-annotation-legacy",
          body: "旧版桌面批注。",
          createdAt: "2026-08-09T01:00:00.000Z",
          queueKey: "paper-legacy:desktop-annotation-legacy",
          status: "pending_public",
          targets: [{ kind: "whole_document", literature: { identity: { id: "doi:10.1000/legacy-route", kind: "doi", source: "metadata", value: "10.1000/legacy-route" }, metadata: { authors: [], title: "Legacy route" } } }],
          updatedAt: "2026-08-09T01:00:00.000Z"
        }]
      },
      url: "/v1/pdf-annotations:sync"
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, "INVALID_ANNOTATIONS");
    assert.equal(instance.calls.some((item) => item.syncDesktopAnnotations), false);
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
