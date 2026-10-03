import { z } from "zod";

const identifier = z.string().trim().min(1).max(200);
export const communityPreferenceSchema = z.object({
  targetKind: z.enum(["thread", "literature", "organization", "author"]),
  targetId: identifier,
  subscribed: z.boolean(),
  muted: z.boolean(),
  blocked: z.boolean()
}).strict().superRefine((value, ctx) => {
  if (value.blocked && value.targetKind !== "author") ctx.addIssue({ code: "custom", path: ["blocked"], message: "Only authors can be hidden." });
  if (value.subscribed && value.targetKind === "author") ctx.addIssue({ code: "custom", path: ["subscribed"], message: "Choose a thread, literature, or organization." });
});
export const communityReportSchema = z.object({
  revision: z.number().int().positive(),
  reason: z.enum(["spam", "harassment", "privacy", "other"]),
  detail: z.string().trim().min(8).max(1000)
}).strict();
export const communityReportResolutionSchema = z.object({
  status: z.enum(["resolved", "dismissed"]),
  reason: z.enum(["reviewed", "insufficient_evidence", "duplicate", "outside_scope"])
}).strict();
