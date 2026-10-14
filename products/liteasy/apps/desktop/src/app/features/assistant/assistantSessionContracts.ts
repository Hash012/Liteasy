import { z } from "zod";
import { objectRefSchema } from "../objects/object.types";

export const assistantOriginSchema = z.object({
  kind: z.enum(["direct_chat", "conversation_action", "workflow_entry", "automation", "legacy_unknown"]),
  entryPoint: z.string().min(1),
  initiatedBy: z.object({ type: z.enum(["user", "automation", "import"]), id: z.string().min(1) }),
  parentConversationId: z.string().optional(),
  triggerMessageId: z.string().optional(),
  parentTaskId: z.string().optional()
});
export type AssistantOrigin = z.infer<typeof assistantOriginSchema>;
export const assistantTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("conversation"), conversationId: z.string().min(1) }),
  z.object({ kind: z.literal("workflow_task"), taskId: z.string().min(1) })
]);
export const assistantTaskBindingSchema = z.object({
  schemaVersion: z.literal("liteasy.workflow-task/v2"),
  taskId: z.string().min(1),
  origin: assistantOriginSchema,
  workflowId: z.string().min(1),
  workflowVersion: z.string().min(1),
  inputSnapshotId: z.string().min(1),
  runIds: z.array(z.string()),
  resultRefs: z.array(objectRefSchema),
  relatedConversationId: z.string().optional()
});
export type AssistantTaskBinding = z.infer<typeof assistantTaskBindingSchema>;
export const assistantConversationSchema = z.object({
  schemaVersion: z.literal("liteasy.conversation/v2"),
  conversationId: z.string().min(1),
  scopeId: z.string().min(1),
  origin: assistantOriginSchema,
  title: z.string(),
  titleSource: z.enum(["automatic", "model", "user"]),
  lifecycle: z.enum(["active", "archived", "tombstoned"]),
  activeBranchId: z.string().min(1),
  parentConversationId: z.string().optional(),
  branchBoundaryMessageId: z.string().optional()
});
export type AssistantPersistenceStatus = "dirty" | "saving" | "saved" | "failed" | "conflict";
