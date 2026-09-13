import type { PdfQuickAskRequest } from "../features/pdf/pdfQuickAsk";
import type { ObjectRef } from "../features/objects/object.types";
import type { ContextRef } from "../features/context/objectContext";

export function usePdfQuickAskController(input: {
  capture(request: PdfQuickAskRequest): Promise<ObjectRef[]>;
  ask(question: string, refs: ContextRef[], signal?: AbortSignal): Promise<string>;
}) {
  return async (request: PdfQuickAskRequest): Promise<string> => {
    if (request.signal.aborted) throw new Error("提问已取消。");
    const refs = await input.capture(request);
    if (request.signal.aborted) throw new Error("提问已取消。");
    return input.ask(request.question, refs, request.signal);
  };
}
