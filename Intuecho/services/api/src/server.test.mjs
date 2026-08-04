import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createIntuechoApp } from "./server.mjs";

const userHeader = { "x-intuecho-user": "demo-user" };

async function withApp(callback) {
  const directory = mkdtempSync(join(tmpdir(), "intuecho-api-"));
  const { app, db } = await createIntuechoApp({ databasePath: join(directory, "test.db") });
  try {
    return await callback(app, db);
  } finally {
    await app.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("signals toggle once per user and keep misleading totals server-side", async () => {
  await withApp(async (app, db) => {
    const first = await app.inject({ method: "POST", url: "/v1/posts/post-faithfulness/signals", headers: userHeader, payload: { signal: "helpful" } });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), { ok: true, helpful: 30, selectedSignal: "helpful" });

    const disagree = await app.inject({ method: "POST", url: "/v1/posts/post-faithfulness/signals", headers: userHeader, payload: { signal: "misleading" } });
    assert.deepEqual(disagree.json(), { ok: true, helpful: 29, selectedSignal: "misleading" });
    assert.equal(db.prepare("SELECT misleading FROM posts WHERE id = ?").get("post-faithfulness").misleading, 2);

    const cancelDisagree = await app.inject({ method: "POST", url: "/v1/posts/post-faithfulness/signals", headers: userHeader, payload: { signal: "misleading" } });
    assert.deepEqual(cancelDisagree.json(), { ok: true, helpful: 29, selectedSignal: null });
    assert.equal(db.prepare("SELECT misleading FROM posts WHERE id = ?").get("post-faithfulness").misleading, 1);

    const helpfulAgain = await app.inject({ method: "POST", url: "/v1/posts/post-faithfulness/signals", headers: userHeader, payload: { signal: "helpful" } });
    assert.deepEqual(helpfulAgain.json(), { ok: true, helpful: 30, selectedSignal: "helpful" });
    const cancelHelpful = await app.inject({ method: "POST", url: "/v1/posts/post-faithfulness/signals", headers: userHeader, payload: { signal: "helpful" } });
    assert.deepEqual(cancelHelpful.json(), { ok: true, helpful: 29, selectedSignal: null });
  });
});

test("a contextual draft is owner-bound, expires, and publishes only once", async () => {
  await withApp(async (app, db) => {
    const create = await app.inject({ method: "POST", url: "/v1/drafts/contextual", headers: userHeader, payload: { workId: "rag-neurips-2020", topicId: "rag-reliability", page: 7, excerpt: "A sufficiently long source excerpt.", anchorHash: "sha256:test-anchor", language: "zh-CN" } });
    assert.equal(create.statusCode, 201);
    const { draftId } = create.json();

    const save = await app.inject({ method: "PUT", url: `/v1/drafts/${draftId}`, headers: userHeader, payload: { body: "这是一条足够长的测试批注。", tags: ["可靠性"], citationEnabled: true } });
    assert.equal(save.statusCode, 200);
    const firstPublish = await app.inject({ method: "POST", url: "/v1/posts", headers: userHeader, payload: { draftId } });
    assert.equal(firstPublish.statusCode, 201);
    const mine = await app.inject({ method: "GET", url: "/v1/me/posts", headers: userHeader });
    assert.equal(mine.statusCode, 200);
    assert.equal(mine.json().posts.length, 2);
    const secondPublish = await app.inject({ method: "POST", url: "/v1/posts", headers: userHeader, payload: { draftId } });
    assert.equal(secondPublish.statusCode, 200);
    assert.equal(secondPublish.json().postId, firstPublish.json().postId);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM posts WHERE work_id = ?").get("rag-neurips-2020").count, 3);

    db.prepare("UPDATE drafts SET expires_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", draftId);
    const reopened = await app.inject({ method: "GET", url: `/v1/drafts/${draftId}`, headers: userHeader });
    assert.equal(reopened.statusCode, 200);
  });
});

test("editing turns a contextual draft into a persistent personal draft", async () => {
  await withApp(async (app, db) => {
    const create = await app.inject({ method: "POST", url: "/v1/drafts/contextual", headers: userHeader, payload: { workId: "rag-neurips-2020", topicId: "rag-reliability", page: 7, excerpt: "A sufficiently long source excerpt.", anchorHash: "sha256:saved-anchor", language: "zh-CN" } });
    const { draftId } = create.json();
    const topic = await app.inject({ method: "POST", url: "/v1/topics", headers: userHeader, payload: { name: "草稿选择主题", description: "用于验证上下文草稿可以改选研究主题。" } });
    const topicId = topic.json().topic.id;
    const save = await app.inject({ method: "PUT", url: `/v1/drafts/${draftId}`, headers: userHeader, payload: { body: "这份内容稍后再继续整理。", tags: [], citationEnabled: false, topicId } });
    assert.equal(save.statusCode, 200);

    db.prepare("UPDATE drafts SET expires_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", draftId);
    const reopened = await app.inject({ method: "GET", url: `/v1/drafts/${draftId}`, headers: userHeader });
    assert.equal(reopened.statusCode, 200);
    assert.equal(reopened.json().draft.body, "这份内容稍后再继续整理。");
    assert.equal(reopened.json().draft.topic_id, topicId);

    const list = await app.inject({ method: "GET", url: "/v1/me/drafts", headers: userHeader });
    assert.equal(list.json().drafts.length, 1);
    assert.equal(list.json().drafts[0].draft.id, draftId);

    const discard = await app.inject({ method: "DELETE", url: `/v1/drafts/${draftId}`, headers: userHeader });
    assert.equal(discard.statusCode, 200);
    const afterDiscard = await app.inject({ method: "GET", url: "/v1/me/drafts", headers: userHeader });
    assert.equal(afterDiscard.json().drafts.length, 0);
  });
});

test("a topic post can omit a citation and is searchable by up to five tags", async () => {
  await withApp(async (app) => {
    const topicResponse = await app.inject({ method: "POST", url: "/v1/topics", headers: userHeader, payload: { name: "新研究主题", description: "用于验证用户帖子与标签搜索的主题。" } });
    assert.equal(topicResponse.statusCode, 201);
    const topicId = topicResponse.json().topic.id;
    const create = await app.inject({ method: "POST", url: "/v1/drafts/contextual", headers: userHeader, payload: { topicId, language: "zh-CN" } });
    const { draftId } = create.json();
    const tooManyTags = await app.inject({ method: "PUT", url: `/v1/drafts/${draftId}`, headers: userHeader, payload: { body: "标签数量限制测试内容。", tags: ["一", "二", "三", "四", "五", "六"], citationEnabled: false } });
    assert.equal(tooManyTags.statusCode, 400);
    const save = await app.inject({ method: "PUT", url: `/v1/drafts/${draftId}`, headers: userHeader, payload: { body: "这是一条不附带原文引用的用户帖子。", tags: ["主题验证", "标签搜索"], citationEnabled: false } });
    assert.equal(save.statusCode, 200);
    const publish = await app.inject({ method: "POST", url: "/v1/posts", headers: userHeader, payload: { draftId } });
    assert.equal(publish.statusCode, 201);
    assert.notEqual(publish.json().postId, "demo-user");
    const topic = await app.inject({ method: "GET", url: `/v1/topics/${topicId}` });
    assert.equal(topic.json().posts[0].has_citation, false);
    assert.deepEqual(topic.json().posts[0].tags, ["主题验证", "标签搜索"]);
    const search = await app.inject({ method: "GET", url: "/v1/search?tag=标签搜索" });
    assert.equal(search.json().posts.length, 1);
  });
});

test("following a topic toggles and is listed for the current user", async () => {
  await withApp(async (app) => {
    const follow = await app.inject({ method: "POST", url: "/v1/topics/rag-reliability/follow", headers: userHeader });
    assert.deepEqual(follow.json(), { following: true, followerCount: 129 });

    const following = await app.inject({ method: "GET", url: "/v1/me/following", headers: userHeader });
    assert.equal(following.statusCode, 200);
    assert.equal(following.json().topics.length, 1);
    assert.equal(following.json().topics[0].id, "rag-reliability");
    assert.equal(following.json().topics[0].is_following, true);

    const unfollow = await app.inject({ method: "POST", url: "/v1/topics/rag-reliability/follow", headers: userHeader });
    assert.deepEqual(unfollow.json(), { following: false, followerCount: 128 });
    const afterUnfollow = await app.inject({ method: "GET", url: "/v1/me/following", headers: userHeader });
    assert.deepEqual(afterUnfollow.json().topics, []);
  });
});

test("saved topics and posts are returned with viewer save state and can be removed", async () => {
  await withApp(async (app) => {
    const saveTopic = await app.inject({ method: "POST", url: "/v1/topics/rag-reliability/save", headers: userHeader });
    assert.deepEqual(saveTopic.json(), { saved: true });
    const savePost = await app.inject({ method: "POST", url: "/v1/posts/post-faithfulness/save", headers: userHeader });
    assert.deepEqual(savePost.json(), { saved: true });

    const topic = await app.inject({ method: "GET", url: "/v1/topics/rag-reliability", headers: userHeader });
    assert.equal(topic.json().topic.is_saved, true);
    assert.equal(topic.json().posts.find((post) => post.id === "post-faithfulness").viewer_saved, true);

    const saved = await app.inject({ method: "GET", url: "/v1/me/saved", headers: userHeader });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().topics[0].id, "rag-reliability");
    assert.equal(saved.json().posts[0].id, "post-faithfulness");
    assert.equal(saved.json().posts[0].viewer_saved, true);

    const unsaveTopic = await app.inject({ method: "POST", url: "/v1/topics/rag-reliability/save", headers: userHeader });
    const unsavePost = await app.inject({ method: "POST", url: "/v1/posts/post-faithfulness/save", headers: userHeader });
    assert.deepEqual(unsaveTopic.json(), { saved: false });
    assert.deepEqual(unsavePost.json(), { saved: false });
    const afterUnsave = await app.inject({ method: "GET", url: "/v1/me/saved", headers: userHeader });
    assert.deepEqual(afterUnsave.json().topics, []);
    assert.deepEqual(afterUnsave.json().posts, []);
  });
});

test("post discussions can be created, listed, and saved", async () => {
  await withApp(async (app) => {
    const initial = await app.inject({ method: "GET", url: "/v1/posts/post-faithfulness/comments", headers: userHeader });
    assert.equal(initial.statusCode, 200);
    assert.equal(initial.json().comments.length, 1);

    const create = await app.inject({ method: "POST", url: "/v1/posts/post-faithfulness/comments", headers: userHeader, payload: { body: "这条讨论补充了证据链可见性的实际含义。" } });
    assert.equal(create.statusCode, 201);
    const { comment } = create.json();
    assert.equal(comment.author_name, "林·Li");

    const listed = await app.inject({ method: "GET", url: "/v1/posts/post-faithfulness/comments", headers: userHeader });
    assert.equal(listed.json().comments.length, 2);
    const save = await app.inject({ method: "POST", url: `/v1/comments/${comment.id}/save`, headers: userHeader, payload: {} });
    assert.deepEqual(save.json(), { saved: true });

    const saved = await app.inject({ method: "GET", url: "/v1/me/saved", headers: userHeader });
    assert.equal(saved.json().comments.length, 1);
    assert.equal(saved.json().comments[0].id, comment.id);
    assert.equal(saved.json().comments[0].viewer_saved, true);

    const unsave = await app.inject({ method: "POST", url: `/v1/comments/${comment.id}/save`, headers: userHeader, payload: {} });
    assert.deepEqual(unsave.json(), { saved: false });
  });
});

test("the demo paper mapping supports the contextual publish and feed loop", async () => {
  await withApp(async (app) => {
    const create = await app.inject({ method: "POST", url: "/v1/drafts/contextual", headers: userHeader, payload: { topicId: "rag-reliability", workId: "colbert-demo", page: 2, excerpt: "ColBERT uses contextualized late interaction", anchorHash: "sha256:colbert-late-interaction-2", language: "zh-CN" } });
    assert.equal(create.statusCode, 201);
    const { draftId } = create.json();
    const save = await app.inject({ method: "PUT", url: `/v1/drafts/${draftId}`, headers: userHeader, payload: { body: "回流链路测试帖子内容。", tags: [], citationEnabled: true } });
    assert.equal(save.statusCode, 200);
    const publish = await app.inject({ method: "POST", url: "/v1/posts", headers: userHeader, payload: { draftId } });
    assert.equal(publish.statusCode, 201);
    const feed = await app.inject({ method: "GET", url: "/v1/contextual-feed?workId=colbert-demo&anchorHash=sha256:colbert-late-interaction-2" });
    assert.equal(feed.statusCode, 200);
    assert.equal(feed.json().posts.some((post) => post.id === publish.json().postId), true);
  });
});
