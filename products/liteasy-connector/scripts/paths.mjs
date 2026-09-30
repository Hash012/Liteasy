import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const upstream = resolve(process.env.LITEASY_CONNECTOR_UPSTREAM || resolve(root, ".cache/zotero-connectors"));
export const translators = resolve(process.env.LITEASY_CONNECTOR_TRANSLATORS || resolve(root, ".cache/zotero-translators"));
export const dist = resolve(root, "dist/chromium");
