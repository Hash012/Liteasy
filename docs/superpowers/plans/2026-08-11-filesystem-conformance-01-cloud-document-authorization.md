# Cloud Document Authorization Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent organization members from bypassing `export_policy` through the inline PDF download endpoint while preserving read-only document authorization.

**Architecture:** Keep scope authorization centralized in `authorizeLibraryScope`. Classify `/authorize` as a read-only metadata/grant check, and classify both byte-streaming routes, `/download` and `/export`, as export operations before the repository looks up or opens the document.

**Tech Stack:** Node.js 20+, ECMAScript modules, Node test runner.

## Global Constraints

- The confirmed source of truth is `docs/design/Liteasy-文件系统与存储边界设计.md`, especially sections 10.2, 12.2, 17.2, 18.3, and 19.2.
- Organization owners always retain export access; admins and members follow `export_policy`.
- `/v1/library/documents/authorize` must continue to require only read access and must not open object storage.
- Authorization must fail before `getDownloadablePdf` so forbidden users cannot probe document existence.
- Do not change user-scope behavior, response disposition, storage access, or audit action names.

---

### Task 1: Enforce export policy on every PDF byte-streaming route

**Files:**
- Modify: `products/liteasy/services/api/src/server.test.mjs:1280`
- Modify: `products/liteasy/services/api/src/server.mjs:910`

**Interfaces:**
- Consumes: `authorizeLibraryScope(pool, identity, input, capability)` where `capability` is `"read"` or `"export"`.
- Produces: route classification in which only `/v1/library/documents/authorize` uses `"read"`; `/download` and `/export` use `"export"`.

- [x] **Step 1: Write the failing route regression test**

Replace the export-only policy test with a table-driven assertion covering both byte-streaming routes:

```js
test("enforces organization export policy before every PDF byte stream lookup", async () => {
  for (const route of ["download", "export"]) {
    const instance = runtime();
    instance.pool.query = async () => ({ rows: [{
      export_policy: "disabled",
      member_role: "member",
      member_status: "active",
      organization_status: "active",
      owner_subject: "owner_1",
      upload_policy: "owner_admins"
    }] });
    const handler = createCloudRequestHandler(instance, {
      allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
    });
    const result = response();
    await handler(request("POST", `/v1/library/documents/${route}`, {
      documentId: "document_1", scopeId: "organization_1", scopeType: "organization"
    }), result);

    assert.equal(result.status, 403);
    assert.equal(jsonBody(result).code, "organization_export_forbidden");
    assert.equal(instance.calls.some((call) => call.documentId), false);
  }
});
```

- [x] **Step 2: Run the test and verify the download case fails**

Run: `cd products/liteasy/services/api && node --test src/server.test.mjs`

Expected: FAIL because `/v1/library/documents/download` returns `200` instead of `403`; the existing `/export` case remains denied.

- [x] **Step 3: Classify only authorization as read access**

In `server.mjs`, derive the authorization capability independently from response presentation:

```js
const accessCapability = url.pathname.endsWith("/authorize") ? "read" : "export";
const mode = url.pathname.endsWith("/export") ? "export" : "download";
const scope = await authorizeLibraryScope(
  runtime.pool,
  identity,
  body,
  accessCapability
);
```

Keep `mode`, content disposition, and audit action selection unchanged so `/download` remains inline and records `download_pdf` after export authorization succeeds.

- [x] **Step 4: Run focused authorization tests**

Run: `cd products/liteasy/services/api && node --test src/libraryAuthorization.test.mjs src/server.test.mjs`

Expected: PASS with both test files successful and zero failures.

- [x] **Step 5: Run the formal API test suite**

Run: `cd products/liteasy/services/api && npm test`

Expected: PASS with zero failures.

- [x] **Step 6: Commit the focused repair**

```bash
git add docs/superpowers/plans/2026-08-11-filesystem-conformance-01-cloud-document-authorization.md products/liteasy/services/api/src/server.mjs products/liteasy/services/api/src/server.test.mjs
git commit -m "fix: enforce organization PDF export policy"
```
