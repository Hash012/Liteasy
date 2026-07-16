import type { RefObject } from "react";
import type { AssistantComposerSuggestion, AssistantContextToken } from "./assistant.types";

type ActiveTrigger = {
  query: string;
  start: number;
  trigger: AssistantComposerSuggestion["trigger"];
};

type AssistantComposerProps = {
  contextTokens?: AssistantContextToken[];
  editing?: boolean;
  input: string;
  inputRef?: RefObject<HTMLTextAreaElement>;
  modeHint: string;
  onCancelEdit?: () => void;
  onAddContextToken?: (token: AssistantContextToken) => void;
  onInputChange: (value: string) => void;
  onRemoveContextToken?: (tokenId: string) => void;
  onSend: () => void;
  onVoiceInput: () => void;
  pending?: boolean;
  suggestions?: AssistantComposerSuggestion[];
  voiceInputMessage?: string;
};

function getActiveTrigger(input: string): ActiveTrigger | null {
  const match = /(^|\s)([/@$])([^\s]*)$/.exec(input);
  if (!match || match.index === undefined) {
    return null;
  }

  return {
    query: match[3] ?? "",
    start: match.index + (match[1]?.length ?? 0),
    trigger: match[2] as ActiveTrigger["trigger"]
  };
}

function matchesSuggestion(suggestion: AssistantComposerSuggestion, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return `${suggestion.label} ${suggestion.detail ?? ""}`.toLowerCase().includes(normalizedQuery);
}

export function AssistantComposer({
  contextTokens = [],
  editing = false,
  input,
  inputRef,
  modeHint,
  onCancelEdit,
  onAddContextToken,
  onInputChange,
  onRemoveContextToken,
  onSend,
  onVoiceInput,
  pending = false,
  suggestions = [],
  voiceInputMessage
}: AssistantComposerProps) {
  const activeTrigger = getActiveTrigger(input);
  const visibleSuggestions = activeTrigger
    ? suggestions
        .filter((suggestion) => suggestion.trigger === activeTrigger.trigger)
        .filter((suggestion) => matchesSuggestion(suggestion, activeTrigger.query))
        .slice(0, 8)
    : [];

  function selectSuggestion(suggestion: AssistantComposerSuggestion) {
    if (!activeTrigger) {
      return;
    }

    const beforeTrigger = input.slice(0, activeTrigger.start);
    const afterTrigger = input.slice(activeTrigger.start).replace(/^[/@$][^\s]*/, "");
    if (suggestion.token) {
      onAddContextToken?.(suggestion.token);
      onInputChange(`${beforeTrigger}${afterTrigger}`.replace(/\s{2,}/g, " "));
      inputRef?.current?.focus();
      return;
    }

    onInputChange(`${beforeTrigger}${suggestion.insertText ?? suggestion.label}${afterTrigger}`);
    inputRef?.current?.focus();
  }

  const lastToken = contextTokens[contextTokens.length - 1];

  return (
    <div className="assistant-input-wrap">
      {pending ? <div className="assistant-command-feedback">AI 正在整理回答...</div> : null}
      {editing ? (
        <div className="assistant-editing-banner">
          <span>正在重新编辑上一条输入</span>
          <button className="assistant-editing-cancel" onClick={onCancelEdit} type="button">
            取消编辑
          </button>
        </div>
      ) : null}
      {voiceInputMessage ? (
        <div className="assistant-voice-placeholder">{voiceInputMessage}</div>
      ) : null}
      {contextTokens.length > 0 ? (
        <div aria-label="已添加到对话上下文" className="assistant-context-token-row">
          {contextTokens.map((token) => (
            <button
              aria-label={`移除上下文：${token.label}`}
              className={`assistant-context-token ${token.kind}`}
              key={token.id}
              onClick={() => onRemoveContextToken?.(token.id)}
              title={token.detail ?? token.prompt}
              type="button"
            >
              <strong>{token.label}</strong>
              {token.detail ? <span>{token.detail}</span> : null}
              <span aria-hidden="true" className="assistant-context-token-remove">x</span>
            </button>
          ))}
        </div>
      ) : null}
      {visibleSuggestions.length > 0 ? (
        <div aria-label="输入候选" className="assistant-suggestion-menu">
          {visibleSuggestions.map((suggestion) => (
            <button
              className="assistant-suggestion-item"
              key={suggestion.id}
              onMouseDown={(event) => {
                event.preventDefault();
                selectSuggestion(suggestion);
              }}
              type="button"
            >
              <span className="assistant-suggestion-trigger">{suggestion.trigger}</span>
              <span className="assistant-suggestion-main">
                <strong>{suggestion.label}</strong>
                {suggestion.detail ? <span>{suggestion.detail}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        className="assistant-input"
        ref={inputRef}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Backspace" &&
            input.length === 0 &&
            lastToken &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            onRemoveContextToken?.(lastToken.id);
            return;
          }

          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            visibleSuggestions.length > 0
          ) {
            event.preventDefault();
            selectSuggestion(visibleSuggestions[0]);
            return;
          }

          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
            return;
          }

          event.preventDefault();
          if (!pending) {
            onSend();
          }
        }}
        placeholder="输入消息，使用 /、@、$ 添加指令、论文或 skill"
        rows={4}
        title={modeHint}
        value={input}
      />
      <div className="assistant-composer-actions">
        <button
          aria-label="语音输入（预留）"
          className="assistant-voice-button"
          onClick={onVoiceInput}
          type="button"
        >
          语音
        </button>
        <button className="assistant-send" type="button" onClick={onSend} disabled={pending}>
          {editing ? "更新并发送" : "发送"}
        </button>
      </div>
    </div>
  );
}
