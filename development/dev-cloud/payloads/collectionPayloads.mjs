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

export function buildCollectionListPayload(body, repository) {
  return {
    items: repository.list(body.sessionId, body.status)
  };
}

export function buildCollectionSavePayload(body, repository) {
  if (!isCollectionItemPayload(body.item)) {
    return { error: "invalid_collection_item" };
  }
  return {
    items: repository.save(body.sessionId, body.item)
  };
}
