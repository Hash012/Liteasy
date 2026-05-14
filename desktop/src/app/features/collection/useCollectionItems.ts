import { useState } from "react";
import type { CollectionItem } from "./collection.types";
import {
  loadStoredCollectionItems,
  storeCollectionItems
} from "./collectionStorage";

type RecommendationCollectionInput = {
  id: string;
  reason: string;
  source: string;
  title: string;
};

export function useCollectionItems() {
  const [collectionItems, setCollectionItems] = useState<CollectionItem[]>(() =>
    loadStoredCollectionItems()
  );

  function collectRecommendation(recommendation: RecommendationCollectionInput) {
    const nextItems = [
      {
        ...recommendation,
        savedAt: new Date().toISOString()
      },
      ...collectionItems.filter((item) => item.id !== recommendation.id)
    ];
    setCollectionItems(nextItems);
    storeCollectionItems(nextItems);
  }

  return {
    collectRecommendation,
    collectionItems
  };
}
