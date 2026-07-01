import type { CollectionItem } from "./collection.types";

const collectionStorageKey = "liteasy.collection.online.v1";

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

  const rawValue = window.localStorage.getItem(collectionStorageKey);
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

  window.localStorage.setItem(collectionStorageKey, JSON.stringify(items));
}
