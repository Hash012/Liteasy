# Reading core

Platform-independent literature identity, PDF annotation validation/migration, publication records and normalized ink geometry. Desktop and mobile compile these TypeScript sources directly; there is no React, Tauri, account lookup, browser storage or filesystem dependency.

Desktop feature paths re-export the shared public API to preserve existing consumers. Persistence and account scoping stay in each app. The existing desktop identity and annotation tests verify compatibility, including legacy annotation recovery and rejecting unsupported versions.

PDF rectangles and ink points use page-relative percentages. A document content hash identifies the actual bytes, independently of its bibliographic identity. Do not apply geometric annotations to a different attachment version without explicit reconciliation.
