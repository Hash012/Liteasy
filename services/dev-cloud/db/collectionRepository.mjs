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

export function resetCollectionData() {
  writeJsonFile(collectionFilename, {});
  return {
    reset: true
  };
}

export function reseedCollectionData() {
  const nextState = {
    "demo-session-1": [
      {
        id: "rec-bert-1",
        reason: "同样关注大规模预训练语言模型的迁移能力。",
        savedAt: "2026-05-14T10:30:00.000Z",
        source: "Semantic Scholar",
        title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
      }
    ]
  };
  writeJsonFile(collectionFilename, nextState);
  return nextState;
}
