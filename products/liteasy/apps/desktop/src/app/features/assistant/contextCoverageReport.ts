import { z } from "zod";

const count = z.number().int().nonnegative();
const schema = z.object({
  total: count, full: count, partial: count, omitted: count,
  items: z.array(z.object({ title: z.string(), status: z.enum(["full", "partial", "omitted"]),
    includedCharacters: count, totalCharacters: count })).max(500),
});
export type ContextCoverageReport = z.infer<typeof schema>;
export function parseContextCoverageReport(value: unknown) {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
