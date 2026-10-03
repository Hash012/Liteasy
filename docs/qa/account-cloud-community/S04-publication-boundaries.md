# S04 publication queue evidence and S09 boundaries

This slice extends the existing PDF publication operation and thin-reading sync
queues. It adds no Post model, remote authorization field, database, or migration.

## Existing transaction evidence

- PostgreSQL `PostgresAnnotationCommunityRepository.applyDesktopAnnotationPublications`
  locks account deletion and sorted owner/queue keys inside one transaction. The
  ledger records source revision, timestamp, operation digest, state, remote ID,
  remote revision and synchronization time. Same-version divergent payloads fail
  with `ANNOTATION_PUBLICATION_VERSION_CONFLICT`; lower revisions or regressed
  timestamps fail with `STALE_ANNOTATION_PUBLICATION`.
- SQLite has the equivalent publication ledger. Existing `server.test.mjs`
  exercises same-version conflicts, replay, update, retract, owner isolation,
  partial domain failures and late transaction failures. Its PostgreSQL named
  unit tests use query doubles; they are not PostgreSQL integration evidence.
- The PDF queue key remains `paperId:annotationId`. Retrying an unknown request
  retains its original revision, timestamp and payload. There is no new random
  operation ID on retry. The server derives its digest from that existing wire
  operation.

## Local envelope and dispatch

`PublicationActorBinding` records the normalized Intuecho endpoint, identity
issuer, verified subject, scope and local session generation. Generation is a
local resume boundary, never server authorization. The root composition provides
the getter from a verified account session. This slice does not derive a subject
from an unverified token or assign old unbound records to the current account.

PDF create/update/retract requests save the exact pending operation before
transport. A changed account, endpoint or generation cannot dispatch or consume a
late receipt. A different runtime for the same actor requires explicit recovery;
an unknown binding remains held. Failed requests retain an unknown outcome. The
reader presents unknown withdrawal honestly and preserves local originals.
Reconciliation of an old operation cannot mark a newer local edit published.

Thin-reading saves its existing per-annotation queue snapshot before sending.
New explicit publication intents get a binding; restored unbound tasks do not.
The explicit sync action can resume the same principal in a new generation after
source preflight. Successful batch members leave the retry queue. A frozen old
operation is reconciled before a newer edit becomes eligible for a later sync.
Both clients reject duplicate or incomplete receipts. Envelope fields are never
sent as authorization facts.

Known organization sources cannot create or update public PDF content. Known
owner withdrawals remain available. Thin-reading requires a composition-provided
source preflight; missing source verification fails closed.

## S09 impact and remaining boundaries

| Action | Original / community projection | Replies and derived copies | Local cache, notifications, retrieval |
| --- | --- | --- | --- |
| PDF publication retract | Higher-revision ledger operation makes the community annotation private and removes plaza sharing; the original local annotation remains | No claim that another author's independent annotation or downloaded copy is deleted | Account-bound local retry remains; future remote reads depend on server visibility predicates |
| General annotation delete / withdraw | Existing owned lifecycle route, separate from this desktop queue slice | Existing independent projection and moderation rules remain | No global remote erasure claim |
| Governance hide / audience narrowing | Existing server governance checks and reply scope locks remain | No new privilege to promote another author's private reply | Search, recommendation, notification and AI behavior need their own integration evidence |
| Organization departure / revocation | Existing membership revalidation and explicit author exceptions remain | Does not grant access to other organization material; ambiguous original-thread visibility stays a D02 decision | No removal of the user's own local originals; previously downloaded copies are not claimed recovered |
| Thin-reading private toggle | Legacy route currently supports upsert; a local private toggle alone is not remote withdrawal | No remote cascade is inferred | A remote withdrawal integration remains required; see the follow-up S09 slice |
| Account deletion | Existing product lifecycle and publication account-deletion lock remain | No additional cascade added here | Queue work cannot move into another actor's session |

There is no read-only remote operation lookup endpoint in this slice. For a known
binding, reconciliation replays the exact existing operation. Unknown legacy
ownership cannot be established by replay under a guessed account. Organization
content is not replayed through an upsert merely to discover an ID for withdrawal.

## Validation level

- Red/green tests cover account change during loading, durable save before send,
  old runtime isolation, unbound legacy tasks, organization source rejection,
  conflicting duplicate receipts, and newer edits during old-operation recovery.
- Controller/client/projection tests use deterministic transport doubles. Reader
  tests use browser local storage. Thin-reading integration tests exercise the
  real action and persistence path with synthetic storage/transport, including
  save failure and account change while saving.
- This slice does not claim real IdP, S3, scanner, native Tauri, Windows Installer,
  production readiness, or end-to-end revocation acceptance. Real isolated
  PostgreSQL verification is recorded separately by the service integration work.
