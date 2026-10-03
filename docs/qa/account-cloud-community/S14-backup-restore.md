# S14 local PostgreSQL backup and restore drill

Date: 2026-10-03. This is synthetic local PostgreSQL evidence, not production
backup acceptance. PostgreSQL 16.15 ran in the newly initialized portable cluster
under `/tmp/liteasy-account-postgres-THQsE7`, listening on loopback port 46349.
No system database, production service, existing unknown database, S3 object, or
real identity-provider credential was accessed.

## Procedure and evidence

1. Read the existing synthetic `account_intuecho_test` database using `pg_dump
   --format=custom --no-owner --no-privileges`. Restore with `pg_restore
   --exit-on-error --no-owner --no-privileges` into the newly created
   `account_restore_ef1bf0ef25_test` database. This source snapshot had migration
   024, five account-deletion tombstones and no retracted publication ledger rows.
2. Compare deletion-job count and the digest of the full ordered row JSON before
   and after restore. All five tombstones matched. The missing withdrawal sample
   was recorded as not run for this first stage.
3. Only in that new restored database, create one synthetic thin-reading
   annotation, adopt its exact owned mapping into the existing publication ledger,
   and confirm a revision-4 withdrawal. Dump this new synthetic state and restore
   it into another new database, `account_restore_3d8ddc732b_test`.
4. Verify that all five deletion tombstones and the withdrawal ledger survive.
   Replaying an older publication revision is rejected, and the restored
   annotation's private visibility, plaza flag and revision stay unchanged.

Each restored database has its own new owner and application roles, with no
superuser, database-creation or role-creation privileges. Public CONNECT was
revoked; the source application's connection to the new restored database failed
with SQLSTATE 42501. No original application/migration role privileges were
expanded. The original Liteasy and Intuecho databases were neither overwritten
nor seeded for this drill. New roles/databases were created through this new
cluster's own local administrative socket.

Non-secret evidence retained locally:

- First-stage result: `/tmp/liteasy-account-postgres-THQsE7/restore-drill-ef1bf0ef25/result.json`.
- Final result, with all four cases passed and no skipped case:
  `/tmp/liteasy-account-postgres-THQsE7/restore-drill-3d8ddc732b/result.json`.
- Reproduction scripts: `/tmp/liteasy-account-postgres-THQsE7/verify-backup-restore.mjs`
  and `verify-backup-restore-withdrawal.mjs` in the same directory.
- Dumps and tool logs are in those private local drill directories. Connection
  files are mode 0600 and are not included in repository evidence.

The checked-in `products/intuecho/services/api/scripts/verify-thin-reading-withdrawal.mjs`
was then run in the second restored database. It passed actual PostgreSQL checks
for exact same-version legacy replay, divergent payload/source rejection, exact
owned withdrawal, rollback after an injected ledger-write failure, concurrent
replay, no resurrection by legacy messages, and preservation of replies. Its
random synthetic fixtures are removed in `finally`; it does not reset a schema.

## Limits

This drill validates the PostgreSQL data and transaction boundaries through
migration 024. It does not verify subsequent migration-025 notification data,
Liteasy S3 recovery, scanner availability, real IdP reauthentication, Windows
packaging, production recovery time, off-host backup retention, or a live
operational restore. After all integration runs, the parent stopped only this disposable PostgreSQL
instance with `pg_ctl -D /tmp/liteasy-account-postgres-THQsE7/data -w stop`.
The private test data and evidence remain on disk; no system database was stopped.

## Later-events replay completed

The integrated repository now also contains a rerunnable drill that takes the
backup **before** deletion/withdrawal, derives later commands from the actual
source ledgers, restores into another new database, and keeps its business role
unable to connect until replay and verification succeed. Missing, incomplete or
interrupted replay leaves the gate closed. This complements, and does not change
the scope of, the earlier snapshot-preservation drill above.

The repository script passed all 15 assertions with all 27 current Intuecho
migrations. See [the explicit configuration and steps](S14-verification-matrix.md)
and [the non-secret evidence](S14-before-event-evidence.json). This remains a
synthetic PostgreSQL drill; real IdP/S3 and production journal operations are not
accepted by this result.
