import { AnnotationCommunityError } from "./annotationCommunitySqlite.mjs";

/** Serialize late writes with lifecycle cleanup; requires a READ COMMITTED transaction. */
export async function assertIntuechoAccountActive(client, subject) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`intuecho-account-deletion:${subject}`]);
  const deleted = await client.query("SELECT 1 FROM account_deletion_jobs WHERE subject_id = $1", [subject]);
  if (deleted.rows[0]) throw new AnnotationCommunityError("ACCOUNT_DELETED", 403);
}
