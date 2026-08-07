import { afterEach, expect, test } from "vitest";
import {
  clearMigratedPdfAnnotationBrowserCache,
  loadPdfAnnotationBrowserMigrationState,
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

afterEach(() => {
  window.localStorage.clear();
  setTauriRuntime(false);
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
