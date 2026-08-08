import { useEffect, useState } from "react";
import type { AccountSession } from "../account/account.types";
import type { CollectionItem } from "./collection.types";
import { loadCloudCollectionItems, saveCloudCollectionItem } from "./collectionRuntime";
import type { CollectionTransport } from "./collectionClient";

type RecommendationCollectionInput = {
  id: string;
  reason: string;
  source: string;
  title: string;
};

type UseCollectionItemsInput = {
  accountSession?: AccountSession | null;
  controlPlaneEndpoint?: string;
  transport?: CollectionTransport;
};

type CollectionStatus = "idle" | "loading" | "ready" | "error";

export function useCollectionItems({
  accountSession = null,
  controlPlaneEndpoint = "http://127.0.0.1:8787",
  transport
}: UseCollectionItemsInput = {}) {
  const [collectionItems, setCollectionItems] = useState<CollectionItem[]>([]);
  const [status, setStatus] = useState<CollectionStatus>(accountSession ? "loading" : "idle");
  const [message, setMessage] = useState(
    accountSession ? "正在同步云端收藏..." : "登录后可用的云端收藏会显示在这里。"
  );

  async function syncCloudCollection() {
    if (!accountSession) {
      setStatus("idle");
      setMessage("登录后可用的云端收藏会显示在这里。");
      return;
    }

    setStatus("loading");
    setMessage("正在同步云端收藏...");

    const items = await loadCloudCollectionItems(
      {
        controlPlaneEndpoint,
        session: accountSession
      },
      {
        transport
      }
    );

    setCollectionItems(items);
    setStatus("ready");
    setMessage("已同步云端收藏。");
  }

  useEffect(() => {
    if (!accountSession) {
      setStatus("idle");
      setMessage("登录后可用的云端收藏会显示在这里。");
      return;
    }

    let active = true;

    setStatus("loading");
    setMessage("正在同步云端收藏...");

    void loadCloudCollectionItems(
      {
        controlPlaneEndpoint,
        session: accountSession
      },
      {
        transport
      }
    )
      .then((items) => {
        if (!active) {
          return;
        }

        setCollectionItems(items);
        setStatus("ready");
        setMessage("已同步云端收藏。");
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setStatus("error");
        setMessage("云端收藏暂时不可用。");
      });

    return () => {
      active = false;
    };
  }, [accountSession?.sessionId, controlPlaneEndpoint, transport]);

  async function collectRecommendation(recommendation: RecommendationCollectionInput) {
    if (!accountSession) {
      setStatus("idle");
      setMessage("登录后才能收藏关联推荐。");
      throw new Error("登录后才能收藏关联推荐。");
    }
    const nextItem = {
      ...recommendation,
      savedAt: new Date().toISOString()
    };
    const cloudItems = await saveCloudCollectionItem(
      {
        controlPlaneEndpoint,
        item: nextItem,
        session: accountSession
      },
      {
        transport
      }
    );
    setCollectionItems(cloudItems);
    setStatus("ready");
    setMessage("已同步云端收藏。");
  }

  return {
    collectRecommendation,
    collectionItems,
    message,
    retry: syncCloudCollection,
    status
  };
}
