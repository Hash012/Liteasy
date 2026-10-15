export const MAX_RESOURCE_TAGS = 50;
export const MAX_RESOURCE_TAG_LENGTH = 60;

export function normalizeResourceTag(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

/** The same equality used by catalog search; keep the first display spelling. */
export function resourceTagKey(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Reading existing values never truncates a saved label or drops overflow tags. */
export function normalizeResourceTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = normalizeResourceTag(item);
    const key = resourceTagKey(tag);
    if (key && !unique.has(key)) unique.set(key, tag);
  }
  return [...unique.values()];
}

export function parseResourceTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) throw new Error("标签格式无效，请重新输入。");
  const tags = normalizeResourceTags(value);
  if (tags.length > MAX_RESOURCE_TAGS) throw new Error(`最多添加 ${MAX_RESOURCE_TAGS} 个标签，请先移除多余标签。`);
  if (tags.some((tag) => [...tag].length > MAX_RESOURCE_TAG_LENGTH)) throw new Error(`每个标签最多 ${MAX_RESOURCE_TAG_LENGTH} 个字符，请缩短后再保存。`);
  return tags;
}

export function splitResourceTags(value: string) {
  return normalizeResourceTags(value.split(/[,，;；\r\n]/u));
}
