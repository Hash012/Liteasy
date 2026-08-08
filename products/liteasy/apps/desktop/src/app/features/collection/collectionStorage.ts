import type { CollectionItem } from "./collection.types";
import { resolveLocalAccountKey } from "../library/localAccountKey";

const collectionStorageKey = "liteasy.collection.online.v1";

function scopedCollectionStorageKey() {
  return `${collectionStorageKey}:${resolveLocalAccountKey()}`;
}

function loadScopedCollectionValue() {
  const scopedKey = scopedCollectionStorageKey();
  const scopedValue = window.localStorage.getItem(scopedKey);
  if (scopedValue !== null) return scopedValue;
  const legacyValue = window.localStorage.getItem(collectionStorageKey);
  if (legacyValue !== null) {
    window.localStorage.setItem(scopedKey, legacyValue);
    window.localStorage.removeItem(collectionStorageKey);
  }
  return legacyValue;
}

function isCollectionItem(item: unknown): item is CollectionItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "id" in item &&
    typeof item.id === "string" &&
    "reason" in item &&
    typeof item.reason === "string" &&
    "savedAt" in item &&
    typeof item.savedAt === "string" &&
    "source" in item &&
    typeof item.source === "string" &&
    "title" in item &&
    typeof item.title === "string"
  );
}

export function loadStoredCollectionItems() {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }

  const rawValue = loadScopedCollectionValue();
  if (!rawValue) {
    return [];
  }

  try {
    const payload = JSON.parse(rawValue) as unknown;
    return Array.isArray(payload) ? payload.filter(isCollectionItem) : [];
  } catch {
    return [];
  }
}

export function storeCollectionItems(items: CollectionItem[]) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.setItem(scopedCollectionStorageKey(), JSON.stringify(items));
}
