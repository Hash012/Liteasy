import { randomBytes } from "node:crypto";

const identityBaseUrl = process.env.LITEASY_IDENTITY_ENDPOINT ?? "http://127.0.0.1:8787";
const forumBaseUrl = process.env.INTUECHO_API_ENDPOINT ?? "http://127.0.0.1:4040";

async function request(baseUrl, path, { body, method, sessionId } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: body === undefined
      ? undefined
      : JSON.stringify(body, (key, current) => key === "literatureRecord" ? undefined : current),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(sessionId ? { Authorization: `Bearer ${sessionId}` } : {})
    },
    method: method ?? (body === undefined ? "GET" : "POST")
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload.code ?? payload.error;
    throw new Error(`${path} failed with HTTP ${response.status}${code ? ` ${code}` : ""}: ${payload.message ?? "unknown error"}`);
  }
  return payload;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const email = `forum.e2e.${suffix}@liteasy.local`;
const password = `Forum-E2E-${randomBytes(18).toString("base64url")}!`;

const registered = await request(identityBaseUrl, "/v1/account/register", {
  body: {
    audience: "liteasy-desktop",
    displayName: "论坛联调用户",
    email,
    password
  }
});
const desktopSession = registered.session;
assert(desktopSession?.audience === "liteasy-desktop", "registration did not issue a desktop session");

const webLogin = await request(identityBaseUrl, "/v1/account/login", {
  body: { audience: "intuecho-web", email, password }
});
const webSession = webLogin.session;
assert(webSession?.audience === "intuecho-web", "login did not issue a Web session");
assert(webSession.userId === desktopSession.userId, "desktop and Web sessions do not share one subject");

const handoff = await request(forumBaseUrl, "/v1/integrations/desktop/draft-handoffs", {
  body: {
    context: {
      anchorHash: `e2e:${suffix}:colbert`,
      citationEnabled: true,
      excerpt: "ColBERT uses contextualized late interaction for passage retrieval.",
      language: "zh-CN",
      page: 1,
      topicId: "rag-reliability",
      workId: "colbert-demo"
    },
    update: {
      body: `桌面到论坛真实联调帖子 ${suffix}`,
      citationEnabled: true,
      tags: ["端到端联调"],
      title: "桌面阅读上下文联调"
    }
  },
  sessionId: desktopSession.sessionId
});
assert(handoff.handoffId, "desktop handoff was not created");

const consumed = await request(forumBaseUrl, `/v1/draft-handoffs/${encodeURIComponent(handoff.handoffId)}/consume`, {
  body: {},
  sessionId: webSession.sessionId
});
assert(consumed.draftId && consumed.replayed === false, "Web did not consume the desktop handoff");

const published = await request(forumBaseUrl, "/v1/posts", {
  body: { draftId: consumed.draftId },
  sessionId: webSession.sessionId
});
assert(published.postId, "consumed draft was not published");

const feed = await request(
  forumBaseUrl,
  `/v1/contextual-feed?workId=colbert-demo&anchorHash=${encodeURIComponent(`e2e:${suffix}:colbert`)}`
);
assert(feed.posts?.some((post) => post.id === published.postId), "desktop contextual feed did not return the published post");

const paperIdentity = {
  id: "doi:10.1145/3397271.3401075",
  kind: "doi",
  source: "metadata",
  value: "10.1145/3397271.3401075"
};
const confirmedLiterature = await request(forumBaseUrl, "/v1/literature:confirm", {
  body: {
    mode: "manual",
    record: {
      authors: ["Omar Khattab", "Matei Zaharia"],
      documentType: "conference_paper",
      identifiers: [{ kind: "doi", source: "manual", value: paperIdentity.value }],
      title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
      year: 2020
    }
  },
  sessionId: desktopSession.sessionId
});
assert(confirmedLiterature.literature?.provenance?.mode === "manual", "manual literature record provenance was not persisted");
assert(
  confirmedLiterature.literature.identifiers?.every((identifier) => identifier.source === "manual"),
  "manual literature identifier provenance was not persisted"
);
const literatureId = confirmedLiterature.literature.literatureId;
const firstUpdatedAt = new Date().toISOString();
const annotation = await request(forumBaseUrl, "/v1/pdf-annotations:sync", {
  body: {
    operations: [{
      annotationId: `pdf-${suffix}`,
      body: "真实 HTTP 联调批注",
      literatureId,
      operation: "upsert",
      queueKey: `colbert-demo:pdf-${suffix}`,
      revision: 1,
      sourcePassage: {
        anchorHash: `e2e:${suffix}:colbert`,
        excerpt: "contextualized late interaction",
        page: 1,
        rects: []
      },
      updatedAt: firstUpdatedAt
    }]
  },
  sessionId: desktopSession.sessionId
});
const remoteAnnotationId = annotation.results?.[0]?.remoteAnnotationId;
assert(remoteAnnotationId, "PDF annotation sync did not return a verified receipt");

const parentAnnotation = await request(forumBaseUrl, `/v1/annotations/${encodeURIComponent(remoteAnnotationId)}`, {
  sessionId: webSession.sessionId
});
assert(parentAnnotation.annotation?.targets?.length > 0, "synced parent annotation did not retain a literature target");
const persistedLiterature = parentAnnotation.annotation.targets[0]?.literature?.literatureRecord;
assert(persistedLiterature?.provenance?.mode === "manual", "persisted annotation did not hydrate manual literature provenance");
assert(
  persistedLiterature.identifiers?.every((identifier) => identifier.source === "manual"),
  "persisted annotation did not hydrate manual identifier provenance"
);

const secondAnnotation = await request(forumBaseUrl, "/v1/pdf-annotations:sync", {
  body: {
    operations: [{
      annotationId: `pdf-second-${suffix}`,
      body: "复用已确认文献身份的第二条批注",
      literatureId,
      operation: "upsert",
      queueKey: `colbert-demo:pdf-second-${suffix}`,
      revision: 1,
      sourcePassage: {
        anchorHash: `e2e:${suffix}:colbert-second`,
        excerpt: "late interaction scoring",
        page: 2,
        rects: []
      },
      updatedAt: new Date(Date.parse(firstUpdatedAt) + 1_000).toISOString()
    }]
  },
  sessionId: desktopSession.sessionId
});
const secondRemoteAnnotationId = secondAnnotation.results?.[0]?.remoteAnnotationId;
assert(secondRemoteAnnotationId, "second annotation did not reuse the confirmed literature record");
const secondPersisted = await request(forumBaseUrl, `/v1/annotations/${encodeURIComponent(secondRemoteAnnotationId)}`, {
  sessionId: webSession.sessionId
});
assert(
  secondPersisted.annotation?.targets?.[0]?.literature?.literatureId === literatureId,
  "second annotation did not persist the reused literature identity"
);

const pureReply = await request(forumBaseUrl, `/v1/annotations/${encodeURIComponent(remoteAnnotationId)}/replies`, {
  body: { body: "仅保留在线程中的回复", publishAsAnnotation: false, tags: [], targets: [] },
  sessionId: webSession.sessionId
});
assert(pureReply.reply?.derivedAnnotationState === "none" && pureReply.annotation === null, "pure reply unexpectedly created an independent annotation");

const projectedReply = await request(forumBaseUrl, `/v1/annotations/${encodeURIComponent(remoteAnnotationId)}/replies`, {
  body: {
    body: "同时发布为独立批注的回复",
    publishAsAnnotation: true,
    tags: ["端到端联调"],
    targets: parentAnnotation.annotation.targets
  },
  sessionId: webSession.sessionId
});
const projectedAnnotationId = projectedReply.reply?.derivedAnnotationId;
assert(projectedAnnotationId && projectedReply.reply.derivedAnnotationState === "published", "reply projection was not published");
assert(projectedReply.annotation?.targets?.length === parentAnnotation.annotation.targets.length, "reply projection did not inherit literature targets");
assert(projectedReply.annotation?.shareToPlaza === true, "public reply projection was not published to the plaza");

const editedReply = await request(forumBaseUrl, `/v1/replies/${encodeURIComponent(projectedReply.reply.id)}`, {
  body: { body: "回复正文已同步编辑" },
  method: "PUT",
  sessionId: webSession.sessionId
});
assert(editedReply.reply?.body === "回复正文已同步编辑", "canonical reply edit did not persist");
const editedProjection = await request(forumBaseUrl, `/v1/annotations/${encodeURIComponent(projectedAnnotationId)}`, {
  sessionId: webSession.sessionId
});
assert(editedProjection.annotation?.body === "回复正文已同步编辑", "canonical reply edit did not synchronize the projection");

const withdrawnProjection = await request(forumBaseUrl, `/v1/replies/${encodeURIComponent(projectedReply.reply.id)}/publication`, {
  body: { published: false },
  method: "PUT",
  sessionId: webSession.sessionId
});
assert(withdrawnProjection.reply?.derivedAnnotationState === "withdrawn", "reply projection withdrawal did not retain remote state");

const restoredProjection = await request(forumBaseUrl, `/v1/replies/${encodeURIComponent(projectedReply.reply.id)}/publication`, {
  body: { published: true, tags: ["端到端联调"], targets: parentAnnotation.annotation.targets },
  method: "PUT",
  sessionId: webSession.sessionId
});
assert(restoredProjection.reply?.derivedAnnotationState === "published", "reply projection restore did not publish remote state");

const recommendations = await request(forumBaseUrl, "/v1/thin-reading/recommendations:query", {
  body: { scope: { kind: "document", paperIdentity } },
  sessionId: desktopSession.sessionId
});
assert(
  recommendations.recommendations?.some((item) => item.id === remoteAnnotationId),
  "community recommendation query did not return the exact-paper annotation"
);

await request(forumBaseUrl, `/v1/annotations/${encodeURIComponent(remoteAnnotationId)}`, {
  method: "DELETE",
  sessionId: webSession.sessionId
});
const orphanContext = await request(forumBaseUrl, `/v1/annotations/${encodeURIComponent(projectedAnnotationId)}`, {
  sessionId: webSession.sessionId
});
assert(orphanContext.annotation?.originalReply?.status === "parent_deleted", "derived annotation did not preserve deleted-parent context");

console.log(JSON.stringify({
  annotationId: remoteAnnotationId,
  draftId: consumed.draftId,
  handoffId: handoff.handoffId,
  postId: published.postId,
  projectedAnnotationId,
  pureReplyId: pureReply.reply.id,
  secondAnnotationId: secondRemoteAnnotationId,
  subjectId: desktopSession.userId,
  verified: true
}, null, 2));
