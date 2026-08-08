import assert from "node:assert/strict";
import pg from "pg";
import { PostgresAccountLifecycleRepository } from "../src/accountLifecycleRepository.mjs";
import { migrateIntuecho, verifyIntuechoMigrations } from "../src/migrations.mjs";
import { PostgresAnnotationCommunityRepository } from "../src/postgresAnnotationCommunityRepository.mjs";
import { PostgresForumRepository } from "../src/postgresForumRepository.mjs";

const applicationUrl = process.env.INTUECHO_TEST_DATABASE_URL;
const migrationUrl = process.env.INTUECHO_TEST_MIGRATION_DATABASE_URL;
if (!applicationUrl || !migrationUrl) {
  throw new Error("INTUECHO_TEST_DATABASE_URL and INTUECHO_TEST_MIGRATION_DATABASE_URL are required");
}
const application = new URL(applicationUrl);
const migration = new URL(migrationUrl);
if (
  !new Set(["127.0.0.1", "::1", "localhost"]).has(application.hostname) ||
  migration.hostname !== application.hostname ||
  application.pathname !== migration.pathname ||
  !application.pathname.endsWith("_test") ||
  application.username === migration.username
) {
  throw new Error("intuecho_integration_database_forbidden");
}

const { Pool } = pg;
const pool = new Pool({ connectionString: applicationUrl, max: 4, ssl: false });
const migrationPool = new Pool({ connectionString: migrationUrl, max: 1, ssl: false });

try {
  const migrated = await migrateIntuecho(migrationPool, { applicationRole: application.username });
  const expectedMigrations = [
    "001_forum_core.sql",
    "002_account_lifecycle.sql",
    "003_desktop_community_integration.sql",
    "004_annotation_community.sql",
    "005_annotation_tag_appeal_governance.sql",
    "006_distinct_append_only_audit_errors.sql",
    "007_reply_rating_and_profile_names.sql",
    "008_account_deletion_annotation_history.sql",
    "009_detach_deleted_annotation_audit.sql"
  ];
  assert.equal(migrated.applied.every((name) => expectedMigrations.includes(name)), true);
  assert.deepEqual(await verifyIntuechoMigrations(pool), { count: 9, current: true });
  await migrationPool.query(`
    DO $$
    DECLARE tables text;
    BEGIN
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
        INTO tables
        FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> 'schema_migrations';
      IF tables IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
      END IF;
    END
    $$
  `);
  await assert.rejects(
    () => pool.query("CREATE TABLE application_role_must_not_create(id text)"),
    /permission denied/
  );

  const empty = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM topics) AS topics,
      (SELECT count(*)::int FROM works) AS works,
      (SELECT count(*)::int FROM posts) AS posts,
      (SELECT count(*)::int FROM drafts) AS drafts,
      (SELECT count(*)::int FROM feedback) AS feedback,
      (SELECT count(*)::int FROM annotations) AS annotations,
      (SELECT count(*)::int FROM annotation_tag_appeals) AS tag_appeals
  `);
  assert.deepEqual(empty.rows[0], {
    annotations: 0,
    drafts: 0,
    feedback: 0,
    posts: 0,
    tag_appeals: 0,
    topics: 0,
    works: 0
  });

  const repository = new PostgresForumRepository(pool);
  const topic = await repository.createTopic({
    description: "研究真实生产论坛的事务与身份边界。",
    name: "可靠研究协作"
  });
  await pool.query(`
    INSERT INTO works(id, topic_id, title, authors, year, venue, identifier, abstract)
    VALUES ('work-1', $1, 'Transactional Forums', 'Research Team', 2026, 'Systems',
            'doi:10.1000/forum', 'A production integration fixture inserted only by this test.')
  `, [topic.id]);

  const draft = await repository.createContextualDraft("user-1", {
    anchorHash: "anchor-hash-1",
    citationEnabled: true,
    excerpt: "Evidence from a real PostgreSQL transaction.",
    language: "zh-CN",
    page: 3,
    topicId: topic.id,
    workId: "work-1"
  });
  await repository.updateDraft(draft.draftId, "user-1", {
    body: "这是一条由正式 PostgreSQL 仓库发布的帖子。",
    citationEnabled: true,
    tags: ["事务", "审计", "事务"],
    title: "正式论坛边界"
  });
  const author = { id: "user-1", initials: "同名", name: "同名研究者" };
  const published = await repository.publishDraft(draft.draftId, author);
  assert.equal(published.replayed, false);
  assert.deepEqual(await repository.publishDraft(draft.draftId, author), {
    ...published,
    replayed: true
  });

  const posts = await repository.listPosts("user-1", { topicId: topic.id });
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].tags, ["事务", "审计"]);
  assert.equal(posts[0].viewer_is_author, true);
  assert.equal((await repository.search("PostgreSQL", "事务", undefined)).length, 1);
  await assert.rejects(
    () => repository.withdrawPost(published.postId, "user-2"),
    /NOT_POST_AUTHOR/
  );

  assert.deepEqual(await repository.toggleFollow(topic.id, "user-1"), {
    followerCount: 1,
    following: true
  });
  assert.deepEqual(await repository.toggleSave("topic", topic.id, "user-1"), { saved: true });
  assert.deepEqual(await repository.toggleSave("post", published.postId, "user-1"), { saved: true });
  assert.deepEqual(await repository.toggleSignal(published.postId, "user-1", "helpful"), {
    helpful: 1,
    ok: true,
    selectedSignal: "helpful"
  });
  const comment = await repository.createComment(published.postId, author, "补充一条可保存的评论。");
  assert.equal(comment.author_id, "user-1");
  assert.deepEqual(await repository.toggleSave("comment", comment.id, "user-1"), { saved: true });
  const saved = await repository.listSaved("user-1");
  assert.deepEqual(saved.topics.map((item) => item.id), [topic.id]);
  assert.deepEqual(saved.posts.map((item) => item.id), [published.postId]);
  assert.deepEqual(saved.comments.map((item) => item.id), [comment.id]);
  assert.deepEqual(await repository.listSaved("user-2"), { comments: [], posts: [], topics: [] });

  const withdrawn = await repository.moderatePost({
    action: "withdraw",
    adminId: "admin-1",
    postId: published.postId,
    reason: "生产集成测试治理动作",
    traceId: "trace-moderation-1"
  });
  assert.equal(withdrawn.action, "withdraw");
  assert.equal((await repository.listPosts(undefined, { topicId: topic.id })).length, 0);
  await repository.moderatePost({
    action: "restore",
    adminId: "admin-1",
    postId: published.postId,
    reason: "生产集成测试恢复动作",
    traceId: "trace-moderation-2"
  });
  assert.equal((await repository.listPosts(undefined, { topicId: topic.id })).length, 1);

  const audit = await pool.query(
    "SELECT action, admin_user_id, trace_id FROM moderation_audit ORDER BY created_at, id"
  );
  assert.deepEqual(audit.rows, [
    { action: "withdraw", admin_user_id: "admin-1", trace_id: "trace-moderation-1" },
    { action: "restore", admin_user_id: "admin-1", trace_id: "trace-moderation-2" }
  ]);
  await assert.rejects(
    () => pool.query("UPDATE moderation_audit SET reason = 'tampered'"),
    /permission denied|moderation_audit_is_append_only/
  );
  await assert.rejects(
    () => migrationPool.query("UPDATE moderation_audit SET reason = 'tampered'"),
    /moderation_audit_is_append_only/
  );
  await assert.rejects(
    () => pool.query(`
      INSERT INTO works(id, topic_id, title, authors, year, venue, abstract)
      VALUES ('cross-topic-work', 'missing-topic', 'Invalid', 'Nobody', 2026, 'None', '')
    `),
    /foreign key constraint/
  );

  const organizationAuthorizations = [];
  const organizationInvitations = [];
  const organizationModerations = [];
  const annotations = new PostgresAnnotationCommunityRepository(pool, {
    async authorizeOrganizationAccess(input) {
      organizationModerations.push(input);
      return { allowed: input.organizationId === "org-integration" && input.userId === "user-2", role: "admin" };
    },
    async authorizeOrganizationInvitation(input) {
      organizationInvitations.push(input);
      assert.equal(input.organizationId, "org-integration");
      assert.equal(input.inviterId, "user-1");
      assert.equal(input.invitedUserId, "user-2");
      return { invitationId: "orginvite-integration", organizationRevision: 8 };
    },
    async authorizeOrganizationVisibility(input) {
      organizationAuthorizations.push(input);
      return input.organizationId === "org-integration" && input.userId === "user-1";
    },
    async listOrganizations(userId) {
      return userId === "user-2" ? [{ name: "证据研究组织", organizationId: "org-integration", role: "admin" }] : [];
    }
  });
  const userOne = { id: "user-1", initials: "同名", name: "同名研究者" };
  const userTwo = { id: "user-2", initials: "证据", name: "证据复核者" };
  assert.deepEqual(await annotations.updateProfile(userOne.id, {
    educationStage: "博士研究生",
    institutions: [{ name: "证据研究院" }]
  }), {
    educationStage: "博士研究生",
    institutions: [{ name: "证据研究院" }],
    revision: 1
  });
  const literature = {
    identity: {
      id: "doi:10.1000/annotation-integration",
      kind: "doi",
      source: "metadata",
      value: "10.1000/annotation-integration"
    },
    metadata: {
      authors: ["Evidence Team"],
      documentType: "journal_article",
      title: "Annotation Evidence Boundaries",
      year: 2026
    }
  };
  const wholeDocument = { kind: "whole_document", literature };
  const sourcePassage = {
    anchorHash: "sha256:postgres-source-evidence",
    excerpt: "PostgreSQL preserves the cited source passage.",
    kind: "source_passage",
    literature,
    page: 4,
    rects: []
  };
  const derivedPassage = {
    derivedContent: {
      artifactId: "artifact-postgres-integration",
      excerpt: "薄读生成内容必须携带原始文献证据。",
      nodeId: "node-evidence",
      version: "thin-reading-v1"
    },
    evidence: [{
      anchorHash: sourcePassage.anchorHash,
      excerpt: sourcePassage.excerpt,
      literature,
      page: sourcePassage.page,
      rects: []
    }],
    kind: "derived_passage",
    literature
  };
  const sharedBody = "正式 PostgreSQL 批注保存薄读证据、事务边界与语义标签。";
  const semanticSeed = await annotations.createAnnotation(userTwo, {
    body: sharedBody,
    shareToPlaza: true,
    tags: ["证据分类"],
    targets: [wholeDocument],
    visibility: "public"
  });
  const publicAnnotation = await annotations.createAnnotation(userOne, {
    body: sharedBody,
    shareToPlaza: true,
    tags: ["生产验证"],
    targets: [wholeDocument, derivedPassage],
    visibility: "public"
  });
  assert.equal(publicAnnotation.targets.length, 2);
  assert.equal(publicAnnotation.targets.find((target) => target.kind === "derived_passage").evidence.length, 1);
  assert.deepEqual(publicAnnotation.author.profile, {
    educationStage: "博士研究生",
    institutions: [{ name: "证据研究院" }]
  });
  assert.equal(publicAnnotation.tags.some((tag) =>
    tag.name === "证据分类" && tag.origin === "platform" && tag.state === "active"
  ), true);
  await annotations.updateAnnotation(publicAnnotation.id, userOne, {
    body: `${sharedBody} 编辑后保留历史版本。`
  });

  const authoredPublicReply = await annotations.createReply(publicAnnotation.id, userOne, {
    body: "公开回复在账号注销时保留正文并去除身份信息。",
    shareToPlaza: false,
    tags: [],
    targets: []
  });
  await annotations.updateReply(authoredPublicReply.reply.id, userOne, {
    body: "公开回复编辑后仍需保留匿名历史。"
  });

  const publicReply = await annotations.createReply(publicAnnotation.id, userTwo, {
    body: "回复原批注，并以自己的文献字句同步进入广场。",
    shareToPlaza: true,
    tags: ["回复证据"],
    targets: [sourcePassage]
  });
  assert.equal(publicReply.reply.parentAnnotationId, publicAnnotation.id);
  assert.equal(publicReply.reply.derivedAnnotationId, publicReply.annotation.id);
  assert.deepEqual((await annotations.replies(publicAnnotation.id, userOne)).map((item) => item.id), [
    authoredPublicReply.reply.id,
    publicReply.reply.id
  ]);
  const plaza = await annotations.plaza(userOne, {
    documentType: "journal_article",
    educationStage: "博士研究生",
    institution: "证据研究院",
    literatureIdentityKind: "doi",
    literatureIdentityValue: "10.1000/annotation-integration",
    query: "/证据",
    sort: "recommended"
  });
  assert.equal(plaza.some((item) => item.id === publicAnnotation.id), true);

  assert.deepEqual(await annotations.toggleSave(publicAnnotation.id, userOne), { saved: true });
  assert.deepEqual(await annotations.rateAnnotation(semanticSeed.id, userOne, 5), {
    ratingAverage: 5,
    ratingCount: 1,
    viewerRating: 5
  });
  const handoff = await annotations.createHandoff(userOne.id, {
    body: "待发布批注",
    shareToPlaza: true,
    tags: [],
    targets: [wholeDocument],
    visibility: "public"
  });
  assert.match(handoff.handoffId, /^handoff_/);
  const synced = await annotations.syncDesktopAnnotations(userOne, [{
    annotationId: "desktop-annotation-1",
    body: "来自桌面端同步的公开批注。",
    createdAt: "2026-08-07T01:00:00.000Z",
    queueKey: "desktop-queue-1",
    targets: [sourcePassage],
    updatedAt: "2026-08-07T01:05:00.000Z"
  }]);
  assert.equal(synced[0].status, "synced");

  const privateRoot = await annotations.createAnnotation(userOne, {
    body: "账号删除时必须移除的私有批注。",
    shareToPlaza: false,
    tags: [],
    targets: [wholeDocument],
    visibility: "private"
  });
  await annotations.updateAnnotation(privateRoot.id, userOne, {
    body: "账号删除时必须移除的已编辑私有批注。"
  });
  await assert.rejects(
    () => pool.query(`
      INSERT INTO annotations(
        id, parent_annotation_id, body, author_id, author_name, author_initials,
        author_profile_snapshot, visibility, share_to_plaza
      ) VALUES (
        'invalid-public-private-reply', $1, 'Invalid visibility', 'user-2',
        'Invalid Author', 'IA', '{}'::jsonb, 'public', false
      )
    `, [privateRoot.id]),
    /reply_visibility_mismatch/
  );
  const privateReply = await annotations.createReply(privateRoot.id, userOne, {
    body: "账号删除必须从子节点开始移除的私有回复。",
    shareToPlaza: false,
    tags: [],
    targets: []
  });
  await annotations.updateReply(privateReply.reply.id, userOne, {
    body: "账号删除必须同时移除私有回复的历史版本。"
  });
  await assert.rejects(
    () => migrationPool.query("UPDATE annotation_versions SET body = 'tampered' WHERE annotation_id = $1", [publicAnnotation.id]),
    /annotation_versions_are_append_only/
  );
  await assert.rejects(
    () => migrationPool.query("DELETE FROM annotation_reply_versions WHERE reply_id = $1", [authoredPublicReply.reply.id]),
    /annotation_reply_versions_are_append_only/
  );
  const organizationAnnotation = await annotations.createAnnotation(userOne, {
    body: "只对指定组织可见的批注。",
    organizationId: "org-integration",
    shareToPlaza: false,
    tags: [],
    targets: [wholeDocument],
    visibility: "organization"
  });
  assert.deepEqual(organizationAuthorizations, [{
    organizationId: "org-integration",
    userId: "user-1"
  }]);
  await annotations.moderateOrganizationAnnotation({ action: "withdraw", annotationId: organizationAnnotation.id, reason: "组织管理员执行 PostgreSQL 治理集成验证。", traceId: "trace-org-moderate-1", userId: userTwo.id });
  const organizationFeed = await annotations.organizationFeed(userTwo);
  assert.equal(organizationFeed[0].annotations[0].id, organizationAnnotation.id);
  assert.equal(organizationFeed[0].annotations[0].viewerCanModerate, true);
  assert.equal(organizationFeed[0].annotations[0].withdrawnAt !== null, true);
  await annotations.moderateOrganizationAnnotation({ action: "restore", annotationId: organizationAnnotation.id, reason: "组织管理员恢复 PostgreSQL 治理集成验证内容。", traceId: "trace-org-moderate-2", userId: userTwo.id });
  assert.equal(organizationModerations.length, 2);

  assert.deepEqual(await annotations.toggleFollow(userOne.id, userTwo.id), {
    following: true,
    mutual: false
  });
  assert.deepEqual(await annotations.toggleFollow(userTwo.id, userOne.id), {
    following: true,
    mutual: true
  });
  const conversation = await annotations.createConversation(userOne.id, userTwo.id);
  const invitationMessage = await annotations.sendMessage(conversation.id, userOne.id, {
    body: "加入证据研究组织",
    invitation: { organizationId: "org-integration", role: "member" },
    kind: "organization_invitation"
  });
  assert.equal(invitationMessage.invitation.invitationId, "orginvite-integration");
  assert.equal(organizationInvitations.length, 1);

  const appeal = await annotations.appealPlatformTag(
    publicAnnotation.id,
    "证据分类",
    userOne.id,
    "平台标签未准确描述这条批注的主要语义。"
  );
  assert.equal((await annotations.listTagAppeals("pending"))[0].appealId, appeal.appealId);
  const resolvedAppeal = await annotations.resolveTagAppeal(appeal.appealId, "admin-1", {
    decision: "accepted",
    reason: "复核文献证据后确认平台语义标签分类错误。"
  }, "trace-tag-appeal-1");
  assert.equal(resolvedAppeal.decision, "accepted");
  assert.equal((await annotations.listTagAppeals("accepted"))[0].appealId, appeal.appealId);

  await annotations.moderateAnnotation({
    action: "withdraw",
    adminId: "admin-1",
    annotationId: publicAnnotation.id,
    reason: "正式 PostgreSQL 集成测试治理动作",
    traceId: "trace-annotation-moderation-1"
  });
  await annotations.moderateAnnotation({
    action: "restore",
    adminId: "admin-1",
    annotationId: publicAnnotation.id,
    reason: "正式 PostgreSQL 集成测试恢复动作",
    traceId: "trace-annotation-moderation-2"
  });
  assert.equal((await annotations.listAdminAnnotations()).some((item) =>
    item.id === publicAnnotation.id && item.withdrawnAt === null
  ), true);
  await assert.rejects(
    () => migrationPool.query("UPDATE annotation_moderation_audit SET reason = 'tampered'"),
    /annotation_moderation_audit_is_append_only/
  );
  await assert.rejects(
    () => migrationPool.query("DELETE FROM annotation_tag_appeal_audit"),
    /annotation_tag_appeal_audit_is_append_only/
  );
  await assert.rejects(
    () => migrationPool.query(`
      INSERT INTO annotation_moderation_audit(
        id, annotation_id, action, reason, admin_user_id, trace_id
      ) VALUES (
        'invalid-missing-annotation-audit', 'missing-annotation', 'withdraw',
        'Missing annotation reference must fail.', 'admin-1', 'trace-invalid-audit'
      )
    `),
    /annotation_moderation_audit_annotation_not_found/
  );

  const privateDraft = await repository.createContextualDraft("user-1", {
    anchorHash: "anchor-hash-private",
    citationEnabled: true,
    excerpt: "Private draft evidence removed during account deletion.",
    language: "zh-CN",
    page: 4,
    topicId: topic.id,
    workId: "work-1"
  });
  assert.match(privateDraft.draftId, /^draft_/);
  await repository.createFeedback({
    context: "account lifecycle integration",
    kind: "experience",
    message: "This private attribution must be detached during account deletion."
  }, "user-1");
  const publicBeforeDeletion = await pool.query(`
    SELECT post.body AS post_body, comment.body AS comment_body
      FROM posts post
      JOIN comments comment ON comment.post_id = post.id
     WHERE post.id = $1 AND comment.id = $2
  `, [published.postId, comment.id]);
  const accountLifecycle = new PostgresAccountLifecycleRepository(pool);
  const accountDeletionInput = {
    idempotencyKey: "delete-user-1-integration",
    reason: "Approved forum account deletion integration",
    requestedBy: "admin-1",
    subjectId: "user-1",
    traceId: "trace-account-delete-1"
  };
  const accountDeletion = await accountLifecycle.deleteAccount(accountDeletionInput);
  assert.equal(accountDeletion.replayed, false);
  assert.deepEqual(accountDeletion.result, {
    anonymizedAnnotations: 2,
    anonymizedAnnotationVersions: 1,
    anonymizedComments: 1,
    anonymizedPosts: 1,
    anonymizedReplies: 1,
    anonymizedReplyVersions: 1,
    deletedAnnotationHandoffs: 1,
    deletedAnnotationRatings: 1,
    deletedAnnotationSaves: 1,
    deletedAnnotationSignals: 0,
    deletedAnnotationSyncs: 1,
    deletedCommunityAnnotations: 0,
    deletedCommentSaves: 1,
    deletedDesktopDraftHandoffs: 0,
    deletedDrafts: 2,
    deletedDirectConversations: 1,
    deletedNonPublicAnnotations: 2,
    deletedNonPublicReplies: 0,
    deletedPostSaves: 1,
    deletedProfile: 1,
    deletedSignals: 1,
    deletedTagAppeals: 1,
    deletedTopicFollows: 1,
    deletedTopicSaves: 1,
    deletedUserFollows: 2,
    detachedFeedback: 1
  });
  const privateAfterDeletion = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM drafts WHERE owner_id = 'user-1') AS drafts,
      (SELECT count(*)::int FROM topic_follows WHERE user_id = 'user-1') AS follows,
      (SELECT count(*)::int FROM topic_saves WHERE user_id = 'user-1') AS topic_saves,
      (SELECT count(*)::int FROM post_saves WHERE user_id = 'user-1') AS post_saves,
      (SELECT count(*)::int FROM comment_saves WHERE user_id = 'user-1') AS comment_saves,
      (SELECT count(*)::int FROM post_signals WHERE user_id = 'user-1') AS signals,
      (SELECT count(*)::int FROM feedback WHERE submitted_by = 'user-1') AS attributed_feedback,
      (SELECT count(*)::int FROM desktop_annotation_handoffs WHERE owner_id = 'user-1') AS annotation_handoffs,
      (SELECT count(*)::int FROM desktop_annotation_syncs WHERE owner_id = 'user-1') AS annotation_syncs,
      (SELECT count(*)::int FROM annotation_saves WHERE user_id = 'user-1') AS annotation_saves,
      (SELECT count(*)::int FROM annotation_signals WHERE user_id = 'user-1') AS annotation_signals,
      (SELECT count(*)::int FROM annotation_ratings WHERE user_id = 'user-1') AS annotation_ratings,
      (SELECT count(*)::int FROM annotation_tag_appeals WHERE submitted_by = 'user-1') AS tag_appeals,
      (SELECT count(*)::int FROM user_follows WHERE follower_id = 'user-1' OR followed_id = 'user-1') AS user_follows,
      (SELECT count(*)::int FROM direct_conversations WHERE first_user_id = 'user-1' OR second_user_id = 'user-1') AS conversations,
      (SELECT count(*)::int FROM community_user_profiles WHERE user_id = 'user-1') AS profiles,
      (SELECT count(*)::int FROM annotations WHERE author_id = 'user-1') AS attributed_annotations
  `);
  assert.deepEqual(privateAfterDeletion.rows[0], {
    annotation_handoffs: 0,
    annotation_ratings: 0,
    annotation_saves: 0,
    annotation_signals: 0,
    annotation_syncs: 0,
    attributed_feedback: 0,
    attributed_annotations: 0,
    comment_saves: 0,
    conversations: 0,
    drafts: 0,
    follows: 0,
    post_saves: 0,
    profiles: 0,
    signals: 0,
    tag_appeals: 0,
    topic_saves: 0,
    user_follows: 0
  });
  const annotationHistoryAfterDeletion = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM annotation_versions WHERE annotation_id = $1) AS private_annotation_versions,
      (SELECT count(*)::int FROM annotation_reply_versions WHERE reply_id = $2) AS private_reply_versions,
      (SELECT count(*)::int FROM annotation_versions WHERE changed_by = 'user-1') AS attributed_annotation_versions,
      (SELECT count(*)::int FROM annotation_reply_versions WHERE changed_by = 'user-1') AS attributed_reply_versions,
      (SELECT count(*)::int FROM annotation_versions WHERE annotation_id = $3 AND changed_by LIKE 'deleted:%' AND author_profile_snapshot = '{"educationStage":null,"institutions":[]}'::jsonb) AS anonymized_annotation_versions,
      (SELECT count(*)::int FROM annotation_reply_versions WHERE reply_id = $4 AND changed_by LIKE 'deleted:%' AND author_profile_snapshot = '{"educationStage":null,"institutions":[]}'::jsonb) AS anonymized_reply_versions
  `, [privateRoot.id, privateReply.reply.id, publicAnnotation.id, authoredPublicReply.reply.id]);
  assert.deepEqual(annotationHistoryAfterDeletion.rows[0], {
    anonymized_annotation_versions: 1,
    anonymized_reply_versions: 1,
    attributed_annotation_versions: 0,
    attributed_reply_versions: 0,
    private_annotation_versions: 0,
    private_reply_versions: 0
  });
  const publicAfterDeletion = await pool.query(`
    SELECT
      post.author_id AS post_author_id,
      post.author_name AS post_author_name,
      post.body AS post_body,
      post.helpful,
      post.misleading,
      comment.author_id AS comment_author_id,
      comment.author_name AS comment_author_name,
      comment.body AS comment_body,
      topic.follower_count
    FROM posts post
    JOIN comments comment ON comment.post_id = post.id
    JOIN topics topic ON topic.id = post.topic_id
    WHERE post.id = $1 AND comment.id = $2
  `, [published.postId, comment.id]);
  assert.equal(publicAfterDeletion.rows[0].post_body, publicBeforeDeletion.rows[0].post_body);
  assert.equal(publicAfterDeletion.rows[0].comment_body, publicBeforeDeletion.rows[0].comment_body);
  assert.equal(publicAfterDeletion.rows[0].post_author_name, "已注销用户");
  assert.equal(publicAfterDeletion.rows[0].comment_author_name, "已注销用户");
  assert.equal(publicAfterDeletion.rows[0].post_author_id, publicAfterDeletion.rows[0].comment_author_id);
  assert.match(publicAfterDeletion.rows[0].post_author_id, /^deleted:/);
  assert.equal(publicAfterDeletion.rows[0].helpful, "0");
  assert.equal(publicAfterDeletion.rows[0].misleading, "0");
  assert.equal(publicAfterDeletion.rows[0].follower_count, "0");
  const annotationAfterDeletion = await pool.query(`
    SELECT author_id, author_name, author_initials, author_profile_snapshot
      FROM annotations
     WHERE id = $1
  `, [publicAnnotation.id]);
  assert.match(annotationAfterDeletion.rows[0].author_id, /^deleted:/);
  assert.equal(annotationAfterDeletion.rows[0].author_name, "已注销用户");
  assert.equal(annotationAfterDeletion.rows[0].author_initials, "已");
  assert.deepEqual(annotationAfterDeletion.rows[0].author_profile_snapshot, {
    educationStage: null,
    institutions: []
  });
  assert.deepEqual(await accountLifecycle.deleteAccount(accountDeletionInput), {
    ...accountDeletion,
    replayed: true
  });
  await assert.rejects(
    () => accountLifecycle.deleteAccount({
      ...accountDeletionInput,
      idempotencyKey: "delete-user-1-integration-new-key"
    }),
    /IDEMPOTENCY_KEY_REUSED/
  );
  const lifecycleAudit = await pool.query(`
    SELECT event_id, action, subject_id, requested_by, trace_id
      FROM account_lifecycle_audit
     WHERE operation_id = $1
  `, [accountDeletionInput.idempotencyKey]);
  assert.deepEqual(lifecycleAudit.rows.map((row) => ({
    action: row.action,
    requestedBy: row.requested_by,
    subjectId: row.subject_id,
    traceId: row.trace_id
  })), [{
    action: "forum_account_data_deleted",
    requestedBy: "admin-1",
    subjectId: "user-1",
    traceId: "trace-account-delete-1"
  }]);
  await assert.rejects(
    () => migrationPool.query(
      "UPDATE account_lifecycle_audit SET reason = 'tampered' WHERE event_id = $1",
      [lifecycleAudit.rows[0].event_id]
    ),
    /account_lifecycle_audit_is_append_only/
  );
  await assert.rejects(
    () => migrationPool.query(
      "DELETE FROM account_lifecycle_audit WHERE event_id = $1",
      [lifecycleAudit.rows[0].event_id]
    ),
    /account_lifecycle_audit_is_append_only/
  );

  const counts = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM posts) AS posts,
      (SELECT count(*)::int FROM comments) AS comments,
      (SELECT count(*)::int FROM moderation_audit) AS legacy_audit,
      (SELECT count(*)::int FROM annotations) AS annotations,
      (SELECT count(*)::int FROM annotation_moderation_audit) AS annotation_audit,
      (SELECT count(*)::int FROM annotation_tag_appeal_audit) AS tag_appeal_audit
  `);
  process.stdout.write(`${JSON.stringify({
    ...counts.rows[0],
    accountDeletion: true,
    database: application.pathname.slice(1),
    migrations: migrated.applied.length,
    verified: true
  })}\n`);
} finally {
  await pool.end();
  await migrationPool.end();
}
