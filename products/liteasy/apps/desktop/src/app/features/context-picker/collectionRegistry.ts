import { readPickerRecord, writePickerRecord } from "./pickerState";

export type PickerCollection = { id: string; title: string; memberIds: string[]; parentId?: string; updatedAt?: string; tags?: string[] };
type LegacyRegistry = { version: 1; collections: PickerCollection[] };
/** Compatibility identity map, not a second library. Explicit collection IDs always win. */
export function reconcileLegacyCollections(scope: string, entries: readonly { id: string; collection?: string }[], explicit: PickerCollection[] = []): PickerCollection[] {
  const key = `liteasy:context-picker:collections:${scope}`;
  const saved = readPickerRecord<LegacyRegistry>(key);
  const old = saved?.version === 1 && Array.isArray(saved.collections) ? saved.collections.filter(item => typeof item?.id === "string" && typeof item.title === "string" && Array.isArray(item.memberIds) && item.memberIds.every(id => typeof id === "string")) : [];
  const groups = new Map<string, string[]>();
  for (const entry of entries) if (entry.collection?.trim()) { const title = entry.collection.trim(), members = groups.get(title) ?? []; members.push(entry.id); groups.set(title, members); }
  const sameMembers = (a: string[], b: string[]) => { const ids = new Set(b); return a.length === b.length && a.every(id => ids.has(id)); };
  const used = new Set<string>();
  const next = [...groups].map(([title, memberIds]) => {
    // A unique, unchanged membership can retain its identity after a legacy label rename.
    const rename = old.filter(item => !groups.has(item.title) && !used.has(item.id) && sameMembers(item.memberIds, memberIds));
    const previous = old.find(item => item.title === title) ?? (rename.length === 1 ? rename[0] : undefined);
    const id = previous?.id ?? `collection:${crypto.randomUUID()}`; used.add(id);
    return { id, title, memberIds };
  });
  writePickerRecord(key, { version: 1, collections: next });
  return [...explicit, ...next.filter(item => !explicit.some(value => value.title === item.title && sameMembers(value.memberIds, item.memberIds)))];
}
