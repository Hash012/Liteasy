import { randomUUID } from "node:crypto";
import { AnnotationCommunityError } from "./annotationCommunitySqlite.mjs";

const statement = (sql, values = []) => ({ sql, values });
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const failure = (code, status = 400) => new AnnotationCommunityError(code, status);
const tableNames = (sqlite) => ({ annotations: sqlite ? "annotations_v2" : "annotations", targets: sqlite ? "annotation_targets_v2" : "annotation_targets", replies: sqlite ? "annotation_replies_v2" : "annotation_replies", appeals: sqlite ? "annotation_tag_appeals_v2" : "annotation_tag_appeals", moderation: sqlite ? "annotation_moderation_audit_v2" : "annotation_moderation_audit" });

export function initializeSqliteCommunityGovernance(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS community_preferences (user_id TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, subscribed INTEGER NOT NULL, muted INTEGER NOT NULL, blocked INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, target_kind, target_id));
    CREATE TABLE IF NOT EXISTS community_notification_events (id TEXT PRIMARY KEY, annotation_id TEXT NOT NULL, reply_id TEXT, actor_id TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'reply', source_id TEXT NOT NULL, target_subject_id TEXT);
    CREATE TABLE IF NOT EXISTS community_notifications (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES community_notification_events(id) ON DELETE CASCADE, recipient_id TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL, UNIQUE(event_id, recipient_id));
    CREATE INDEX IF NOT EXISTS community_notifications_recipient_idx ON community_notifications(recipient_id, created_at DESC, id);
    CREATE TABLE IF NOT EXISTS community_reports (id TEXT PRIMARY KEY, annotation_id TEXT NOT NULL, annotation_revision INTEGER NOT NULL, audience TEXT NOT NULL, organization_id TEXT, reporter_id TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', resolution_reason TEXT, created_at TEXT NOT NULL, resolved_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS community_reports_pending_idx ON community_reports(reporter_id, annotation_id, annotation_revision) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS community_reports_reporter_idx ON community_reports(reporter_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS community_report_audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, report_id TEXT NOT NULL, annotation_id TEXT NOT NULL, reason_code TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS community_report_audit_no_update BEFORE UPDATE ON community_report_audit BEGIN SELECT RAISE(ABORT, 'community_report_audit_is_append_only'); END;
    CREATE TRIGGER IF NOT EXISTS community_report_audit_no_delete BEFORE DELETE ON community_report_audit BEGIN SELECT RAISE(ABORT, 'community_report_audit_is_append_only'); END;
  `);
  const eventColumns = db.prepare("PRAGMA table_info(community_notification_events)").all();
  if (!eventColumns.some((column) => column.name === "kind")) {
    // Rebuild the local event table to make reply_id nullable without dropping
    // notifications or weakening foreign keys on an existing development store.
    const foreignKeys = db.pragma("foreign_keys", { simple: true });
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec("CREATE TABLE community_notification_events_expanded (id TEXT PRIMARY KEY, annotation_id TEXT NOT NULL, reply_id TEXT, actor_id TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'reply', source_id TEXT NOT NULL, target_subject_id TEXT)");
        db.exec("INSERT INTO community_notification_events_expanded SELECT id, annotation_id, reply_id, actor_id, created_at, 'reply', reply_id, NULL FROM community_notification_events");
        db.exec("DROP TABLE community_notification_events");
        db.exec("ALTER TABLE community_notification_events_expanded RENAME TO community_notification_events");
      })();
    } finally { db.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`); }
  }
}

// A statement generator keeps SQLite transactions completely synchronous. The same
// transaction runs against a PostgreSQL client without external calls under locks.
function runSqlite(db, iterator) {
  let step = iterator.next();
  while (!step.done) {
    const { sql, values } = step.value;
    const query = db.prepare(sql);
    const bound = values.map((value) => typeof value === "boolean" ? Number(value) : value);
    const result = query.reader ? query.all(...bound) : query.run(...bound);
    step = iterator.next(result);
  }
  return step.value;
}
function pgSql(sql) { let index = 0; return sql.replace(/\?/g, () => `$${++index}`); }
async function runPostgres(client, iterator) {
  let step = iterator.next();
  while (!step.done) {
    const { sql, values } = step.value;
    const result = await client.query(pgSql(sql), values);
    step = iterator.next(result.rows);
  }
  return step.value;
}
function storage(database, sqlite) {
  return {
    sqlite,
    tables: tableNames(sqlite),
    lock: sqlite ? "" : " FOR UPDATE",
    async read(sql, values = []) {
      return sqlite ? database.prepare(sql).all(...values) : (await database.query(pgSql(sql), values)).rows;
    },
    async write(factory) {
      if (sqlite) return database.transaction(() => runSqlite(database, factory()))();
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const result = await runPostgres(client, factory());
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    }
  };
}

function* activeAccount(store, userId) {
  if (store.sqlite) return;
  yield statement("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [`intuecho-account-deletion:${userId}`]);
  const deleted = yield statement("SELECT 1 FROM account_deletion_jobs WHERE subject_id = ?", [userId]);
  if (deleted.length) throw failure("ACCOUNT_DELETED", 403);
}

function* recordSourceEvent({ sqlite, tables }, { kind, sourceId, annotationId, actorId, targetSubjectId, skipRecipients = [] }) {
  // Every event is anchored in a persisted business record in this transaction.
  // No client-provided event IDs or arbitrary notification recipients are accepted.
  const parent = (yield statement(`SELECT * FROM ${tables.annotations} WHERE id = ?`, [annotationId]))[0];
  if (!parent) throw failure("ANNOTATION_NOT_FOUND", 404);
  let target = targetSubjectId ?? null;
  let version = "";
  if (kind === "reply" || kind === "mention") {
    const reply = (yield statement(`SELECT id FROM ${tables.replies} WHERE id = ? AND parent_annotation_id = ? AND author_id = ? AND deleted_at IS NULL`, [sourceId, annotationId, actorId]))[0];
    if (!reply || parent.withdrawn_at) throw failure("NOTIFICATION_REPLY_NOT_FOUND", 404);
    if (kind === "mention") {
      const participant = target && (parent.author_id === target || (yield statement(`SELECT id FROM ${tables.replies} WHERE parent_annotation_id = ? AND author_id = ? AND deleted_at IS NULL AND id <> ?`, [annotationId, target, sourceId])).length);
      if (!participant || target === actorId) throw failure("MENTION_TARGET_NOT_IN_THREAD");
    }
  } else if (kind === "reading_task") {
    const tag = sqlite
      ? yield statement("SELECT 1 FROM annotation_tags_v2 WHERE annotation_id = ? AND tag_name = '读书包' AND origin = 'user' AND state = 'active'", [annotationId])
      : yield statement("SELECT 1 FROM annotation_tags assigned JOIN tags ON tags.id = assigned.tag_id WHERE assigned.annotation_id = ? AND tags.name = '读书包' AND assigned.origin = 'user' AND assigned.state = 'active'", [annotationId]);
    if (sourceId !== annotationId || parent.author_id !== actorId || parent.visibility !== "organization" || parent.share_to_plaza || parent.withdrawn_at || !tag.length) throw failure("INVALID_READING_TASK_INTENT");
  } else if (kind === "report_result") {
    const source = (yield statement("SELECT * FROM community_reports WHERE id = ? AND annotation_id = ? AND status <> 'pending'", [sourceId, annotationId]))[0];
    if (!source) throw failure("REPORT_NOT_FOUND", 404);
    target = source.reporter_id; version = `:${source.status}`;
  } else if (kind === "tag_appeal_result") {
    const source = (yield statement(`SELECT * FROM ${tables.appeals} WHERE id = ? AND annotation_id = ? AND status <> 'pending'`, [sourceId, annotationId]))[0];
    if (!source) throw failure("TAG_APPEAL_NOT_FOUND", 404);
    target = source.submitted_by; version = `:${source.status}`;
  } else if (kind === "moderation") {
    const source = (yield statement(`SELECT * FROM ${tables.moderation} WHERE id = ? AND annotation_id = ? AND admin_user_id = ?`, [sourceId, annotationId, actorId]))[0];
    if (!source) throw failure("ANNOTATION_NOT_FOUND", 404);
    target = parent.author_id;
  } else throw failure("INVALID_NOTIFICATION_SOURCE");
  const now = new Date().toISOString();
  const eventId = `${kind}:${sourceId}${kind === "mention" ? `:${target}` : version}`;
  const inserted = yield statement("INSERT INTO community_notification_events(id, annotation_id, reply_id, actor_id, created_at, kind, source_id, target_subject_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING id", [eventId, annotationId, ["reply", "mention"].includes(kind) ? sourceId : null, actorId, now, kind, sourceId, target]);
  if (!inserted.length) return;
  const literature = yield statement(`SELECT DISTINCT literature_id FROM ${tables.targets} WHERE annotation_id = ?`, [annotationId]);
  const scopes = [["thread", annotationId], ...literature.map((row) => ["literature", row.literature_id])];
  if (parent.organization_id) scopes.push(["organization", parent.organization_id]);
  const values = scopes.flat();
  const matched = scopes.map(() => "(target_kind = ? AND target_id = ?)").join(" OR ");
  const preferences = yield statement(`SELECT * FROM community_preferences WHERE ${matched} OR (target_kind = 'author' AND target_id = ?) ORDER BY user_id, target_kind, target_id${sqlite ? "" : " FOR UPDATE"}`, [...values, actorId]);
  const subscribers = new Set(preferences.filter((row) => row.subscribed).map((row) => row.user_id));
  for (const recipient of subscribers) {
    if ((target && target !== recipient) || skipRecipients.includes(recipient)) continue;
    // An explicit opt-out wins over overlapping broader subscriptions. No row is
    // the default; a persisted unsubscribed scope expresses the user's choice.
    if (recipient === actorId || preferences.some((row) => row.user_id === recipient && (row.muted || row.blocked || (row.target_kind !== "author" && !row.subscribed)))) continue;
    if (!sqlite && (yield statement("SELECT 1 FROM account_deletion_jobs WHERE subject_id = ?", [recipient])).length) continue;
    // No membership snapshot is stored. Read-time authorization is authoritative.
    yield statement("INSERT INTO community_notifications(id, event_id, recipient_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(event_id, recipient_id) DO NOTHING", [`notification_${randomUUID()}`, eventId, recipient, now]);
  }
}
function* recordReplyEvent(store, { replyId, annotationId, actorId, mentionedUserIds = [] }) {
  const mentioned = [...new Set(mentionedUserIds)];
  if (mentioned.length > 5) throw failure("INVALID_REPLY");
  for (const targetSubjectId of mentioned) yield* recordSourceEvent(store, { kind: "mention", sourceId: replyId, annotationId, actorId, targetSubjectId });
  yield* recordSourceEvent(store, { kind: "reply", sourceId: replyId, annotationId, actorId, skipRecipients: mentioned });
}
export function recordSqliteCommunitySourceEvent(db, input) { return runSqlite(db, recordSourceEvent({ sqlite: true, tables: tableNames(true) }, input)); }
export async function recordPostgresCommunitySourceEvent(client, input) { return runPostgres(client, recordSourceEvent({ sqlite: false, tables: tableNames(false) }, input)); }
export function recordSqliteCommunityReplyEvent(db, input) {
  return runSqlite(db, recordReplyEvent({ sqlite: true, tables: tableNames(true) }, input));
}
export async function recordPostgresCommunityReplyEvent(client, input) {
  return runPostgres(client, recordReplyEvent({ sqlite: false, tables: tableNames(false) }, input));
}

// Invoke before the account lifecycle deletes private annotation trees. Audit
// rows contain only the existing minimal historical actor/action references.
export async function deletePostgresCommunityGovernanceForAccount(client, subjectId) {
  // Order is a concurrency fence: fanout holds subscription rows FOR UPDATE until
  // its reply commits. Delete those rows FIRST, then notifications, in the same
  // account-lifecycle transaction. New subscriptions use the subject tombstone
  // lock. This avoids acquiring multiple subject advisory locks in reply fanout.
  await client.query("DELETE FROM community_preferences WHERE user_id = $1 OR (target_kind = 'author' AND target_id = $1)", [subjectId]);
  await client.query("DELETE FROM community_notifications WHERE recipient_id = $1", [subjectId]);
  await client.query("DELETE FROM community_notification_events WHERE actor_id = $1 OR target_subject_id = $1 OR annotation_id IN (SELECT id FROM annotations WHERE author_id = $1 AND visibility <> 'public')", [subjectId]);
  await client.query("DELETE FROM community_reports WHERE reporter_id = $1 OR annotation_id IN (SELECT id FROM annotations WHERE author_id = $1 AND visibility <> 'public')", [subjectId]);
}

function reportResult(row) {
  return { id: row.id, annotationId: row.annotation_id, revision: row.annotation_revision, reason: row.reason, detail: row.detail,
    status: row.status, createdAt: iso(row.created_at), resolvedAt: iso(row.resolved_at), resolutionReason: row.resolution_reason };
}
function sameAudience(row, annotation) {
  return row.visibility === annotation.visibility && (row.organization_id ?? null) === annotation.organizationId && Number(row.revision) === annotation.revision && !row.withdrawn_at;
}
function* audit(actorId, action, row, reason, now) {
  yield statement("INSERT INTO community_report_audit(id, actor_id, action, report_id, annotation_id, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [`reportaudit_${randomUUID()}`, actorId, action, row.id, row.annotation_id, reason, now]);
}

class CommunityGovernanceRepository {
  constructor(store, { annotationRepository, authorizeOrganizationAccess, now = () => new Date() }) {
    this.store = store;
    this.annotations = annotationRepository;
    this.authorizeOrganizationAccess = authorizeOrganizationAccess;
    this.now = now;
  }
  async preferences(viewer) {
    const rows = await this.store.read("SELECT * FROM community_preferences WHERE user_id = ? ORDER BY target_kind, target_id", [viewer.id]);
    return rows.map((row) => ({ targetKind: row.target_kind, targetId: row.target_id, subscribed: Boolean(row.subscribed), muted: Boolean(row.muted), blocked: Boolean(row.blocked) }));
  }
  async setPreference(viewer, input) {
    if (input.subscribed) {
      if (input.targetKind === "thread") await this.annotations.annotation(input.targetId, viewer);
      if (input.targetKind === "organization") {
        const access = await this.authorizeOrganizationAccess?.({ organizationId: input.targetId, userId: viewer.id });
        if (!access?.allowed) throw failure("ORGANIZATION_ACCESS_DENIED", 403);
      }
      if (input.targetKind === "literature") {
        // Only canonical literature already visible to the viewer can be followed.
        const rows = await this.store.read(`SELECT DISTINCT annotation_id FROM ${this.store.tables.targets} WHERE literature_id = ?`, [input.targetId]);
        let visible = false;
        for (const row of rows) {
          try { await this.annotations.annotation(row.annotation_id, viewer); visible = true; break; }
          catch (error) { if (error.status !== 404 && error.status !== 403) throw error; }
        }
        if (!visible) throw failure("ANNOTATION_NOT_FOUND", 404);
      }
    }
    const now = this.now().toISOString();
    const store = this.store;
    await store.write(function* () {
      yield* activeAccount(store, viewer.id);
      yield statement("INSERT INTO community_preferences(user_id, target_kind, target_id, subscribed, muted, blocked, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, target_kind, target_id) DO UPDATE SET subscribed = excluded.subscribed, muted = excluded.muted, blocked = excluded.blocked, updated_at = excluded.updated_at", [viewer.id, input.targetKind, input.targetId, input.subscribed, input.muted, input.blocked, now]);
    });
    return input;
  }
  async notifications(viewer) {
    const rows = await this.store.read("SELECT notification.*, event.annotation_id, event.kind, event.source_id, event.target_subject_id FROM community_notifications notification JOIN community_notification_events event ON event.id = notification.event_id WHERE notification.recipient_id = ? ORDER BY notification.created_at DESC, notification.id DESC LIMIT 100", [viewer.id]);
    const results = [];
    for (const row of rows) {
      try {
        const annotation = await this.annotations.annotation(row.annotation_id, viewer);
        // An author's retained personal access must not expose former organization
        // discussions through this inbox after membership is revoked.
        if (annotation.visibility === "organization") {
          const access = await this.authorizeOrganizationAccess?.({ organizationId: annotation.organizationId, userId: viewer.id });
          if (!access?.allowed) throw failure("ORGANIZATION_ACCESS_DENIED", 403);
        }
        if (row.target_subject_id && row.target_subject_id !== viewer.id) throw failure("ANNOTATION_NOT_FOUND", 404);
        const target = { annotationId: annotation.id, revision: annotation.revision };
        if (row.kind === "report_result") {
          if (!(await this.store.read("SELECT 1 FROM community_reports WHERE id = ? AND reporter_id = ?", [row.source_id, viewer.id])).length) throw failure("REPORT_NOT_FOUND", 404);
          target.reportId = row.source_id;
        }
        if (row.kind === "tag_appeal_result") {
          if (!(await this.store.read(`SELECT 1 FROM ${this.store.tables.appeals} WHERE id = ? AND submitted_by = ?`, [row.source_id, viewer.id])).length) throw failure("TAG_APPEAL_NOT_FOUND", 404);
          target.appealId = row.source_id;
        }
        results.push({ id: row.id, available: true, kind: row.kind, createdAt: iso(row.created_at), readAt: iso(row.read_at), target });
      } catch (error) {
        if (![403, 404, 503].includes(error.status)) throw error;
        results.push({ id: row.id, available: false });
      }
    }
    return results;
  }
  async markRead(viewer, notificationId) {
    const now = this.now().toISOString();
    const store = this.store;
    return store.write(function* () {
      yield* activeAccount(store, viewer.id);
      const rows = yield statement("UPDATE community_notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND recipient_id = ? RETURNING id", [now, notificationId, viewer.id]);
      if (!rows.length) throw failure("NOTIFICATION_NOT_FOUND", 404);
      return { id: notificationId, read: true };
    });
  }
  async submitReport(viewer, annotationId, input) {
    const annotation = await this.annotations.annotation(annotationId, viewer);
    if (input.revision !== annotation.revision) throw failure("REPORT_REVISION_CONFLICT", 409);
    const now = this.now().toISOString();
    const dayStart = `${now.slice(0, 10)}T00:00:00.000Z`;
    const store = this.store;
    return store.write(function* () {
      yield* activeAccount(store, viewer.id);
      // Serialize the per-user quota across different annotations in PostgreSQL.
      if (!store.sqlite) yield statement("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [`community-report:${viewer.id}`]);
      const current = (yield statement(`SELECT * FROM ${store.tables.annotations} WHERE id = ?${store.lock}`, [annotationId]))[0];
      if (!current || !sameAudience(current, annotation)) throw failure("REPORT_REVISION_CONFLICT", 409);
      const duplicate = (yield statement("SELECT * FROM community_reports WHERE reporter_id = ? AND annotation_id = ? AND annotation_revision = ? AND status = 'pending'", [viewer.id, annotationId, input.revision]))[0];
      if (duplicate) return reportResult(duplicate);
      const [{ count }] = yield statement("SELECT count(*) AS count FROM community_reports WHERE reporter_id = ? AND created_at >= ?", [viewer.id, dayStart]);
      if (Number(count) >= 10) throw failure("REPORT_RATE_LIMITED", 429);
      const row = { id: `report_${randomUUID()}`, annotation_id: annotationId, annotation_revision: input.revision, reporter_id: viewer.id, reason: input.reason, detail: input.detail, status: "pending", created_at: now, resolved_at: null, resolution_reason: null };
      yield statement("INSERT INTO community_reports(id, annotation_id, annotation_revision, audience, organization_id, reporter_id, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [row.id, annotationId, input.revision, annotation.visibility, annotation.organizationId, viewer.id, input.reason, input.detail, now]);
      yield* audit(viewer.id, "submitted", row, input.reason, now);
      return reportResult(row);
    });
  }
  async myReports(viewer) {
    return (await this.store.read("SELECT * FROM community_reports WHERE reporter_id = ? ORDER BY created_at DESC, id DESC LIMIT 100", [viewer.id])).map(reportResult);
  }
  async reviewAccess(viewer, row, platformAdmin) {
    let annotation;
    try { annotation = await this.annotations.annotation(row.annotation_id, viewer); }
    catch (error) { if ([403, 404].includes(error.status)) return null; throw error; }
    if (annotation.visibility !== row.audience || annotation.organizationId !== (row.organization_id ?? null)) return null;
    if (annotation.visibility === "public") return platformAdmin ? annotation : null;
    if (platformAdmin) return null;
    if (annotation.visibility !== "organization") return null;
    const access = await this.authorizeOrganizationAccess?.({ organizationId: annotation.organizationId, userId: viewer.id });
    if (!access?.allowed || !["owner", "admin"].includes(access.role)) return null;
    const current = (await this.store.read(`SELECT * FROM ${this.store.tables.annotations} WHERE id = ?`, [annotation.id]))[0];
    return current && sameAudience(current, annotation) ? annotation : null;
  }
  async reviewReports(viewer, { platformAdmin = false } = {}) {
    const candidates = await this.store.read("SELECT * FROM community_reports WHERE status = 'pending' ORDER BY created_at, id LIMIT 200");
    const reports = [];
    for (const row of candidates) if (await this.reviewAccess(viewer, row, platformAdmin)) reports.push(reportResult(row));
    return reports;
  }
  async resolveReport(viewer, id, input, { platformAdmin = false } = {}) {
    const row = (await this.store.read("SELECT * FROM community_reports WHERE id = ?", [id]))[0];
    if (!row) throw failure("REPORT_NOT_FOUND", 404);
    const annotation = await this.reviewAccess(viewer, row, platformAdmin);
    if (!annotation) throw failure("REPORT_NOT_FOUND", 404);
    const now = this.now().toISOString();
    const store = this.store;
    return store.write(function* () {
      yield* activeAccount(store, viewer.id);
      const current = (yield statement(`SELECT * FROM ${store.tables.annotations} WHERE id = ?${store.lock}`, [row.annotation_id]))[0];
      if (!current || !sameAudience(current, annotation)) throw failure("REPORT_NOT_FOUND", 404);
      const updated = yield statement("UPDATE community_reports SET status = ?, resolution_reason = ?, resolved_at = ? WHERE id = ? AND status = 'pending' RETURNING *", [input.status, input.reason, now, id]);
      if (!updated.length) throw failure("REPORT_ALREADY_RESOLVED", 409);
      yield* audit(viewer.id, input.status, row, input.reason, now);
      yield* recordSourceEvent(store, { kind: "report_result", sourceId: row.id, annotationId: row.annotation_id, actorId: viewer.id });
      return reportResult(updated[0]);
    });
  }
}
export class SqliteCommunityGovernanceRepository extends CommunityGovernanceRepository {
  constructor(db, options) { initializeSqliteCommunityGovernance(db); super(storage(db, true), options); }
}
export class PostgresCommunityGovernanceRepository extends CommunityGovernanceRepository {
  constructor(pool, options) { super(storage(pool, false), options); }
}
