import { parseLiteasyPath } from "../resource-filesystem/liteasyPath";

export type AssistantAssetWrite = {
  path: string;
  revision?: string;
  title: string;
  changed: boolean;
  addedLines: number;
  removedLines: number;
  warnings?: string[];
};

/** Accept only host write receipts, never infer a saved file from answer text. */
export function parseAssistantAssetWrites(value: unknown): AssistantAssetWrite[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const results: AssistantAssetWrite[] = [];
  for (const receipt of value.slice(-50)) {
    if (!receipt || typeof receipt !== "object") continue;
    const { asset, changed, addedLines, removedLines, warnings } = receipt;
    if (!asset || typeof asset.path !== "string" || typeof asset.title !== "string" ||
      !asset.title.trim() || typeof changed !== "boolean" || !Number.isSafeInteger(addedLines) || addedLines < 0 ||
      !Number.isSafeInteger(removedLines) || removedLines < 0) continue;
    try { parseLiteasyPath(asset.path, new URL(asset.path).searchParams.get("scope") ?? "local"); } catch { continue; }
    results.push({ path: asset.path, revision: typeof asset.revision === "string" ? asset.revision : undefined, title: asset.title.slice(0, 500), changed, addedLines, removedLines,
      warnings: Array.isArray(warnings) ? warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 5) : undefined });
  }
  return results.length ? results : undefined;
}


export function mergeAssistantAssetWrites(previous: AssistantAssetWrite[] = [], incoming: AssistantAssetWrite[] = []) {
  return [...new Map([...previous, ...incoming].map((write) => [`${write.path}\n${write.revision ?? ""}`, write])).values()];
}


export function parseSavedAssistantAssetWrites(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return parseAssistantAssetWrites(value.map((write) => write && typeof write === "object"
    ? { ...write, asset: { path: write.path, title: write.title, revision: write.revision } } : null));
}
