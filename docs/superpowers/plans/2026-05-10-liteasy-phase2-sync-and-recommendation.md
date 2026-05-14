# Liteasy Phase 2 Sync and Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cloud-backed account synchronization, recommendation caching, external retrieval, and credibility scoring on top of the verified desktop core baseline.

**Architecture:** This plan depends on the Phase 0-1 desktop core being complete. It extends the desktop product with cloud metadata sync, recommendation services, and a first production-grade agent review seam without expanding into organization or plugin workflows.

**Tech Stack:** Existing desktop stack plus NestJS, PostgreSQL, Redis, BullMQ, S3-compatible storage, model gateway

---

## Scope Summary

- Depends on: `docs/superpowers/plans/2026-05-10-liteasy-phase0-1-desktop-core.md`
- Primary outcomes:
  - cloud account login and session persistence
  - document metadata sync
  - recommendation retrieval and left-pane caching
  - drag-to-collection flow
  - first user-visible confidence scoring
- Required exit artifacts:
  - non-developer startup guide update
  - Phase 2 test guide
  - known limitations log

---

## Current Implementation Status

Status: **implemented as a Phase 2 prototype baseline**.

Completed user-visible outcomes:

- [x] Cloud account login and local session persistence.
- [x] Cloud-governed model policy sync.
- [x] Document metadata sync for the currently visible workspace.
- [x] Recommendation retrieval for the selected document set.
- [x] Recommendation sorting by relevance and retrieval time through assistant commands.
- [x] Recommendation cache clearing when the workspace closes.
- [x] Drag from recommendations to local `收藏`.
- [x] Drag from recommendations or `收藏` back into `我的文献库`.
- [x] Local collection persistence without cloud sync.
- [x] First user-visible answer confidence and citation display.
- [x] Model execution trace display.
- [x] Cloud audit endpoint seam for generated answers.
- [x] User-visible model audit card with auditor model, score, verdict, and rationale.

Completed implementation artifacts:

- [x] Desktop Phase 2 UI and runtime wiring.
- [x] Development cloud endpoints for policy, account, recommendation, metadata sync, generation, and audit.
- [x] Phase 2 non-developer test guide: `docs/qa/phase2-test-guide.md`.
- [x] Known limitations log: `docs/qa/phase2-known-limitations.md`.
- [x] Startup guide update: `docs/qa/environment-startup-guide.md`.
- [x] Dev-cloud README update: `services/dev-cloud/README.md`.

Verification baseline:

- `cd desktop && npm test`
- `cd desktop && npm run build`
- `node --test services/dev-cloud/server.test.mjs services/dev-cloud/providers/openaiResponses.test.mjs`

---

## Remaining Production Gaps

These are not blockers for Phase 2 prototype acceptance, but they must be addressed before a production or Phase 3 handoff:

- Replace fixed demo account with real authentication, session validation, and authorization.
- Replace recommendation fixtures with real external retrieval, deduplication, ranking, and cache storage.
- Replace mock import/parsing/chunking/indexing with real document processing.
- Replace deterministic audit rules inside `/v1/model/audit` with a true second-model audit provider.
- Add formal API authentication and request validation to dev-cloud endpoints.
- Define the production boundary between local library files, local collection, cloud metadata, and future cloud library sync.

See `docs/qa/phase2-known-limitations.md` for the tester-facing version of these boundaries.
