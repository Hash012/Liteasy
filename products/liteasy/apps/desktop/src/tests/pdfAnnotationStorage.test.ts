import { afterEach, expect, test } from "vitest";
import {
  clearMigratedPdfAnnotationBrowserCache,
  confirmPdfAnnotationPublication,
  loadPdfAnnotationBrowserMigrationState,
  normalizePdfAnnotationPrivateState,
  normalizePdfAnnotations,
  revisePdfAnnotation,
  savePdfAnnotationAutoPublic,
  savePdfAnnotations,
  type PdfAnnotation
} from "../app/features/pdf/pdfAnnotationStorage";

const annotationKey = "liteasy.pdf-annotations/v1:test:paper";
const autoPublicKey = "liteasy.pdf-annotations-auto-public/v1:test:paper";

function setTauriRuntime(enabled: boolean) {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: enabled ? { invoke() {} } : undefined
  });
}

function annotation(id: string, updatedAt = "2026-08-07T00:00:00.000Z"): PdfAnnotation {
  return {
    createdAt: "2026-08-06T00:00:00.000Z",
    excerpt: id,
    id,
    kind: "note",
    page: 1,
    paperIdentity: {
      candidates: [],
      paperId: "paper-1",
      primary: { kind: "local", value: "paper-1" },
      title: "Paper"
    },
    rects: [],
    text: id,
    updatedAt,
    visibility: "private"
  };
}

const fallbackIdentity = {
  candidates: [],
  paperId: "paper-legacy",
  primary: { id: "doi:10.1000/legacy", kind: "doi" as const, source: "metadata" as const, value: "10.1000/legacy" },
  title: "Legacy paper"
};

function legacyAnnotation(input: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-08-06T00:00:00.000Z",
    excerpt: "Legacy excerpt",
    id: "legacy-annotation",
    kind: "note",
    page: 2,
    paperIdentity: fallbackIdentity,
    rects: [],
    text: "Legacy annotation",
    updatedAt: "2026-08-07T00:00:00.000Z",
    visibility: "private",
    ...input
  };
}

afterEach(() => {
  window.localStorage.clear();
  setTauriRuntime(false);
});

test("migrates a synced v1 annotation to confirmed published state", () => {
  const [normalized] = normalizePdfAnnotations([legacyAnnotation({
    syncState: {
      intuechoAnnotationId: "annotation-remote",
      status: "synced",
      syncedAt: "2026-08-07T01:00:00.000Z"
    },
    visibility: "pending_public"
  })], fallbackIdentity);

  expect(normalized.publication).toMatchObject({
    desiredVisibility: "public",
    remoteAnnotationId: "annotation-remote",
    state: "published"
  });
  expect(normalized.revision).toBe(1);
  expect(normalized).not.toHaveProperty("syncState");
  expect(normalized).not.toHaveProperty("visibility");
});

test.each([
  ["private", undefined, { desiredVisibility: "private", state: "not_published" }],
  ["pending_public", undefined, { desiredVisibility: "public", state: "pending_create" }],
  ["pending_public", { error: "offline", lastAttemptAt: "2026-08-07T01:00:00.000Z", status: "failed" },
    { desiredVisibility: "public", lastError: "offline", state: "failed" }],
  ["pending_public", { forumDraftId: "legacy-handoff", status: "synced", syncedAt: "2026-08-07T01:00:00.000Z" },
    { desiredVisibility: "public", lastError: expect.stringContaining("legacy-handoff"), state: "failed" }]
])("normalizes v1 visibility %s without inventing remote publication success", (visibility, syncState, expected) => {
  const [normalized] = normalizePdfAnnotations([legacyAnnotation({ syncState, visibility })], fallbackIdentity);
  expect(normalized.publication).toMatchObject(expected);
  expect(normalized.revision).toBe(1);
});

test("normalizes annotation snapshots to version 2", () => {
  expect(normalizePdfAnnotationPrivateState({
    annotations: [legacyAnnotation()],
    autoPublic: true,
    version: 1
  }, fallbackIdentity)).toMatchObject({
    annotations: [expect.objectContaining({ revision: 1 })],
    autoPublic: true,
    version: 2
  });
});

test("increments the local revision for body target and publication-intent edits", () => {
  const [current] = normalizePdfAnnotations([legacyAnnotation()], fallbackIdentity);
  const bodyEdit = revisePdfAnnotation(current, {
    note: "Edited note",
    updatedAt: "2026-08-07T01:00:00.000Z"
  });
  const targetEdit = revisePdfAnnotation(bodyEdit, {
    excerpt: "Edited excerpt",
    rects: [{ height: 3, left: 1, top: 2, width: 4 }],
    updatedAt: "2026-08-07T02:00:00.000Z"
  });
  const intentEdit = revisePdfAnnotation(targetEdit, {
    publication: { desiredVisibility: "public", state: "pending_create" },
    updatedAt: "2026-08-07T03:00:00.000Z"
  });

  expect([current.revision, bodyEdit.revision, targetEdit.revision, intentEdit.revision]).toEqual([1, 2, 3, 4]);
});

test("confirms a retract as not published while retaining the remote audit identity", () => {
  const current = revisePdfAnnotation(normalizePdfAnnotations([legacyAnnotation()], fallbackIdentity)[0], {
    publication: {
      desiredVisibility: "private",
      remoteAnnotationId: "annotation-remote",
      remoteRevision: 4,
      state: "pending_retract"
    },
    updatedAt: "2026-08-07T01:00:00.000Z"
  });

  expect(confirmPdfAnnotationPublication(current, {
    annotationId: current.id,
    queueKey: `${current.paperIdentity.paperId}:${current.id}`,
    remoteAnnotationId: "annotation-remote",
    remoteRevision: 5,
    state: "retracted",
    syncedAt: "2026-08-07T02:00:00.000Z"
  }).publication).toEqual({
    desiredVisibility: "private",
    remoteAnnotationId: "annotation-remote",
    remoteRevision: 5,
    state: "not_published"
  });
});

test("keeps browser-only annotation persistence for non-Tauri development", () => {
  savePdfAnnotations(annotationKey, [annotation("annotation-1")]);
  savePdfAnnotationAutoPublic(autoPublicKey, true);

  expect(window.localStorage.getItem(annotationKey)).toContain("annotation-1");
  expect(window.localStorage.getItem(autoPublicKey)).toBe("true");
});

test("uses paper-artifacts as the Tauri truth source and clears migrated browser copies", () => {
  window.localStorage.setItem(annotationKey, "legacy annotations");
  window.localStorage.setItem(autoPublicKey, "true");
  setTauriRuntime(true);

  savePdfAnnotations(annotationKey, [annotation("new-annotation")]);
  savePdfAnnotationAutoPublic(autoPublicKey, false);
  expect(window.localStorage.getItem(annotationKey)).toBe("legacy annotations");
  expect(window.localStorage.getItem(autoPublicKey)).toBe("true");

  clearMigratedPdfAnnotationBrowserCache(annotationKey, autoPublicKey);
  expect(window.localStorage.getItem(annotationKey)).toBeNull();
  expect(window.localStorage.getItem(autoPublicKey)).toBeNull();
});

test("merges all legacy account-scoped annotations before making the library account-neutral", () => {
  const otherAnnotationKey = "liteasy.pdf-annotations/v1:other-account:test:paper";
  const corruptAnnotationKey = "liteasy.pdf-annotations/v1:corrupt-account:test:paper";
  const otherAutoPublicKey = "liteasy.pdf-annotations-auto-public/v1:other-account:test:paper";
  window.localStorage.setItem(annotationKey, JSON.stringify([
    annotation("shared-id", "2026-08-07T00:00:00.000Z")
  ]));
  window.localStorage.setItem(otherAnnotationKey, JSON.stringify([
    annotation("shared-id", "2026-08-07T01:00:00.000Z"),
    annotation("other-account-note")
  ]));
  window.localStorage.setItem(corruptAnnotationKey, "not-json");
  window.localStorage.setItem(otherAutoPublicKey, "true");
  setTauriRuntime(true);

  const migrated = loadPdfAnnotationBrowserMigrationState(annotationKey, autoPublicKey);
  expect(migrated?.annotations.map((item) => item.id).sort()).toEqual([
    "other-account-note",
    "shared-id"
  ]);
  expect(migrated?.annotations.find((item) => item.id === "shared-id")?.updatedAt)
    .toBe("2026-08-07T01:00:00.000Z");
  expect(migrated?.autoPublic).toBe(true);

  clearMigratedPdfAnnotationBrowserCache(annotationKey, autoPublicKey);
  expect(window.localStorage.getItem(otherAnnotationKey)).toBeNull();
  expect(window.localStorage.getItem(corruptAnnotationKey)).toBeNull();
  expect(window.localStorage.getItem(otherAutoPublicKey)).toBeNull();
});
