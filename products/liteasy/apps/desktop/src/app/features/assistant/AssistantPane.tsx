import type { HTMLAttributes, ReactNode } from "react";

/** The dock view has no ownership of runs, queues or persistence. */
export function AssistantPane({ conversationStarted, children, ...events }:
  HTMLAttributes<HTMLDivElement> & { conversationStarted: boolean }) {
  return <div {...events} className={conversationStarted ? "assistant-pane in-conversation" : "assistant-pane initial-session"}>{children}</div>;
}

export function AssistantTranscript({ task, children }: { task: boolean; children: ReactNode }) {
  return task ? <details className="assistant-transcript-surface"><summary>运行日志</summary>{children}</details>
    : <div className="assistant-transcript-surface">{children}</div>;
}
