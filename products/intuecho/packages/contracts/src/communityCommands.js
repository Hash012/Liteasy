import { z } from "zod";
import { createAnnotationSchema, createReplySchema } from "./index.js";

export const communityCommandSchema = z.object({
  protocolVersion: z.literal(1), operationId: z.string().uuid(), bodyDigest: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export const communitySourceReferenceSchema = z.object({
  sourceNamespace: z.enum(["intuecho.annotation", "intuecho.reply", "intuecho.literature"]),
  sourceId: z.string().min(1).max(200), revision: z.number().int().positive(),
  locator: z.object({ kind: z.enum(["whole_document", "source_passage"]), page: z.number().int().positive().optional(), anchorHash: z.string().min(1).max(200).optional() }).strict().optional()
}).strict();
export const collaborationMetadataSchema = z.object({
  schemaVersion: z.literal(1), kind: z.enum(["reading_pack", "question", "host_summary", "dissent", "reflection"]),
  parentPackId: z.string().min(1).max(200).optional(), sourceRefs: z.array(communitySourceReferenceSchema).max(100),
  discussionDueAt: z.string().datetime({ offset: true }).optional()
}).strict().superRefine((value, context) => {
  if (value.kind === "reading_pack" ? value.parentPackId !== undefined : !value.parentPackId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["parentPackId"], message: "Collaboration parent must match its kind." });
  }
});
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
  return value;
}
/** SHA-256 this UTF-8 string. Defaults/trim/schema normalization match the server. */
export function communityCommandPayload(operationType, targetId, input) {
  if (!["create_annotation", "create_reply"].includes(operationType)) throw new Error("INVALID_COMMAND_TYPE");
  if (operationType === "create_annotation" ? targetId != null : typeof targetId !== "string" || !targetId) throw new Error("INVALID_COMMAND_TARGET");
  const { command: ignored, ...payload } = (operationType === "create_annotation" ? createAnnotationSchema : createReplySchema).parse(input);
  return JSON.stringify(canonical({ protocolVersion: 1, operationType, targetId: targetId ?? null, payload }));
}
