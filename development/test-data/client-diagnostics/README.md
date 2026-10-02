# Local diagnostics synthetic fixture

`original-open.json` is entirely synthetic. Its path, file name, grant, error text,
body/chat markers and token are deliberate negative export assertions, not real
user data. The 12-byte descriptor is a mocked transport input, not a valid PDF.

The layers use this fixture as follows:

- `localDiagnostics.test.ts` verifies default opt-out, enum-only errors, bounded
  records, export projection and stale-operation invalidation.
- `originalFileDiagnostics.test.tsx` runs the real original-file controller with
  synthetic chooser/read/queue transports and reader callbacks. It covers picker
  success/cancel, read/reader failure, queued success, account changes and opt-out.
- `localDiagnosticsPanel.test.tsx` verifies reviewed snapshot deletion, omission
  of environment data, exact Blob contents and preview invalidation.
- `browser/localDiagnostics.browser.spec.ts` runs the actual help UI in Chromium
  and downloads an environment-only JSON file. It has no native transport and
  does not open a document. Reload must return collection to opt-out.

The scenario references name only slices of task-pack S01 and S07. They do not
complete either scenario or any of the six research-user acceptance roles.
Measured phase durations are controller timings, not first readable paint or
productivity results. Native WebView, file chooser, OS handoff and user-task
acceptance remain separate checks.
