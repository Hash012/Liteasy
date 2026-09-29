import { z } from "zod";

/** Separate from the v1 object/placement schema: styling never rewrites content. */
export const blockPresentationSchema = z.strictObject({
  schema: z.literal("liteasy.block-presentation/v1"),
  fontFamily: z.string().max(512).refine((value) => !/[\x00-\x1f;{}<>]/.test(value)).optional(),
  fontSize: z.number().finite().min(10).max(72).optional(),
  lineHeight: z.number().finite().min(1).max(3).optional(),
  wrap: z.boolean().optional(),
  locked: z.boolean().optional(),
  layer: z.number().int().min(0).max(10000).optional(),
});
export type BlockPresentation = z.infer<typeof blockPresentationSchema>;
export const defaultBlockPresentation: BlockPresentation = { schema: "liteasy.block-presentation/v1" };
export type BlockPresentationRecord = { version: string | null; value: BlockPresentation };

export function mergeBlockPresentation(board?: BlockPresentation, block?: BlockPresentation): BlockPresentation {
  return { ...defaultBlockPresentation, ...board, ...block };
}

export function parseBlockPresentation(value: unknown): BlockPresentation | undefined {
  const result = blockPresentationSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
