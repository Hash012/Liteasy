# LiteasyClaw Roadshow-Priority Three-End Demo Design

## 1. Purpose

This document defines the near-term roadshow-priority LiteasyClaw delivery slice.

The goal is not to finish the formal SaaS program first. The goal is to produce a three-end demo that is:

- stable to reset
- credible to present
- easy to explain live
- strong enough to demonstrate customer-side entry, cloud-side service, and internal operations/maintenance visibility in one story

This slice should preserve work that remains useful later, but its primary decision rule is roadshow effectiveness.

## 2. Demo Narrative

The primary roadshow narrative is:

- LiteasyClaw has a customer-side desktop entry point
- LiteasyClaw has a deployable service side
- LiteasyClaw has an internal operations/maintenance surface
- actions in the customer-side flow create visible state that the operations side can inspect or manage

The audience should leave with the impression that this is a SaaS system with three linked surfaces, not a single isolated desktop mockup.

## 3. Scope

### In scope

- three-end demo stabilization
- real demo data reset / reseed flow
- `/admin/` operations console enhancements
- visible service-side state for collections, recommendation cache, organizations, sessions, and policy
- presenter-facing smoke-check tooling and route

### Out of scope

- full formal F3/F4 implementation
- full production auth, billing, or multi-tenant backend
- complex organization approval workflow
- production-grade persistence or analytics
- large new desktop UI redesign

## 4. Three-End Boundary

### 4.1 Desktop

The desktop app remains the customer entry point.

It should demonstrate:

- login / restored session
- local workspace
- organization entry
- recommendation flow
- collection flow
- assistant flow
- artifact entry points

The desktop UI should not be expanded with extra admin or debug concepts for this roadshow slice.

### 4.2 Dev-cloud service

The service layer should:

- back the current demo endpoints
- persist demo collection and recommendation cache state
- expose a resettable demo dataset
- expose service-side aggregate status for the operations console

### 4.3 Internal operations console

`/admin/` remains an internal platform operations and maintenance surface.

It must not become the customer organization admin page.

It should visibly answer these questions during a demo:

- what customer organizations exist?
- how many active sessions exist?
- how many collection items and recommendation-cache entries exist?
- what policy is active?
- what recent actions happened?
- can operations reset or reseed the demo system quickly?

## 5. Roadshow-First Product Rules

### 5.1 Resettable starting state

Every roadshow must be able to begin from a known-good baseline.

That baseline must include:

- deterministic demo sessions
- deterministic organizations
- deterministic collection data
- deterministic recommendation-cache state
- deterministic shared-library demo state

### 5.2 Operations console must reflect real demo state

The operations console must no longer read only as a static description panel.

It must show:

- counts and summaries derived from the actual current demo data store
- recent activity derived from current or recently recorded demo actions
- actions that mutate demo state in controlled ways

### 5.3 Customer flow remains simple

The roadshow slice should not overload the customer desktop with new complexity.

The customer-side story should remain:

1. log in
2. open organization / library
3. show recommendation and collection
4. ask assistant
5. show artifact
6. switch to operations console and show that the platform can see or manage the state

## 6. Data That Must Become Real Enough

This slice does not need full production data infrastructure. It needs enough persistent demo truth to support a believable roadshow.

The minimum real-enough state is:

- active sessions
- organizations
- collection items
- recommendation-cache entries
- policy version / current policy
- recent operations actions

## 7. Persistence Design

Continue to use lightweight JSON-file persistence for the demo environment.

Data directory:

- `development/dev-cloud/.liteasy-data/`

Override via:

- `LITEASY_DEV_CLOUD_DATA_DIR`

Recommended files:

- `collections.json`
- `recommendation-cache.json`
- `organizations.json`
- `sessions.json`
- `admin-activity.json`

These files should remain separated so each domain can be reasoned about independently.

## 8. Operations Console Enhancements

The operations console should be enhanced, not rebuilt from scratch.

## 8.1 Platform overview

Show:

- three-end entry links
- current policy version
- active session count
- organization count
- collection item count
- recommendation-cache entry count

This is the fastest way to communicate that the system is stateful and connected.

## 8.2 Customer organization view

Show:

- organization name
- role sample / ownership signal
- member count
- shared-library name
- last activity hint if available

The goal is not full organization management. The goal is to make the internal platform view feel real.

## 8.3 User and resource status

Show:

- recent logins
- recent collection saves
- recent recommendation-cache writes or hits
- recent shared-library opens

These can be short lists or a compact timeline.

## 8.4 Operations actions

Provide controlled operations actions:

- save API policy
- clear recommendation cache for a target scope or target session
- reset demo data
- reseed demo data

These actions are valuable because they let the presenter demonstrate actual platform control rather than static observability.

## 9. Admin APIs

The roadshow slice should add operations-oriented demo endpoints such as:

- `POST /v1/admin/demo-reset`
- `POST /v1/admin/demo-reseed`
- `POST /v1/admin/recommendation-cache/clear`
- `GET /v1/admin/demo-state`

### demo-reset

Purpose:

- clear current demo data back to baseline or empty state

### demo-reseed

Purpose:

- repopulate the known-good roadshow baseline

### recommendation-cache/clear

Purpose:

- allow operations to clear recommendation cache for a visible demo scope

### demo-state

Purpose:

- return current aggregated counts and recent activity for `/admin/`

## 10. Script Support

To keep the roadshow repeatable, the repository should expose scripts for operators.

Recommended scripts:

- `development/scripts/reset-demo-data.mjs`
- `development/scripts/reseed-demo-data.mjs`
- `development/scripts/smoke-roadshow.mjs`

### reset-demo-data.mjs

Purpose:

- wipe or reset current demo data

### reseed-demo-data.mjs

Purpose:

- write a deterministic baseline demo dataset

### smoke-roadshow.mjs

Purpose:

- verify root index
- verify `/healthz`
- verify `/admin/`
- verify key API responses

## 11. Desktop Impact

Desktop changes should stay minimal.

The desktop should only change where needed to support the stronger three-end story:

- no new admin concepts in the customer UI
- keep current collection and recommendation semantics
- ensure collection and recommendation cache remain visible through the cloud-backed demo state

If desktop behavior is already sufficient for the roadshow story, prefer leaving it alone.

## 12. Recommended Demo Flow

The preferred roadshow sequence is:

1. show desktop workbench
2. log in
3. show organization entry and shared library
4. show collection and recommendations
5. ask assistant and show artifact entry
6. switch to `/admin/`
7. show operations overview and organization/resource counts
8. trigger at least one operations action, such as policy save or cache clear
9. explain that internal operations is separate from customer organization management

## 13. Failure Strategy

The roadshow slice must explicitly optimize for graceful degradation.

### If recommendation generation fails

- keep collection visible
- fall back to cached recommendation state if available
- operations console should still show prior cache / activity counts

### If `/admin/` is slow

- the root service index and demo-state API should still work
- presenter should still be able to explain the three-end shape using those smaller surfaces

### If desktop flow partially fails

- operations console and service state should still remain demonstrable

## 14. Verification Expectations

Before calling this slice ready:

- desktop tests pass
- desktop build passes
- dev-cloud tests pass
- `/admin/` renders and shows non-static state
- demo reset / reseed path works
- smoke-roadshow script succeeds

## 15. Recommended Implementation Order

1. add demo-state persistence and reset/reseed scripts
2. expose operations endpoints for reset, reseed, and cache clear
3. upgrade `/admin/` to show real counts and recent activity
4. add smoke-roadshow script
5. update roadshow docs and presenter checklist
