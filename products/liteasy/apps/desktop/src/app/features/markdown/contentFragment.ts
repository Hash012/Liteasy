import { z } from "zod";

const range = z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), unit: z.literal("utf16") })
  .refine(value => value.end >= value.start, "Invalid range");
export const contentFragmentSchema = z.strictObject({
  schema: z.literal("liteasy.content-fragment/v1"),
  binding: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("pinned"), path: z.string().startsWith("liteasy://"), revision: z.string().min(1), scopeId: z.string().min(1) }),
    z.strictObject({ kind: z.literal("legacy-unpinned"), reason: z.string().min(1) }),
  ]),
  representationId: z.string().min(1),
  sourceLine: z.number().int().positive().optional(),
  profile: z.enum(["liteasy-research-markdown/v1", "literal/v1"]),
  exactSelection: z.strictObject({ text: z.string(), ranges: z.array(range).max(1000) }),
  viewContext: z.strictObject({ text: z.string().max(200000), ranges: z.array(range).max(1000), segments: z.array(z.strictObject({ outputStart: z.number().int().nonnegative(), outputEnd: z.number().int().nonnegative(), sourceRange: range })).optional(), expansion: z.enum(["none", "enclosing-block", "dependency-closure"]), materialBeyondSelection: z.boolean() }),
  integrity: z.enum(["complete", "structured-partial", "incomplete-snapshot", "budget-exceeded"]),
  mapping: z.enum(["exact-utf16", "unavailable"]),
  warnings: z.array(z.string().max(2000)).max(20),
}).brand<"HostContentFragment">();
export type ContentFragment = z.infer<typeof contentFragmentSchema>;
/** Central compatibility adapter: old strings do not acquire a revision or exact source position. */
export function legacyContent(text: string, profile: ContentFragment["profile"] = "liteasy-research-markdown/v1"): ContentFragment {
  return contentFragmentSchema.parse({ schema: "liteasy.content-fragment/v1", binding: { kind: "legacy-unpinned", reason: "历史正文未保存来源版本" },
    representationId: "legacy-text", profile, exactSelection: { text, ranges: [] },
    viewContext: { text: text.length > 200000 ? "" : text, ranges: [], expansion: "none", materialBeyondSelection: false },
    integrity: text.length > 200000 ? "budget-exceeded" : "incomplete-snapshot", mapping: "unavailable", warnings: text.length > 200000 ? ["budget_exceeded"] : [] });
}
