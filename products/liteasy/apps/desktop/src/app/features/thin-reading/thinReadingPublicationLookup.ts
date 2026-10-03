import { z } from "zod";
import { thinReadingSyncPayload } from "../../../../../../../intuecho/packages/contracts/src/thinReadingSyncPayload.js";
import type {
  DesktopCommunityAnnotationLookupQuery,
  DesktopCommunityAnnotationLookupResult
} from "../../../../../../../intuecho/packages/contracts/src/index.js";
import { sha256Hex } from "../paper-identity/paperIdentity";
import { normalizePublicationActorBinding, samePublicationActor, type PublicationActorBinding } from "../forum/publicationActorBinding";
import type { ThinReadingAnnotation } from "./thinReading.types";

type PendingOperation = NonNullable<ThinReadingAnnotation["publication"]>["pendingOperation"];
export type ThinReadingMatchedPublication = Extract<DesktopCommunityAnnotationLookupResult, { status: "matched" }>;

// Validate the wire response with the desktop's own schema dependency. Importing
// the forum's runtime barrel would require its separate Zod installation.
const matchedPublicationSchema: z.ZodType<ThinReadingMatchedPublication> = z.object({
  annotationId: z.string().trim().min(1).max(200),
  queueKey: z.string().trim().min(1).max(500),
  updatedAt: z.string().datetime(),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.literal("matched"),
  remoteAnnotationId: z.string().trim().min(1).max(200),
  publicationRevision: z.number().int().positive()
}).strict();

export function sameThinReadingPendingPublication(left: PendingOperation, right: PendingOperation) {
  return Boolean(left && right && left.annotationId === right.annotationId && left.queueKey === right.queueKey &&
    left.updatedAt === right.updatedAt && left.createdAt === right.createdAt &&
    left.expectedAuthorProfileRevision === right.expectedAuthorProfileRevision && thinReadingSyncPayload(left) === thinReadingSyncPayload(right));
}

// Only called by an explicit withdrawal. It sends identity/version/digest, never
// the original body, and cannot turn absence into a successful withdrawal.
export async function lookupThinReadingPublications(input: {
  actor: PublicationActorBinding;
  annotations: readonly ThinReadingAnnotation[];
  artifactId: string;
  endpoint: string;
  getActorBinding?: () => PublicationActorBinding | undefined;
  sessionId?: string;
}): Promise<Map<string, ThinReadingMatchedPublication>> {
  function assertActor() {
    if (!samePublicationActor(input.actor, input.getActorBinding?.())) throw new Error("账号或会话已变化，原发布结果仍需核实。");
  }
  assertActor();
  if (!input.sessionId || input.actor.endpoint !== normalizePublicationActorBinding({ ...input.actor, endpoint: input.endpoint })?.endpoint) {
    throw new Error("请使用原账号和原论坛端点核实发布结果。");
  }
  const queries: DesktopCommunityAnnotationLookupQuery[] = [];
  for (const annotation of input.annotations) {
    const original = annotation.publication?.pendingOperation;
    if (!samePublicationActor(annotation.publication?.actorBinding, input.actor, { includeGeneration: false }) || !original ||
        original.annotationId !== annotation.id || original.queueKey !== `${input.artifactId}:${annotation.id}` ||
        original.status !== "pending_public" || !Number.isFinite(Date.parse(original.updatedAt))) {
      throw new Error("原发布账号或请求来源无法核实；本地批注已保留。");
    }
    queries.push({ annotationId: original.annotationId, queueKey: original.queueKey, updatedAt: original.updatedAt,
      payloadDigest: sha256Hex(thinReadingSyncPayload(original)) });
  }
  assertActor();
  const response = await fetch(`${input.actor.endpoint}/v1/thin-reading/annotations:lookup`, {
    method: "POST", headers: { Authorization: `Bearer ${input.sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ queries })
  });
  assertActor();
  if (!response.ok) throw new Error("原发布结果查询暂不可用，请稍后核实；本地批注已保留。");
  const value: unknown = await response.json();
  assertActor();
  const results = value && typeof value === "object" && "results" in value && Array.isArray(value.results) ? value.results : [];
  const counts = new Map<string, number>();
  for (const result of results) {
    if (result && typeof result.queueKey === "string") counts.set(result.queueKey, (counts.get(result.queueKey) ?? 0) + 1);
  }
  const matched = new Map<string, ThinReadingMatchedPublication>();
  for (const query of queries) {
    if (counts.get(query.queueKey) !== 1) continue;
    const parsed = matchedPublicationSchema.safeParse(results.find((result) => result?.queueKey === query.queueKey));
    if (!parsed.success) continue;
    const result = parsed.data;
    if (result.annotationId === query.annotationId && result.updatedAt === query.updatedAt && result.payloadDigest === query.payloadDigest &&
        Number.isSafeInteger(result.publicationRevision) && result.publicationRevision < Number.MAX_SAFE_INTEGER) matched.set(query.annotationId, result);
  }
  return matched;
}
