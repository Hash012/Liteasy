# Phone → desktop tasks

Deploy the business API with migration `028_device_control.sql` and the mobile identity client described in [accounts.md](accounts.md). Both installations must use the same API and identity account. The desktop must log in through its native system-browser OAuth flow; browser previews and legacy development-password sessions do not provide a native device identity.

On desktop, open **Settings → Sync and backup → Phone and devices** (`设置 → 同步与备份 → 手机与设备`). Enable phone tasks, name this desktop, and generate a code. On the phone's **Desktop tasks** page, enter that eight-digit code within five minutes. Codes are one-use and guess-limited. Either side can unpair. Closing desktop or disabling tasks stops new execution; phone submissions may remain queued until desktop is available.

The desktop accepts only these commands:

| Command | Actual behavior |
| --- | --- |
| Open document | Verifies local document identity and actual PDF SHA-256, then opens it in the desktop reader. |
| Extract text | Extracts the PDF's embedded text with page references. Scanned pages need separate desktop OCR preparation; this command does not claim to OCR them. |
| Summarize | Requires the separate summary switch. Uses the current desktop model connection and a live provider response. The result identifies its text coverage; long inputs/results are bounded to 24,000 characters. Provider failures remain failures. |
| Sync library | Runs the configured desktop WebDAV workflow and reports remaining conflicts/deferred files. Conflict resolution remains on desktop. |

Document commands do not upload PDF files through the task queue. Sync the same logical document and attachment version first. Missing/mismatched files leave the task waiting; matching a filename alone is insufficient. Desktop must keep running and connected. There is no push wake-up of a powered-off desktop.

Device proofs use the OS credential store, scoped by API and account. The desktop native gateway checks the actual token verified by its OAuth session and restricts methods/routes. Its execution journal lives in the application's private local-data directory, outside the selected library and WebDAV exports. Switching accounts, service endpoint or library stops the previous executor.

Before an effect, desktop durably records that execution may start; before acknowledging completion, it durably records the result. A lost receipt response can be retried. Restart after uncertain execution records an unknown outcome instead of executing again. Review the document, synchronization state or provider usage before submitting a new task. Cancellation is cooperative; completed effects, an in-flight WebDAV commit or already-incurred model costs cannot be undone.

The [protocol](../../../packages/device-control/README.md) specifies account/device/queue/history limits. Tests cover the real service state machine with a fault-injected executor and separately cover PostgreSQL concurrency/restart durability. A live phone–IdP–business-API–desktop deployment still requires its own acceptance run; these checks do not claim a production rollout.
