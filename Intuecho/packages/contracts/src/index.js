import { z } from "zod";

const tagSchema = z.string().trim().min(1).max(32);

export const contextualDraftSchema = z.object({
  topicId: z.string().min(1),
  workId: z.string().min(1).optional(),
  page: z.number().int().positive().optional(),
  excerpt: z.string().min(8).max(2000).optional(),
  anchorHash: z.string().min(8).optional(),
  language: z.string().default("zh-CN"),
  citationEnabled: z.boolean().default(false)
}).superRefine((value, context) => {
  if (value.citationEnabled && (!value.workId || !value.page || !value.excerpt || !value.anchorHash)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["citationEnabled"], message: "启用引用时需要完整的论文、页码、摘录和文本指纹。" });
});

export const updateDraftSchema = z.object({
  body: z.string().max(4000),
  tags: z.array(tagSchema).max(5),
  citationEnabled: z.boolean(),
  topicId: z.string().min(1).optional(),
  title: z.string().max(180).optional()
});

export const createPostSchema = z.object({ draftId: z.string().min(1) });
export const createTopicSchema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().min(8).max(300) });
export const signalSchema = z.object({ signal: z.enum(["helpful", "misleading"]) });
export const createFeedbackSchema = z.object({ kind: z.enum(["bug", "idea", "experience"]), message: z.string().min(8).max(2000), context: z.string().max(300).optional() });
