import type { QuickAskGenerationReceipt } from "./pdfQuickAsk";
import { isQuickAskGenerationReceipt } from "../../../../../../packages/reading-core/src/quickAskValidation";
export type QuickAskTransferInput = { paperTitle: string; excerpt: string; answer: string; receipt: QuickAskGenerationReceipt };
export type QuickAskTransferResult = { conversationId: string };
type Handler = (input: QuickAskTransferInput, destinationConversationId: string) => Promise<QuickAskTransferResult>;
const handlers = new Map<string, Handler>();
export function registerQuickAskTransfer(scopeId: string, handler: Handler) {
  handlers.set(scopeId, handler);
  return () => { if (handlers.get(scopeId) === handler) handlers.delete(scopeId); };
}
/** Explicit host action only. No model call, default target, or composer append. */
export async function transferQuickAskToConversation(input: QuickAskTransferInput): Promise<QuickAskTransferResult> {
  if (!input || typeof input.excerpt !== "string" || !input.excerpt.trim() || typeof input.answer !== "string" || !input.answer.trim() || typeof input.paperTitle !== "string" || !isQuickAskGenerationReceipt(input.receipt) || input.receipt.terminal !== "completed") throw new Error("速问来源或完成回执不可用，无法转到对话。");
  const handler = handlers.get(input.receipt.context.source.scopeId);
  if (!handler) throw new Error("该账号的对话尚未就绪，请稍后重试。");
  const destination = `quick-ask:${input.receipt.attemptId}`;
  return handler(structuredClone(input), destination);
}
