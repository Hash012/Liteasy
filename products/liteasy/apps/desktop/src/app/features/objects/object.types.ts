import { z } from "zod";

const id = z.string().min(1).max(512);
export const objectRefSchema = z.strictObject({
  objectId: id,
  revision: id,
  selectorId: id.optional(),
});
export type ObjectRef = z.infer<typeof objectRefSchema>;
const quote = z.strictObject({
  exact: z.string().min(1),
  prefix: z.string(),
  suffix: z.string(),
});
const range = z.strictObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
const rect = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});
export const anchorSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("pdf"),
    sourceRef: objectRefSchema,
    documentHash: z.string().optional(),
    page: z.number().int().positive(),
    displayPage: z.string().optional(),
    quote,
    range: range.optional(),
    rects: z.array(rect),
    extractor: id,
    normalization: id,
    precision: z.enum(["exact", "page"]),
  }),
  z.strictObject({
    type: z.literal("text"),
    sourceRef: objectRefSchema,
    blockId: id,
    quote,
    range: range.optional(),
  }),
  z.strictObject({
    type: z.literal("semantic"),
    sourceRef: objectRefSchema,
    semanticObjectId: id,
  }),
  z.strictObject({
    type: z.literal("table"),
    sourceRef: objectRefSchema,
    rowId: id,
    columnId: id,
  }),
]);
export type ObjectAnchor = z.infer<typeof anchorSchema>;
const block = z.discriminatedUnion("type", [
  z.strictObject({
    blockId: id,
    type: z.literal("markdown"),
    text: z.string(),
    sourceRefs: z.array(objectRefSchema),
  }),
  z.strictObject({
    blockId: id,
    type: z.literal("reference"),
    ref: objectRefSchema,
    sourceRefs: z.array(objectRefSchema),
  }),
]);
const content = <T extends z.ZodType>(schema: string, payload: T) =>
  z.strictObject({ schema: z.literal(schema), payload });
export const objectContentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("source.document"),
    content: content(
      "liteasy.source-document/v1",
      z.strictObject({
        paperId: id,
        pages: z
          .array(
            z.strictObject({
              page: z.number().int().positive(),
              text: z.string(),
            }),
          )
          .optional(),
        abstractText: z.string().optional(),
        literatureId: id.optional(),
        documentHash: z.string().optional(),
        text: z.string(),
        availability: z.enum(["local", "unavailable"]),
        legacyKey: id,
      }),
    ),
  }),
  z.strictObject({
    kind: z.literal("content.fragment"),
    content: content(
      "liteasy.fragment/v1",
      z.strictObject({
        text: z.string().min(1),
        anchors: z.array(anchorSchema).min(1),
        partial: z.boolean(),
      }),
    ),
  }),
  z.strictObject({
    kind: z.literal("content.note"),
    content: content(
      "liteasy.note/v1",
      z.strictObject({
        text: z.string(),
        origin: z.enum(["user", "external", "derived"]),
        assetIds: z.array(id).optional(),
      }),
    ),
  }),
  z.strictObject({
    kind: z.literal("conversation.message"),
    content: content(
      "liteasy.message/v1",
      z.strictObject({
        messageId: id,
        blockId: id,
        text: z.string(),
        partial: z.boolean(),
      }),
    ),
  }),
  z.strictObject({
    kind: z.literal("artifact.document"),
    content: content(
      "liteasy.document/v1",
      z.strictObject({
        blocks: z.array(block),
        legacyArtifactId: id.optional(),
      }),
    ),
  }),
  z.strictObject({
    kind: z.literal("workspace.board"),
    content: content(
      "liteasy.board/v1",
      z.strictObject({ description: z.string(), paperId: id.optional() }),
    ),
  }),
]);
export type ObjectContent = z.infer<typeof objectContentSchema>;
export const objectMetadataSchema = z.strictObject({
  schemaVersion: z.literal("liteasy.object/v1"),
  objectId: id,
  revision: id,
  title: z.string().max(1000),
  scopeId: id,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  createdBy: z.strictObject({ type: z.enum(["user", "agent", "import"]), id }),
  assets: z.array(
    z.strictObject({
      assetId: id,
      mediaType: id,
      byteLength: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
  provenance: z.strictObject({
    sourceRefs: z.array(objectRefSchema),
    runId: id.optional(),
    contextSnapshotId: id.optional(),
    derivedFrom: z.array(objectRefSchema).optional(),
  }),
  lifecycle: z.enum(["active", "archived", "tombstoned"]),
});
export const objectEnvelopeSchema = z.union(
  objectContentSchema.options.map((variant) =>
    objectMetadataSchema.extend(variant.shape),
  ),
);
export type ObjectEnvelope = z.infer<typeof objectMetadataSchema> &
  ObjectContent;
export function parseObject(value: unknown): ObjectEnvelope {
  const { kind, content, ...metadata } = (value ?? {}) as Record<
    string,
    unknown
  >;
  const meta = objectMetadataSchema.safeParse(metadata);
  const body = objectContentSchema.safeParse({ kind, content });
  if (!meta.success || !body.success)
    throw new ObjectStoreError(
      "unsupported_schema",
      "内容格式暂不支持，请导出原始数据或更新应用。",
    );
  return { ...meta.data, ...body.data };
}
export function refOf(object: ObjectEnvelope): ObjectRef {
  return { objectId: object.objectId, revision: object.revision };
}
export function objectText(object: ObjectEnvelope): string {
  if (object.lifecycle === "tombstoned") return "";
  switch (object.kind) {
    case "workspace.board":
      return object.content.payload.description;
    case "artifact.document":
      return object.content.payload.blocks
        .map((b) => (b.type === "markdown" ? b.text : objectLink(b.ref)))
        .join("\n\n");
    default:
      return object.content.payload.text;
  }
}
export function objectLink(ref: ObjectRef): string {
  const query = new URLSearchParams({ revision: ref.revision });
  if (ref.selectorId) query.set("selector", ref.selectorId);
  return `liteasy://objects/${encodeURIComponent(ref.objectId)}?${query}`;
}
export function parseObjectLink(
  link: string,
): { objectId: string; revision?: string; selectorId?: string } | null {
  try {
    const url = new URL(link);
    if (
      url.protocol !== "liteasy:" ||
      url.hostname !== "objects" ||
      url.username ||
      url.password
    )
      return null;
    const objectId = decodeURIComponent(url.pathname.slice(1));
    if (!objectId || objectId.includes("/")) return null;
    return {
      objectId,
      revision: url.searchParams.get("revision") || undefined,
      selectorId: url.searchParams.get("selector") || undefined,
    };
  } catch {
    return null;
  }
}
export const relationSchema = z.strictObject({
  relationId: id,
  revision: id,
  from: objectRefSchema,
  to: objectRefSchema,
  predicate: z.enum(["references", "derived_from", "related_to", "member_of"]),
  scopeId: id,
  assertedBy: z.strictObject({ type: z.enum(["user", "agent", "import"]), id }),
  createdAt: z.iso.datetime(),
  basis: z.strictObject({
    type: z.enum([
      "user_judgment",
      "model_inference",
      "source_statement",
      "operation",
    ]),
    reason: z.string(),
  }),
  reviewStatus: z.enum(["proposed", "accepted", "rejected"]),
});
export type ObjectRelation = z.infer<typeof relationSchema>;
export const placementSchema = z.strictObject({
  placementId: id,
  revision: id,
  boardId: id,
  ref: objectRefSchema,
  position: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
  size: z.strictObject({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  viewId: id,
  collapsed: z.boolean(),
});
export type Placement = z.infer<typeof placementSchema>;
export type ObjectErrorCode =
  | "object_not_found"
  | "object_forbidden"
  | "revision_conflict"
  | "anchor_unresolved"
  | "unsupported_schema"
  | "context_budget_exceeded"
  | "persistence_failed"
  | "capability_denied"
  | "operation_cancelled";
export class ObjectStoreError extends Error {
  constructor(
    public code: ObjectErrorCode,
    message: string,
  ) {
    super(message);
  }
}
