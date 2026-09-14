import { useEffect, useState } from "react";
import type { ObjectRepository } from "../objects/objectRepository";
export function ObjectAssetImage({
  repository,
  assetId,
  maxHeight = 240,
  alt = "保存的图片",
}: {
  repository: ObjectRepository;
  assetId: string;
  maxHeight?: number;
  alt?: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      objectUrl = "";
    void repository
      .readAsset(assetId)
      .then((asset) => {
        if (!active) return;
        const bytes = Uint8Array.from(atob(asset.base64), (c) =>
          c.charCodeAt(0),
        );
        objectUrl = URL.createObjectURL(
          new Blob([bytes], { type: asset.mediaType }),
        );
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setError("图片不可用，文字内容仍保留。");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [repository, assetId]);
  return url ? (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      style={{ maxWidth: "100%", maxHeight }}
    />
  ) : (
    <span>{error || "图片加载中…"}</span>
  );
}
