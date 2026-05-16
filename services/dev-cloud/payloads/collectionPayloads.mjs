const collectionItemsBySession = new Map();

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
    items: [...(collectionItemsBySession.get(sessionId) ?? [])]
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

  const currentItems = collectionItemsBySession.get(sessionId) ?? [];
  const nextItems = [item, ...currentItems.filter((currentItem) => currentItem.id !== item.id)];
  collectionItemsBySession.set(sessionId, nextItems);

  return {
    items: nextItems
  };
}
