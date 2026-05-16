import { readJsonFile, writeJsonFile } from "./jsonFileStore.mjs";

const collectionFilename = "collections.json";

function readCollectionState() {
  return readJsonFile(collectionFilename, {});
}

export function listCollection(sessionId) {
  const state = readCollectionState();
  return Array.isArray(state[sessionId]) ? state[sessionId] : [];
}

export function saveCollectionItem(sessionId, item) {
  const state = readCollectionState();
  const currentItems = Array.isArray(state[sessionId]) ? state[sessionId] : [];
  const nextItems = [item, ...currentItems.filter((currentItem) => currentItem.id !== item.id)];

  state[sessionId] = nextItems;
  writeJsonFile(collectionFilename, state);

  return nextItems;
}
