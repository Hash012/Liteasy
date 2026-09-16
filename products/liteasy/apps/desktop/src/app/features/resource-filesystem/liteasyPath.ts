import { z } from "zod";
import { objectRefSchema } from "../objects/object.types";
import { validateNotePath } from "../note-files/noteFileService";

const id = z.string().min(1).max(2048);
export const resourceTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("object"), ref: objectRefSchema, followLatest: z.boolean().optional() }),
  z.strictObject({ kind: z.literal("paper"), paperId: id }),
  z.strictObject({ kind: z.literal("artifact"), artifactId: id }),
  z.strictObject({ kind: z.literal("external-file"), mountId: id, path: id }),
  z.strictObject({ kind: z.literal("pdf-annotation"), paperId: id, annotationId: id }),
  z.strictObject({ kind: z.literal("artifact-annotation"), artifactId: id, annotationId: id }),
]);
export type ResourceTarget = z.infer<typeof resourceTargetSchema>;
export type ResourceLocation = { liteasyPath: string; physicalPath: string; physicalKind: "file" | "database" | "browser" | "cloud" | "unavailable"; canReveal: boolean };

/** A locator grants no authority. Every consumer resolves it in the active scope. */
export function liteasyPath(scope: string, raw: ResourceTarget) {
  const target = resourceTargetSchema.parse(raw);
  const query = new URLSearchParams({ scope });
  let host: string, parts: string[];
  switch (target.kind) {
    case "object":
      host = "objects"; parts = [target.ref.objectId];
      if (!target.followLatest) query.set("revision", target.ref.revision);
      if (target.ref.selectorId) query.set("selector", target.ref.selectorId);
      break;
    case "paper": host = "papers"; parts = [target.paperId]; break;
    case "artifact": host = "agent-artifacts"; parts = [target.artifactId]; break;
    case "external-file":
      validateNotePath(target.path); host = "files"; parts = [target.mountId, ...target.path.split("/")]; break;
    case "pdf-annotation": host = "paper-annotations"; parts = [target.paperId, target.annotationId]; break;
    case "artifact-annotation": host = "artifact-annotations"; parts = [target.artifactId, target.annotationId]; break;
  }
  return `liteasy://${host}/${parts.map(encodeURIComponent).join("/")}?${query}`;
}

export function parseLiteasyPath(value: string, scope: string): ResourceTarget {
  if (value.length > 8192) throw new Error("Liteasy Path 过长。");
  const rawPath = value.trim().split("?")[0].replace(/^liteasy:\/\/[^/]+\//, "");
  if (rawPath.split("/").some((part) => [".", ".."].includes(decodeURIComponent(part))))
    throw new Error("Liteasy Path 不允许相对路径跳转。");
  const url = new URL(value.trim());
  if (url.protocol !== "liteasy:" || url.username || url.password || url.port || url.hash)
    throw new Error("请输入有效的 Liteasy Path。");
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !["scope", "revision", "selector"].includes(key)) || new Set(keys).size !== keys.length)
    throw new Error("Liteasy Path 参数无效。");
  if (url.searchParams.has("scope") && url.searchParams.get("scope") !== scope)
    throw new Error("此 Liteasy Path 属于其他账户，不能加入当前上下文。");
  const parts = url.pathname.slice(1).split("/").map(decodeURIComponent);
  if (parts.some((part) => !part || part === "." || part === ".." || /[\x00-\x1f]/.test(part)))
    throw new Error("Liteasy Path 路径无效。");
  // Object and paper identities are opaque and can contain encoded slash characters.
  let target: ResourceTarget;
  if (url.hostname === "objects" && parts.length === 1) {
    target = { kind: "object", ref: { objectId: parts[0], revision: url.searchParams.get("revision") || "latest",
      ...(url.searchParams.get("selector") ? { selectorId: url.searchParams.get("selector")! } : {}) },
      followLatest: !url.searchParams.has("revision") };
  } else if (url.hostname === "papers" && parts.length === 1) target = { kind: "paper", paperId: parts[0] };
  else if (url.hostname === "agent-artifacts" && parts.length === 1) target = { kind: "artifact", artifactId: parts[0] };
  else if (url.hostname === "files" && parts.length >= 2) {
    if (parts.slice(1).some((part) => part.includes("/"))) throw new Error("文件路径编码无效。");
    target = { kind: "external-file", mountId: parts[0], path: parts.slice(1).join("/") };
    validateNotePath(target.path);
  } else if (url.hostname === "paper-annotations" && parts.length === 2) target = { kind: "pdf-annotation", paperId: parts[0], annotationId: parts[1] };
  else if (url.hostname === "artifact-annotations" && parts.length === 2) target = { kind: "artifact-annotation", artifactId: parts[0], annotationId: parts[1] };
  else throw new Error("此 Liteasy Path 类型尚不可读取，请从资源的“位置与 Liteasy Path”复制地址。");
  if (target.kind !== "object" && (url.searchParams.has("revision") || url.searchParams.has("selector")))
    throw new Error("此资源路径不支持指定版本或选区。");
  return resourceTargetSchema.parse(target);
}
