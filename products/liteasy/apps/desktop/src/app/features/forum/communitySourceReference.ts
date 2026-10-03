export type CommunitySourceReference = {
  sourceNamespace: "intuecho.annotation" | "intuecho.reply" | "intuecho.literature";
  sourceId: string; revision: number;
  locator?: { kind: "whole_document" | "source_passage"; page?: number; anchorHash?: string };
};
export type CommunitySourceRevision = CommunitySourceReference & {
  currentRevision: number; historical: boolean; body?: string;
  visibility?: "private" | "organization" | "mutual_followers" | "public"; organizationId?: string;
  literature?: { literatureId: string; title: string };
};
const namespaces = ["intuecho.annotation", "intuecho.reply", "intuecho.literature"];
export function communitySourceLink(source: CommunitySourceReference) {
  const url = new URL(`liteasy://community-sources/${source.sourceNamespace}/${encodeURIComponent(source.sourceId)}`);
  url.searchParams.set("revision", String(source.revision));
  if (source.locator) {
    url.searchParams.set("kind", source.locator.kind);
    if (source.locator.page !== undefined) url.searchParams.set("page", String(source.locator.page));
    if (source.locator.anchorHash) url.searchParams.set("anchorHash", source.locator.anchorHash);
  }
  return url.toString();
}
export function parseCommunitySourceLink(link: string): CommunitySourceReference {
  const url = new URL(link), parts = url.pathname.split("/").slice(1);
  if (url.protocol !== "liteasy:" || url.hostname !== "community-sources" || url.username || url.password || url.port || url.hash || parts.length !== 2 || !namespaces.includes(parts[0]) ||
    [...url.searchParams.keys()].some((key) => !["revision", "kind", "page", "anchorHash"].includes(key)) || [...new Set(url.searchParams.keys())].some((key) => url.searchParams.getAll(key).length !== 1)) throw new Error("来源链接无效。");
  const revision = Number(url.searchParams.get("revision")), sourceId = decodeURIComponent(parts[1]);
  const page = url.searchParams.has("page") ? Number(url.searchParams.get("page")) : undefined;
  const kind = url.searchParams.get("kind") ?? (page !== undefined || url.searchParams.has("anchorHash") ? "source_passage" : undefined);
  const anchorHash = url.searchParams.get("anchorHash") ?? undefined;
  if (!sourceId.trim() || sourceId.length > 512 || /[\u0000-\u001f/\\]/.test(sourceId) || !Number.isSafeInteger(revision) || revision <= 0 ||
    (page !== undefined && (!Number.isSafeInteger(page) || page <= 0)) || (kind !== undefined && !["whole_document", "source_passage"].includes(kind)) || (anchorHash !== undefined && (anchorHash.length > 512 || !anchorHash.trim()))) throw new Error("来源链接缺少有效的修订或定位信息。");
  return { sourceNamespace: parts[0] as CommunitySourceReference["sourceNamespace"], sourceId, revision,
    ...(kind ? { locator: { kind: kind as "whole_document" | "source_passage", ...(page === undefined ? {} : { page }), ...(anchorHash ? { anchorHash } : {}) } } : {}) };
}
