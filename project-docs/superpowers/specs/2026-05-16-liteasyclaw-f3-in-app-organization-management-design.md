# LiteasyClaw F3 In-App Organization Management Formalization Design

## 1. Purpose

This document defines LiteasyClaw `F3`: formalize organization-side management inside the user software rather than moving it into a separate customer admin backend.

The first formal `F3` milestone must:

- keep organization management inside the LiteasyClaw desktop entry point
- formalize organization roles as `owner / admin / member`
- formalize organization creation permission, join rules, invite rules, leave rules, and shared-library ownership
- preserve the current shared-library interaction pattern: opening an organization shared library replaces the current workspace like opening a new folder in VSCode

This milestone does not build a full production collaboration suite. It turns the current organization demo seam into a clearer product and code boundary.

## 2. Current State

The current repository already contains:

- organization entry UI in `LiteasyClaw/desktop/src/app/features/organization/`
- organization list, organization summary, organization governance summary, notification state, and shared-library manifest clients
- dialogs for create, join, invite, and leave
- integration tests that already exercise:
  - organization list switching
  - shared-library opening
  - organization action dialogs
  - role-based visible button differences in the left pane

However, the current state is still only partially formal:

- role semantics are still close to demo payload semantics
- organization actions are mostly presentation seams and feedback strings
- organization membership lifecycle is not expressed as a durable model
- shared-library ownership is implied, not explicit
- the product boundary "organization management happens inside the software" is not yet written as a hard constraint in the implementation design

## 3. Goal

`F3` must deliver a clear first formal organization model with these guarantees:

1. organization management remains inside the LiteasyClaw software
2. roles are explicitly `owner / admin / member`
3. organization creation is gated by creation permission
4. join, invite, and leave are constrained by role rules
5. shared-library ownership is explicit and tied to organization ownership semantics
6. `/admin/` remains a platform-internal surface and does not become a customer organization admin backend

## 4. Scope

### In scope

- formal role model
- creation permission gate
- join / invite / leave role constraints
- shared-library ownership semantics
- desktop + dev-cloud end-to-end organization action flow
- tests and docs updated to match the formalized model

### Out of scope

- no complex approval workflow
- no multi-step invite acceptance flow
- no separate `editor` or more granular role lattice
- no owner-transfer UI in this first formalization pass
- no full audit system
- no real object storage-backed shared library
- no customer-facing separate organization admin backend

## 5. Product Boundary

### 5.1 Organization management stays in the software

This is a hard product rule.

Customer organization-side management must happen through the LiteasyClaw user software:

- create organization
- join organization
- invite members
- leave organization
- inspect members
- inspect notifications
- open shared library

The internal `/admin/` console remains platform-internal only:

- model policy
- platform governance
- internal operational visibility

It must not be reinterpreted as the customer organization management surface.

### 5.2 Role model

The first formal organization role model is:

- `owner`
- `admin`
- `member`

#### owner

The `owner` is the organization’s final control role.

Responsibilities and rights:

- organization ownership
- shared-library ownership authority
- invite members
- manage high-level organization settings
- remove or manage members in the future model

Constraints:

- an organization must not be left in an ownerless state
- this milestone does not introduce owner transfer UI, so owner leave must be blocked

#### admin

The `admin` is an operational management role without final ownership.

Responsibilities and rights:

- invite members
- manage collaboration-facing operations such as notifications and some organization actions
- participate in shared-library usage

Constraints:

- admin is not the final owner
- admin cannot implicitly become owner

#### member

The `member` is a participating organization role.

Responsibilities and rights:

- join organization
- read organization information
- read notifications
- open and use shared library according to organization visibility rules

Constraints:

- cannot create organization-management changes reserved for `owner` / `admin`
- cannot invite members

## 6. Core Rules

### 6.1 Organization creation permission

Not every user can create an organization.

The first formalized rule is:

- users with organization-creation permission may create organizations
- the creator automatically becomes `owner`
- users without that permission may still join organizations

This keeps the roadmap statement intact: creation permission is formalized separately from joining.

### 6.2 Join rules

Join flow in this first milestone is still simple, but no longer unbounded.

Rules:

- a user may join an organization only through the in-app organization flow
- a successful join produces role `member`
- join does not confer ownership or admin rights

### 6.3 Invite rules

Invite flow must be role-gated.

Rules:

- `owner` may invite
- `admin` may invite
- `member` may not invite

The desktop UI must reflect this in visible actions and disabled/hidden buttons, and the dev-cloud action path must enforce the same rule.

### 6.4 Leave rules

Leave flow must preserve organization validity.

Rules:

- `member` may leave
- `admin` may leave
- `owner` may not leave if that would leave the organization without an owner

Since owner transfer is out of scope for this milestone, the safe first rule is:

- block owner leave

### 6.5 Shared-library ownership

The organization shared library belongs to the organization as a resource, but its high-level control is anchored to organization ownership semantics.

The first formalized rule is:

- the shared library is an organization resource
- `owner` is the final authority for that resource
- `admin` may participate in organization-side management flows without being the final owner
- `member` may consume the shared library without gaining management ownership

## 7. Desktop Architecture

The desktop structure should remain close to the current repository layout. The goal is not to rebuild the UI, but to formalize the existing seams.

### 7.1 Organization types

`LiteasyClaw/desktop/src/app/features/organization/organization.types.ts` must become the single shared contract for:

- role types
- creation permission flags
- leave restrictions
- shared-library ownership fields

This is where the formal model should be written once and reused across UI, clients, and hooks.

### 7.2 Organization data hooks

These hooks continue as read-model hooks:

- `useOrganizationList`
- `useOrganizationSummary`
- `useOrganizationGovernance`
- `useOrganizationData`

They should expose formalized role and ownership data, not just demo labels.

### 7.3 Organization action hook

`useOrganizationActions.ts` should become the main action-policy boundary for in-app organization management.

Responsibilities:

- open create / join / invite / leave dialogs
- hold action feedback state
- apply role-aware preconditions before user actions are submitted

It should not become a generic repository or payload builder.

### 7.4 Shared-library workspace hook

`useOrganizationWorkspace.ts` keeps its current narrow responsibility:

- open organization shared library
- switch workspace
- return to local library

It may rely on formalized role and status data, but should not absorb organization governance logic.

## 8. Dev-Cloud Architecture

`LiteasyClaw/services/dev-cloud/` should formalize organization actions without collapsing them into unrelated modules.

### 8.1 Repository boundary

Add:

- `LiteasyClaw/services/dev-cloud/db/organizationRepository.mjs`

Responsibilities:

- persist organizations
- persist member role assignments
- persist organization ownership metadata
- expose role-aware action helpers

It should not own HTTP formatting or admin-console rendering.

### 8.2 Payload and route boundary

Existing organization payloads can remain under:

- `LiteasyClaw/services/dev-cloud/payloads/organizationPayloads.mjs`

but the action layer should be explicitly route-based for:

- create organization
- join organization
- invite member
- leave organization

These routes may live in `requestHandler.mjs`, but their business logic must delegate to repository/helpers instead of embedding role rules directly inside the route branch.

## 9. API Design

The first formal organization action endpoints should be:

- `POST /v1/org/create`
- `POST /v1/org/join`
- `POST /v1/org/invite`
- `POST /v1/org/leave`

Existing read endpoints remain:

- `POST /v1/org/list`
- `POST /v1/org/summary`
- `POST /v1/org/shared-library/manifest`
- `POST /v1/org/governance-summary`

### 9.1 Create

Input:

- `sessionId`
- organization creation input such as name

Rules:

- requester must have create permission
- creator becomes `owner`

### 9.2 Join

Input:

- `sessionId`
- target organization id

Rules:

- successful join assigns `member`

### 9.3 Invite

Input:

- `sessionId`
- target organization id
- invite target identity

Rules:

- requester role must be `owner` or `admin`

### 9.4 Leave

Input:

- `sessionId`
- target organization id

Rules:

- `member` may leave
- `admin` may leave
- `owner` leave is blocked in this milestone

## 10. Data Model

The repository model should explicitly distinguish:

- organization record
- member record
- role assignment
- shared-library ownership metadata

Conceptually:

- organization:
  - `organizationId`
  - `name`
  - `ownerUserId`
  - `sharedLibraryName`
- member:
  - `userId`
  - `organizationId`
  - `role`

The exact JSON layout may be simple, but the concepts must remain distinct.

## 11. UX Behavior

### 11.1 Create organization button

- visible/enabled only when creation permission allows it
- otherwise disabled or clearly gated

### 11.2 Invite member button

- visible/enabled for `owner` and `admin`
- hidden or disabled for `member`

### 11.3 Leave organization

- allowed for `member`
- allowed for `admin`
- blocked for `owner` with explicit explanation

### 11.4 Shared-library open behavior

No change to the user-facing interaction model:

- opening shared library replaces current workspace
- returning to local library restores local workspace semantics

## 12. Testing Strategy

### 12.1 Desktop tests

Update and expand:

- `LiteasyClaw/desktop/src/tests/LeftPane.test.tsx`
- `LiteasyClaw/desktop/src/tests/AppShell.test.tsx`
- `LiteasyClaw/desktop/src/tests/useOrganizationActions.test.ts`
- `LiteasyClaw/desktop/src/tests/useOrganizationWorkspace.test.ts`

Must cover:

- `owner` can create and invite
- `admin` can invite but is not owner
- `member` cannot invite
- create gate visibility and disabled state
- owner leave restriction
- shared-library open flow remains intact

### 12.2 Dev-cloud tests

Update:

- `LiteasyClaw/services/dev-cloud/server.test.mjs`

Add focused repository tests if needed.

Must cover:

- create assigns `owner`
- invite rejects `member`
- join assigns `member`
- leave blocks `owner`
- read endpoints reflect updated roles and ownership

### 12.3 Integration expectations

The following must stay true after F3:

- organization management still happens in desktop
- `/admin/` still does not become customer organization admin
- shared-library opening still behaves like workspace switching

## 13. Out-of-Scope Protections

To keep `F3` bounded:

- do not add new roles beyond `owner / admin / member`
- do not add approval workflow
- do not add owner transfer UI
- do not turn organization pages into a separate web admin product
- do not mix shared-library workspace switching logic into generic organization governance logic

## 14. Recommended Execution Order

1. formalize organization role and ownership types in desktop shared types
2. formalize button/state gating in desktop tests first
3. add dev-cloud organization repository and action endpoints
4. wire desktop dialogs and action hooks to the formalized endpoints
5. verify shared-library switching still works
6. update QA and handoff docs if role semantics become more explicit
