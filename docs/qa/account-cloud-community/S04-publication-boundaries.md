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
| Thin-reading private toggle | Explicit confirmed withdrawal adopts the exact owned legacy mapping into the existing PDF operation ledger and makes that community annotation private | No reply deletion or derived-copy cascade | Unknown results retain their exact actor-bound retract operation; successful receipts permit local deletion, while republishing that legacy item remains on hold |
| Account deletion | Existing product lifecycle and publication account-deletion lock remain | No additional cascade added here | Queue work cannot move into another actor's session |

There is no read-only remote operation lookup endpoint in this slice. For a known
binding, reconciliation replays the exact existing operation. Unknown legacy
ownership cannot be established by replay under a guessed account. Organization
content is not replayed through an upsert merely to discover an ID for withdrawal.
For thin-reading, a pending create with no known remote identity remains held when
the user requests withdrawal. The original frozen request and local note remain;
the UI does not call that withdrawn. Known remote identities use the existing
desktop publication route, preserving its audience and owner validation.

## S09 withdrawal bridge validation

The bridge checks owner, queue key, source annotation ID and remote ID in the
existing transaction. Concurrent exact retracts return the same receipt. The
legacy sync endpoint rejects both old and newer upserts once the publication
ledger is retracted, so that versionless endpoint cannot resurrect the item.
Withdrawn originals remain local, and replies are preserved.

`thinReadingWithdrawal.test.mjs` exercises real SQLite transactions: three tests
failed before the bridge, then four passed. The new scoped
`scripts/verify-thin-reading-withdrawal.mjs` uses the existing strict PostgreSQL
test guard and performs no schema reset. It passed against the newly created
isolated PostgreSQL database with migration 024: exact ownership, actual rollback
after an injected ledger write failure, concurrent replay, legacy no-resurrection,
and reply preservation. It removes only its random synthetic fixtures afterwards.
This is local PostgreSQL integration evidence, not a production acceptance claim.

Thin-reading dispatch also requires an explicit preview callback containing only
the pending bodies, excerpts, verified actor and action. The saved envelope from
the explicit create action is reused when the UI immediately requests sync;
that path does not assign an actor to a recovered legacy task.

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


## Unknown thin-reading create withdrawal lookup

A user-requested withdrawal can recover a lost create response without publishing its body again. The desktop sends only the original queue key, source annotation ID, timestamp, and SHA-256 of canonical wire body/targets to `POST /v1/thin-reading/annotations:lookup`. The authenticated owner is selected by the existing desktop audience boundary. The stored mapping, source timestamp, body and target digest must all match before a remote ID is returned. The client also requires the same verified actor, original durable request, unchanged session during the read, unique complete receipts, and an unchanged local document. It persists the resulting existing-ledger retract operation before sending it. Matched batch siblings can finish; unresolved originals remain available for an explicit later lookup. No result never means a successful withdrawal or permission to replay a create.

The shared canonical helper ignores response-only literature hydration but includes all wire body, target, derived-source and evidence fields. No table or migration was added. The route registration escapes its literal colon (`annotations::lookup` and `annotations::sync` in Fastify); external URLs remain unchanged. Root integration must add the lookup URL to the desktop audience allowlists in `server.mjs` and `productionApp.mjs`.

Validation: two SQLite lookup regressions first failed on the missing method, and seven desktop recovery tests first failed on the old unconditional hold. The final suite covers owner/source/version/digest conflicts, absent results, duplicate or incomplete receipts, actor/session changes, durable-original substitution, local changes while reading, partial batches and persist-before-retract. SQLite serialization is unchanged across lookups. Route tests use a stub authentication boundary and real Fastify routing. The scoped PostgreSQL script runs the lookup inside `BEGIN READ ONLY` against the separately restored `account_restore_3d8ddc732b_test` database on loopback port 46349, then verifies the existing transaction rollback, concurrent replay, no-resurrection and reply-preservation cases. This is local PostgreSQL evidence, not S3, IdP, deployment, or production acceptance.

## Desktop publication profile and complete evidence preview

New thin-reading operations read the authenticated owner's actual community profile before preparation, display and persist that snapshot, and send its optional `expectedAuthorProfileRevision`. PDF operation/storage types expose the same fields for the root-owned controller integration. A changed profile rejects a new write inside the existing publication transaction and account lifecycle lock. Exact committed operations return the prior receipt before checking the current profile; changing the profile parameter under the same operation version conflicts. Thin-reading sync stores its original profile revision inside the existing annotation snapshot JSON, without a new table or migration. Existing wire clients without the optional field retain compatibility. New desktop code holds old unknown operations without a saved profile instead of adding a field or silently borrowing the latest profile.

Every preview item includes its own saved author profile and all source/derived/evidence excerpts from the frozen wire targets. A mixed batch can therefore display different saved profile versions accurately. Root integration owns the PDF controller, common dialog, and the two desktop audience allowlists for `POST /v1/integrations/desktop/publication-profile`.

Validation: two service profile regressions and two profile client regressions failed first. Final affected desktop tests plus smoke passed (197 tests); service regression/route tests passed (15 tests), as did 11 existing API publication cases. `scripts/verify-desktop-publication-profile.mjs` passed against the independently restored loopback PostgreSQL database with synthetic scoped rows: real thin/PDF writes, exact replay after profile changes, same-version profile conflicts, and stale-profile no-write checks. It removes only its own random-owner fixtures and never truncates the database. Desktop build reached TypeScript and failed on three pre-existing `AssetSourceReference.paperId` versus `libraryReference.documentId` errors in the merged a0c09e94 baseline. Root reported those fixed by 699b5cbe and owns final integrated build verification; this slice does not claim its build passed.
