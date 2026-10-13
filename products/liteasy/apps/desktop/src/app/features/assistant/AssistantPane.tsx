import { DisclosureSection } from "../../shared/ui/productPrimitives";
import type { HTMLAttributes, ReactNode } from "react";

/** The dock view has no ownership of runs, queues or persistence. */
export function AssistantPane({ conversationStarted, children, ...events }:
  HTMLAttributes<HTMLDivElement> & { conversationStarted: boolean }) {
  return <div {...events} className={conversationStarted ? "assistant-pane in-conversation" : "assistant-pane initial-session"}>{children}</div>;
}

export function AssistantTranscript({ task, children, details }: { task: boolean; children: ReactNode; details?: ReactNode }) {
  return task ? <DisclosureSection className="assistant-transcript-surface assistant-task-run-details" title="运行详情">{details}{children}</DisclosureSection>
    : <div className="assistant-transcript-surface">{children}</div>;
}
