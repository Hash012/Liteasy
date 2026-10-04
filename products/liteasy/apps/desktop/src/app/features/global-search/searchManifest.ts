import { contentFingerprint, type SemanticIndex } from "../semantic-index/semanticIndexClient";

export const searchManifestPath = "global-search:manifest";
const encoder = new TextEncoder();
function fingerprints(value: unknown): value is Record<string, string> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.values(value).every((item) => typeof item === "string"));
}
/** Each SQLite cache payload is capped at 64 KB; large vaults need a paged manifest. */
export async function readSearchManifest(index: SemanticIndex, signal: AbortSignal) {
  const rootRow = (await index.lookup([searchManifestPath], signal))[0];
  const root = rootRow?.payload;
  const missing = { valid: false, entries: {} as Record<string, string> };
  if (fingerprints(root)) return { valid: true, entries: root }; // Existing flat manifests remain readable.
  const paged = root as { version?: unknown; pages?: unknown } | undefined;
  if (paged?.version !== 2 || !Array.isArray(paged.pages) || !paged.pages.length || paged.pages.length > 128
    || !paged.pages.every((id) => typeof id === "string" && id.startsWith(`${searchManifestPath}:`))) return missing;
  const entries: Record<string, string> = Object.create(null);
  for (let offset = 0; offset < paged.pages.length; offset += 64) {
    const ids = paged.pages.slice(offset, offset + 64) as string[];
    const rows = new Map((await index.lookup(ids, signal)).map((row) => [row.id, row]));
    for (const id of ids) {
      const row = rows.get(id);
      if (!row || row.path !== searchManifestPath || row.revision !== rootRow?.revision || !fingerprints(row.payload)) return missing;
      Object.assign(entries, row.payload);
    }
  }
  return { valid: true, entries };
}

/** Write root last: interruption cannot advertise an incomplete set of pages as reusable. */
export async function writeSearchManifest(index: SemanticIndex, entries: Record<string, string>, signal: AbortSignal) {
  const serialized = JSON.stringify(entries);
  // The index replaces all records of a path when its revision changes. Every
  // page and the root therefore share one generation, just like document chunks.
  const revision = await contentFingerprint(serialized);
  const write = async (id: string, payload: unknown) => index.upsert([{ id, path: searchManifestPath,
    revision, text: "", tokens: "", payload }], signal);
  if (encoder.encode(serialized).length < 60000) { await write(searchManifestPath, entries); return; }
  const pages: string[] = [];
  let page: Record<string, string> = Object.create(null), size = 2;
  const flush = async () => {
    const id = `${searchManifestPath}:${pages.length}`;
    await write(id, page); pages.push(id); page = Object.create(null); size = 2;
  };
  for (const [key, value] of Object.entries(entries)) {
    const bytes = encoder.encode(JSON.stringify(key)).length + encoder.encode(JSON.stringify(value)).length + 2;
    if (size + bytes > 48000 && size > 2) await flush();
    page[key] = value; size += bytes;
  }
  if (size > 2) await flush();
  await write(searchManifestPath, { version: 2, pages });
}
