import { z } from "zod";
export const extensionSkillSchema = z.strictObject({ schema: z.literal("liteasy.skill/v2"), id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9.-]*$/), title: z.string().min(1).max(120), description: z.string().min(1).max(2000), instructions: z.string().max(30000), workflow: z.strictObject({ id: z.string(), version: z.string().regex(/^\d+\.\d+\.\d+$/) }), examples: z.array(z.string().max(2000)).max(20).default([]) });
export type ExtensionSkill = z.infer<typeof extensionSkillSchema>;
