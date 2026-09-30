# Device control protocol

The verified business-account subject owns its devices, pairings and durable task history. Production uses the PostgreSQL adapter in `services/api`; the local development service has a separate SQLite adapter. The shared package contains no deployment or database dependency.

Mobile and desktop routes require their respective token audience/client plus a random device credential. The client persists that credential before registration; registration retries require the same credential. Public snapshots never include its hash, pairing challenge or execution lease token. Pairing requires a desktop-issued eight-digit code, expires after five minutes and is single-use. Six guesses per account per ten minutes are allowed. Unpairing cancels unstarted work and requests cancellation of running work.

Only four commands exist: open a document, extract its embedded text, summarize its text, and synchronize the library. Document commands carry the stable document ID and SHA-256 attachment version; files travel through file synchronization. No path, shell command, executable or arbitrary model instruction can be submitted.

Clients persist a UUID operation ID before sending. Replays return the original task, including after unpairing. Reusing an ID for different inputs fails. A pending cancellation is resolved atomically with an uncertain submission, so a never-sent task cannot briefly become executable. Native mobile submissions include their creation time; new requests older than seven days fail instead of recreating a purged receipt. Cancelling such an old unknown submission records `uncertain`, with cancellation requested, and cannot create executable work or claim that a previous execution never occurred.

One desktop may lease one task at a time. Unstarted 90-second leases can be retried up to five times. Started tasks renew a 120-second lease through progress updates. Expired running work becomes `uncertain` and is never automatically re-executed. A late, matching receipt can resolve uncertainty; terminal receipt replay returns the original result. The executor must persist its execution journal before effects and its result before acknowledging completion.

Limits per account: 20 active / 100 total registered devices, 50 active / 200 retained tasks, 24-hour queued-task lifetime, terminal and uncertain retention of 14 days, and 128 KiB per result. Uncertain tasks count against retained history, but do not permanently occupy active capacity. Mobile holds at most 50 pending sends. Unknown outcomes require inspection or an explicit new operation; cancellation cannot undo completed effects.

Android keeps network waits outside its local library/outbox locks. A cancellation saved during a send remains queued until the server acknowledges that cancellation using the same operation ID. A malformed or mismatched acknowledgement never removes a pending send. Results from a previous login cannot clear a newer session.

Polling snapshots contain bounded result summaries and a `hasText` marker. Either participant may request its own full task at `GET /v1/{mobile|desktop}/tasks/{taskId}`; another device cannot read it even within the same account. Android caches the last 20 opened results in its account-local SQLite records, keeping completed results available offline without polling their full text.

The API migration is `028_device_control.sql`. Opt-in PostgreSQL integration tests use `LITEASY_DEVICE_CONTROL_TEST_DATABASE_URL` and create/drop an isolated schema; they do not migrate an existing production schema. Deployment, live identity-provider validation and network reachability remain operator responsibilities.
