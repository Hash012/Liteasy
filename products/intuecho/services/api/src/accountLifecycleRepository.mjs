import { createHash, randomUUID } from "node:crypto";
import { withTransaction } from "./postgres.mjs";
import { ForumRepositoryError } from "./postgresForumRepository.mjs";

function identifier(value, code) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) {
    throw new ForumRepositoryError(code);
  }
  return value;
}

function reasonText(value) {
  if (typeof value !== "string") throw new ForumRepositoryError("INVALID_ACCOUNT_LIFECYCLE");
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < 8 || normalized.length > 1000) {
    throw new ForumRepositoryError("INVALID_ACCOUNT_LIFECYCLE");
  }
  return normalized;
}

function requestHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function publicResult(row, replayed = false) {
  return {
    completedAt: row.completed_at.toISOString(),
    operationId: row.operation_id,
    replayed,
    result: row.result,
    subjectId: row.subject_id
  };
}

export class PostgresAccountLifecycleRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async deleteAccount(input) {
    const subjectId = identifier(input.subjectId, "ACCOUNT_SUBJECT_INVALID");
    const requestedBy = identifier(input.requestedBy, "ADMIN_ID_INVALID");
    const operationId = identifier(input.idempotencyKey, "IDEMPOTENCY_KEY_INVALID");
    const traceId = identifier(input.traceId, "TRACE_ID_INVALID");
    const reason = reasonText(input.reason);
    const hash = requestHash({ operationId, reason, requestedBy, subjectId });

    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `intuecho-account-deletion:${subjectId}`
      ]);
      const prior = await client.query(
        "SELECT * FROM account_deletion_jobs WHERE subject_id = $1 OR operation_id = $2",
        [subjectId, operationId]
      );
      if (prior.rows[0]) {
        if (
          prior.rows[0].subject_id !== subjectId ||
          prior.rows[0].operation_id !== operationId
        ) {
          throw new ForumRepositoryError("IDEMPOTENCY_KEY_REUSED", 409);
        }
        if (prior.rows[0].request_hash !== hash) {
          throw new ForumRepositoryError("IDEMPOTENCY_KEY_REUSED", 409);
        }
        return publicResult(prior.rows[0], true);
      }

      const anonymizedAuthorId = `deleted:${randomUUID()}`;
      const handoffs = await client.query("DELETE FROM desktop_draft_handoffs WHERE owner_id = $1", [subjectId]);
      const annotationHandoffs = await client.query("DELETE FROM desktop_annotation_handoffs WHERE owner_id = $1", [subjectId]);
      const annotationSyncs = await client.query("DELETE FROM desktop_annotation_syncs WHERE owner_id = $1", [subjectId]);
      const annotationPublications = await client.query("DELETE FROM desktop_annotation_publications WHERE owner_id = $1", [subjectId]);
      const annotations = await client.query("DELETE FROM community_annotations WHERE owner_id = $1", [subjectId]);
      const drafts = await client.query("DELETE FROM drafts WHERE owner_id = $1", [subjectId]);
      // Appeals reference platform tags with ON DELETE RESTRICT, so detach them before
      // deleting the subject's non-public annotation tree.
      const tagAppeals = await client.query("DELETE FROM annotation_tag_appeals WHERE submitted_by = $1", [subjectId]);
      const privateAnnotationTree = await client.query(`
        WITH RECURSIVE deletion_tree(id, depth, path) AS (
          SELECT id, 0, ARRAY[id] FROM annotations
           WHERE author_id = $1 AND visibility <> 'public'
          UNION
          SELECT derived.id, 0, ARRAY[derived.id]
            FROM annotation_replies reply
            JOIN annotations derived ON derived.id = reply.derived_annotation_id
           WHERE reply.author_id = $1
             AND reply.visibility <> 'public'
             AND derived.visibility <> 'public'
          UNION ALL
          SELECT descendant.id, parent.depth + 1, parent.path || descendant.id
            FROM deletion_tree parent
            JOIN LATERAL (
              SELECT child.id
                FROM annotations child
               WHERE child.parent_annotation_id = parent.id
                 AND child.visibility <> 'public'
              UNION
              SELECT derived.id
                FROM annotation_replies reply
                JOIN annotations derived ON derived.id = reply.derived_annotation_id
               WHERE reply.parent_annotation_id = parent.id
                 AND derived.visibility <> 'public'
            ) descendant ON true
           WHERE NOT descendant.id = ANY(parent.path)
        )
        SELECT id, max(depth)::integer AS depth
          FROM deletion_tree
         GROUP BY id
         ORDER BY depth DESC, id
      `, [subjectId]);
      let deletedNonPublicReplies = 0;
      for (const annotation of privateAnnotationTree.rows) {
        const childReplies = await client.query("DELETE FROM annotation_replies WHERE parent_annotation_id = $1 RETURNING visibility", [annotation.id]);
        deletedNonPublicReplies += childReplies.rows.filter((reply) => reply.visibility !== "public").length;
        await client.query("DELETE FROM annotations WHERE id = $1", [annotation.id]);
      }
      const annotationSignalTargets = await client.query("SELECT annotation_id FROM annotation_signals WHERE user_id = $1", [subjectId]);
      const annotationSignals = await client.query("DELETE FROM annotation_signals WHERE user_id = $1", [subjectId]);
      if (annotationSignalTargets.rows.length > 0) {
        await client.query(`UPDATE annotations SET helpful = (SELECT count(*) FROM annotation_signals WHERE annotation_id = annotations.id AND signal = 'helpful'), misleading = (SELECT count(*) FROM annotation_signals WHERE annotation_id = annotations.id AND signal = 'misleading') WHERE id = ANY($1::text[])`, [annotationSignalTargets.rows.map((row) => row.annotation_id)]);
      }
      const annotationSaves = await client.query("DELETE FROM annotation_saves WHERE user_id = $1", [subjectId]);
      const annotationRatings = await client.query("DELETE FROM annotation_ratings WHERE user_id = $1", [subjectId]);
      const privateReplies = await client.query("DELETE FROM annotation_replies WHERE author_id = $1 AND visibility <> 'public'", [subjectId]);
      const publicReplies = await client.query(`UPDATE annotation_replies SET author_id = $2, author_name = '已注销用户', author_initials = '已', author_profile_snapshot = '{"educationStage":null,"institutions":[]}'::jsonb, revision = revision + 1, updated_at = now() WHERE author_id = $1 AND visibility = 'public'`, [subjectId, anonymizedAuthorId]);
      const publicReplyVersions = await client.query(`UPDATE annotation_reply_versions SET changed_by = $2, author_profile_snapshot = '{"educationStage":null,"institutions":[]}'::jsonb WHERE changed_by = $1 AND reply_id IN (SELECT id FROM annotation_replies WHERE author_id = $2)`, [subjectId, anonymizedAuthorId]);
      const userFollows = await client.query("DELETE FROM user_follows WHERE follower_id = $1 OR followed_id = $1", [subjectId]);
      const conversations = await client.query("DELETE FROM direct_conversations WHERE first_user_id = $1 OR second_user_id = $1", [subjectId]);
      const profile = await client.query("DELETE FROM community_user_profiles WHERE user_id = $1", [subjectId]);
      const follows = await client.query(`
        WITH removed AS (
          DELETE FROM topic_follows WHERE user_id = $1 RETURNING topic_id
        )
        UPDATE topics
           SET follower_count = (
             SELECT count(*) FROM topic_follows
              WHERE topic_id = topics.id AND user_id <> $1
           )
         WHERE id IN (SELECT topic_id FROM removed)
         RETURNING id
      `, [subjectId]);
      const signals = await client.query(`
        WITH removed AS (
          DELETE FROM post_signals WHERE user_id = $1 RETURNING post_id
        )
        UPDATE posts
           SET helpful = (
                 SELECT count(*) FROM post_signals
                  WHERE post_id = posts.id AND user_id <> $1 AND signal = 'helpful'
               ),
               misleading = (
                 SELECT count(*) FROM post_signals
                  WHERE post_id = posts.id AND user_id <> $1 AND signal = 'misleading'
               )
         WHERE id IN (SELECT post_id FROM removed)
         RETURNING id
      `, [subjectId]);
      const topicSaves = await client.query("DELETE FROM topic_saves WHERE user_id = $1", [subjectId]);
      const postSaves = await client.query("DELETE FROM post_saves WHERE user_id = $1", [subjectId]);
      const commentSaves = await client.query("DELETE FROM comment_saves WHERE user_id = $1", [subjectId]);
      const feedback = await client.query(
        "UPDATE feedback SET submitted_by = NULL WHERE submitted_by = $1",
        [subjectId]
      );
      const posts = await client.query(`
        UPDATE posts
           SET author_id = $2, author_name = '已注销用户', author_initials = '已'
         WHERE author_id = $1
      `, [subjectId, anonymizedAuthorId]);
      const comments = await client.query(`
        UPDATE comments
           SET author_id = $2, author_name = '已注销用户', author_initials = '已'
         WHERE author_id = $1
      `, [subjectId, anonymizedAuthorId]);
      const publicAnnotations = await client.query(`
        UPDATE annotations
           SET author_id = $2,
               author_name = '已注销用户',
               author_initials = '已',
               author_profile_snapshot = '{"educationStage":null,"institutions":[]}'::jsonb,
               updated_at = now(),
               revision = revision + 1
         WHERE author_id = $1 AND visibility = 'public'
      `, [subjectId, anonymizedAuthorId]);
      const publicAnnotationVersions = await client.query(`UPDATE annotation_versions SET changed_by = $2, author_profile_snapshot = '{"educationStage":null,"institutions":[]}'::jsonb WHERE changed_by = $1 AND annotation_id IN (SELECT id FROM annotations WHERE author_id = $2)`, [subjectId, anonymizedAuthorId]);
      const result = {
        anonymizedAnnotations: publicAnnotations.rowCount,
        anonymizedAnnotationVersions: publicAnnotationVersions.rowCount,
        anonymizedReplies: publicReplies.rowCount,
        anonymizedReplyVersions: publicReplyVersions.rowCount,
        anonymizedComments: comments.rowCount,
        anonymizedPosts: posts.rowCount,
        deletedAnnotationHandoffs: annotationHandoffs.rowCount,
        deletedAnnotationPublications: annotationPublications.rowCount,
        deletedAnnotationSaves: annotationSaves.rowCount,
        deletedAnnotationRatings: annotationRatings.rowCount,
        deletedAnnotationSignals: annotationSignals.rowCount,
        deletedAnnotationSyncs: annotationSyncs.rowCount,
        deletedCommunityAnnotations: annotations.rowCount,
        deletedCommentSaves: commentSaves.rowCount,
        deletedDesktopDraftHandoffs: handoffs.rowCount,
        deletedDrafts: drafts.rowCount,
        deletedDirectConversations: conversations.rowCount,
        deletedNonPublicAnnotations: privateAnnotationTree.rows.length,
        deletedNonPublicReplies: deletedNonPublicReplies + privateReplies.rowCount,
        deletedPostSaves: postSaves.rowCount,
        deletedProfile: profile.rowCount,
        deletedSignals: signals.rowCount,
        deletedTopicFollows: follows.rowCount,
        deletedTopicSaves: topicSaves.rowCount,
        deletedTagAppeals: tagAppeals.rowCount,
        deletedUserFollows: userFollows.rowCount,
        detachedFeedback: feedback.rowCount
      };
      const completed = await client.query(`
        INSERT INTO account_deletion_jobs(
          subject_id, operation_id, anonymized_author_id, requested_by, reason, request_hash, result
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        RETURNING *
      `, [
        subjectId, operationId, anonymizedAuthorId, requestedBy, reason, hash, JSON.stringify(result)
      ]);
      await client.query(`
        INSERT INTO account_lifecycle_audit(
          event_id, operation_id, action, subject_id, requested_by, reason, trace_id, detail
        ) VALUES ($1, $2, 'forum_account_data_deleted', $3, $4, $5, $6, $7::jsonb)
      `, [
        `accountaudit_${randomUUID()}`, operationId, subjectId, requestedBy, reason, traceId,
        JSON.stringify(result)
      ]);
      return publicResult(completed.rows[0]);
    });
  }
}
