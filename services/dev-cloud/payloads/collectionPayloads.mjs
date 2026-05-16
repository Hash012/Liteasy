import { listCollection, saveCollectionItem } from "../db/collectionRepository.mjs";

function isCollectionItemPayload(item) {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof item.id === "string" &&
    typeof item.reason === "string" &&
    typeof item.savedAt === "string" &&
    typeof item.source === "string" &&
    typeof item.title === "string"
  );
}

export function buildCollectionListPayload(body = {}) {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "anonymous";

  return {
    items: listCollection(sessionId)
  };
}

export function buildCollectionSavePayload(body = {}) {
  const item = body.item;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "anonymous";

  if (!isCollectionItemPayload(item)) {
    return {
      error: "invalid_collection_item"
    };
  }

  return {
    items: saveCollectionItem(sessionId, item)
  };
}
