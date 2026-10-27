import { DisclosureSection } from "../../shared/ui/productPrimitives";
import type { HTMLAttributes, ReactNode } from "react";

/** The dock view has no ownership of runs, queues or persistence. */
export function AssistantPane({ conversationStarted, compact = false, children, ...events }:
  HTMLAttributes<HTMLDivElement> & { conversationStarted: boolean; compact?: boolean }) {
  return <div {...events} className={`assistant-pane ${conversationStarted ? "in-conversation" : "initial-session"}${compact ? " compact-bottom" : ""}`}>{children}</div>;
}

export function AssistantTranscript({ task, children, details }: { task: boolean; children: ReactNode; details?: ReactNode }) {
  return task ? <DisclosureSection className="assistant-transcript-surface assistant-task-run-details" title="运行详情">{details}{children}</DisclosureSection>
    : <div className="assistant-transcript-surface">{children}</div>;
}
