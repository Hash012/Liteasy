import { randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";

const identityBaseUrl = process.env.LITEASY_IDENTITY_ENDPOINT ?? "http://127.0.0.1:8787";
const forumApiUrl = process.env.INTUECHO_API_ENDPOINT ?? "http://127.0.0.1:4040";
const forumWebUrl = process.env.INTUECHO_WEB_ENDPOINT ?? "http://127.0.0.1:5174";

async function request(baseUrl, path, { body, method = body === undefined ? "GET" : "POST", sessionId } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(sessionId ? { Authorization: `Bearer ${sessionId}` } : {})
    },
    method
  });
  const payload = await response.json().catch(() => ({}));
  return { payload, response };
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function identity(suffix, name) {
  const email = `annotation.closure.${suffix}.${name}@liteasy.local`;
  const password = `Annotation-${randomBytes(18).toString("base64url")}!`;
  const registered = await request(identityBaseUrl, "/v1/account/register", {
    body: { audience: "liteasy-desktop", displayName: name, email, password }
  });
  assert(registered.response.ok, "desktop identity registration failed");
  const loggedIn = await request(identityBaseUrl, "/v1/account/login", {
    body: { audience: "intuecho-web", email, password }
  });
  assert(loggedIn.response.ok, "Web identity login failed");
  return { desktop: registered.payload.session, web: loggedIn.payload.session };
}

const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const author = await identity(suffix, "批注作者");
const respondent = await identity(suffix, "证据回复者");
const literature = {
  identity: { id: "doi:10.1145/3397271.3401075", kind: "doi", source: "metadata", value: "10.1145/3397271.3401075" },
  metadata: { authors: ["Omar Khattab", "Matei Zaharia"], documentType: "conference_paper", title: "ColBERT", year: 2020 }
};
const target = { anchorHash: `closure:${suffix}:evidence`, excerpt: "Contextualized late interaction preserves token-level evidence.", kind: "source_passage", literature, page: 1, rects: [] };

const synced = await request(forumApiUrl, "/v1/thin-reading/annotations:sync", {
  body: { annotations: [{ annotationId: `desktop-${suffix}`, body: `自动公开批注 ${suffix}`, createdAt: new Date().toISOString(), queueKey: `closure:${suffix}`, status: "pending_public", targets: [target], updatedAt: new Date().toISOString() }] },
  sessionId: author.desktop.sessionId
});
assert(synced.response.ok, "desktop annotation sync failed");
const rootId = synced.payload.results?.[0]?.intuechoAnnotationId;
assert(rootId, "desktop annotation sync returned no receipt");

const recommendation = await request(forumApiUrl, "/v1/thin-reading/recommendations:query", {
  body: { scope: { kind: "document", paperIdentity: literature.identity } },
  sessionId: respondent.desktop.sessionId
});
assert(recommendation.response.ok && recommendation.payload.recommendations.some((item) => item.id === rootId), "desktop recommendation API did not return the annotation");

const pureReply = await request(forumApiUrl, `/v1/annotations/${rootId}/replies`, {
  body: { body: "只作为回复，不产生广场批注。", shareToPlaza: false, tags: [], targets: [] },
  sessionId: respondent.web.sessionId
});
assert(pureReply.response.status === 201 && pureReply.payload.annotation === null, "pure reply was incorrectly promoted");

const promotedReply = await request(forumApiUrl, `/v1/annotations/${rootId}/replies`, {
  body: { body: "带原文证据的回复同步成为一条独立批注。", shareToPlaza: true, tags: ["证据"], targets: [target] },
  sessionId: respondent.web.sessionId
});
const derivedId = promotedReply.payload.annotation?.id;
assert(promotedReply.response.status === 201 && derivedId === promotedReply.payload.reply?.derivedAnnotationId, "targeted reply did not create one derived annotation");

const firstRating = await request(forumApiUrl, `/v1/annotations/${rootId}/rating`, { body: { rating: 5 }, method: "PUT", sessionId: respondent.web.sessionId });
const changedRating = await request(forumApiUrl, `/v1/annotations/${rootId}/rating`, { body: { rating: 3 }, method: "PUT", sessionId: respondent.web.sessionId });
assert(firstRating.payload.ratingCount === 1 && changedRating.payload.ratingAverage === 3, "one-current-rating update failed");
const selfRating = await request(forumApiUrl, `/v1/annotations/${rootId}/rating`, { body: { rating: 4 }, method: "PUT", sessionId: author.web.sessionId });
assert(selfRating.response.status === 403 && selfRating.payload.error === "SELF_RATING_FORBIDDEN", "self rating was not rejected");

const withdrawn = await request(forumApiUrl, `/v1/annotations/${rootId}`, { method: "DELETE", sessionId: author.web.sessionId });
assert(withdrawn.response.ok, "parent annotation withdrawal failed");
const retained = await request(forumApiUrl, `/v1/annotations/${derivedId}`);
assert(retained.response.ok && retained.payload.annotation.originalReply?.status === "parent_deleted", "derived annotation did not retain the deleted-parent state");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { height: 760, width: 1100 } });
  await page.goto(`${forumWebUrl}/annotations/${encodeURIComponent(derivedId)}`, { waitUntil: "domcontentloaded" });
  await page.getByText("原回复对象已删除", { exact: true }).waitFor();
  await page.screenshot({ fullPage: true, path: "/tmp/intuecho-annotation-closure-e2e.png" });
} finally {
  await browser.close();
}

console.log(JSON.stringify({ derivedId, recommendationVerified: true, rootId, screenshot: "/tmp/intuecho-annotation-closure-e2e.png", verified: true }, null, 2));
