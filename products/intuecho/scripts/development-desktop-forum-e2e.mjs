import { randomBytes } from "node:crypto";

const identityBaseUrl = process.env.LITEASY_IDENTITY_ENDPOINT ?? "http://127.0.0.1:8787";
const forumBaseUrl = process.env.INTUECHO_API_ENDPOINT ?? "http://127.0.0.1:4040";

async function request(baseUrl, path, { body, sessionId } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(sessionId ? { Authorization: `Bearer ${sessionId}` } : {})
    },
    method: body === undefined ? "GET" : "POST"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}: ${payload.message ?? payload.error ?? payload.code ?? "unknown error"}`);
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
const annotation = await request(forumBaseUrl, "/v1/pdf-annotations:sync", {
  body: {
    annotations: [{
      annotationId: `pdf-${suffix}`,
      body: "真实 HTTP 联调批注",
      createdAt: new Date().toISOString(),
      excerpt: "contextualized late interaction",
      paperIdentity: { primary: paperIdentity },
      queueKey: `colbert-demo:pdf-${suffix}`,
      scope: { kind: "pdf_passage", page: 1, rects: [] },
      status: "pending_public",
      updatedAt: new Date().toISOString()
    }]
  },
  sessionId: desktopSession.sessionId
});
const remoteAnnotationId = annotation.results?.[0]?.intuechoAnnotationId;
assert(remoteAnnotationId, "PDF annotation sync did not return a verified receipt");

const recommendations = await request(forumBaseUrl, "/v1/thin-reading/recommendations:query", {
  body: { scope: { kind: "document", paperIdentity } },
  sessionId: desktopSession.sessionId
});
assert(
  recommendations.recommendations?.some((item) => item.id === remoteAnnotationId),
  "community recommendation query did not return the exact-paper annotation"
);

console.log(JSON.stringify({
  annotationId: remoteAnnotationId,
  draftId: consumed.draftId,
  handoffId: handoff.handoffId,
  postId: published.postId,
  subjectId: desktopSession.userId,
  verified: true
}, null, 2));
