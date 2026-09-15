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
    // Drawing and text-box anchors locate a page region without quoting PDF text.
    quote: quote.extend({ exact: z.string() }),
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
