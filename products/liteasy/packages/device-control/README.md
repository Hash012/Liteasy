# Device control protocol

The verified business-account subject owns its devices, pairings and durable task history. Production uses the PostgreSQL adapter in `services/api`; the local development service has a separate SQLite adapter. The shared package contains no deployment or database dependency.

Mobile and desktop routes require their respective token audience/client plus a random device credential. The client persists that credential before registration; registration retries require the same credential. Public snapshots never include its hash, pairing challenge or execution lease token. Pairing requires a desktop-issued eight-digit code, expires after five minutes and is single-use. Six guesses per account per ten minutes are allowed. Unpairing cancels unstarted work and requests cancellation of running work.

Only four commands exist: open a document, extract its embedded text, summarize its text, and synchronize the library. Document commands carry the stable document ID and SHA-256 attachment version; files travel through file synchronization. No path, shell command, executable or arbitrary model instruction can be submitted.

Clients persist a UUID operation ID before sending. Replays return the original task, including after unpairing. Reusing an ID for different inputs fails. A pending cancellation is resolved atomically with an uncertain submission, so a never-sent task cannot briefly become executable. Native mobile submissions include their creation time; new requests older than seven days fail instead of recreating a purged receipt.

One desktop may lease one task at a time. Unstarted 90-second leases can be retried up to five times. Started tasks renew a 120-second lease through progress updates. Expired running work becomes `uncertain` and is never automatically re-executed. A late, matching receipt can resolve uncertainty; terminal receipt replay returns the original result. The executor must persist its execution journal before effects and its result before acknowledging completion.

Limits per account: 20 active / 100 total registered devices, 50 nonterminal / 200 retained tasks, 24-hour queued-task lifetime, terminal retention of 14 days, and 128 KiB per result. Mobile holds at most 50 pending sends. Unknown outcomes require inspection or an explicit new operation; cancellation cannot undo completed effects.

The API migration is `028_device_control.sql`. Opt-in PostgreSQL integration tests use `LITEASY_DEVICE_CONTROL_TEST_DATABASE_URL` and create/drop an isolated schema; they do not migrate an existing production schema. Deployment, live identity-provider validation and network reachability remain operator responsibilities.
