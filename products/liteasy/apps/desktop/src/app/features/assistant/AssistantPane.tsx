import type { HTMLAttributes } from "react";

/** The dock view has no ownership of runs, queues or persistence. */
export function AssistantPane({ conversationStarted, children, ...events }:
  HTMLAttributes<HTMLDivElement> & { conversationStarted: boolean }) {
  return <div {...events} className={conversationStarted ? "assistant-pane in-conversation" : "assistant-pane initial-session"}>{children}</div>;
}
