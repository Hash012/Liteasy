import { ResourceFileError } from "./resourceFile.types";

export const maximumResourceBytes = 12 * 1024 * 1024;

/** Bound model/stored JSON before recursively copying, hashing or rendering it. */
export function canonicalResourceJson(value: unknown): string {
  const ancestors = new Set<object>();
  let items = 0;
  let characters = 0;
  const visit = (entry: unknown, depth: number): unknown => {
    items += 1;
    if (characters > maximumResourceBytes) throw new ResourceFileError("read_limit_exceeded", "资源内容超过 12 MiB 上限。");
    if (depth > 64 || items > 200_000) throw new ResourceFileError("invalid_content", "资源结构过大或嵌套过深。");
    if (entry === null || typeof entry === "boolean") return entry;
    if (typeof entry === "number" && Number.isFinite(entry)) return entry;
    if (typeof entry === "string") {
      characters += entry.length;
      if (characters > maximumResourceBytes) throw new ResourceFileError("read_limit_exceeded", "资源内容超过 12 MiB 上限。");
      return entry;
    }
    if (typeof entry !== "object" || ancestors.has(entry)) {
      throw new ResourceFileError("invalid_content", "资源正文必须是无循环的 JSON 内容。");
    }
    ancestors.add(entry);
    const normalized = Array.isArray(entry)
      ? entry.map((item) => visit(item, depth + 1))
      : Object.fromEntries(Object.entries(entry).filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
          .map(([key, item]) => {
            characters += key.length;
            return [key, visit(item, depth + 1)];
          }));
    ancestors.delete(entry);
    return normalized;
  };
  const json = JSON.stringify(visit(value, 0));
  if (new TextEncoder().encode(json).byteLength > maximumResourceBytes) {
    throw new ResourceFileError("read_limit_exceeded", "资源内容超过 12 MiB 上限。");
  }
  return json;
}

export async function resourceContentRevision(content: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function resourceFileStem(title: string) {
  const stem = title.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim().slice(0, 100);
  return !stem || /^(?:CON|PRN|AUX|NUL|COM\d|LPT\d)(?:\.|$)/i.test(stem) ? `Liteasy-${stem || "resource"}` : stem;
}
