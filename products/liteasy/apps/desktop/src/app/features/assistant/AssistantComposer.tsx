import { useRef, type RefObject } from "react";
import { Tooltip } from "@fluentui/react-components";
import { MicRegular, SendRegular } from "@fluentui/react-icons";
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
  const highlightRef = useRef<HTMLDivElement>(null);
  const commands = suggestions.filter((item) => item.trigger === "/")
    .map((item) => item.insertText ?? `/${item.label}`).sort((a, b) => b.length - a.length);
  const highlightedInput = [];
  let offset = 0;
  while (offset < input.length) {
    const command = commands.find((value) => input.startsWith(value, offset) &&
      (offset === 0 || /\s/.test(input[offset - 1])));
    if (command) {
      highlightedInput.push(<mark className="assistant-command-chip" key={offset}>{command}</mark>);
      offset += command.length;
    } else {
      highlightedInput.push(input[offset++]);
    }
  }
  const activeTrigger = getActiveTrigger(input);
  const visibleSuggestions = activeTrigger
    ? suggestions
        .filter((suggestion) => suggestion.trigger === activeTrigger.trigger)
        .filter((suggestion) => matchesSuggestion(suggestion, activeTrigger.query))
        .slice(0, activeTrigger.trigger === "/" ? undefined : 8)
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

    onInputChange(`${beforeTrigger}${suggestion.insertText ?? suggestion.label}${suggestion.trigger === "/" ? " " : ""}${afterTrigger}`);
    inputRef?.current?.focus();
  }

  const lastToken = contextTokens[contextTokens.length - 1];

  return (
    <div className="assistant-input-wrap">
      {pending ? (
        <div className="assistant-command-feedback">
          当前回复仍在执行；发送的新消息会先暂存，可随后选择执行时机。
        </div>
      ) : null}
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
      <div className="assistant-input-editor">
      <div aria-hidden="true" className="assistant-input-highlight" ref={highlightRef}>{highlightedInput}{"\n"}</div>
      <textarea
        className="assistant-input"
        onScroll={(event) => {
          if (highlightRef.current) {
            highlightRef.current.scrollTop = event.currentTarget.scrollTop;
            highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
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
          onSend();
        }}
        placeholder="输入你的问题或命令"
        rows={4}
        title={modeHint}
        value={input}
      />
      </div>
      <div className="assistant-composer-actions">
        <Tooltip content="语音输入（预留）" positioning="above" relationship="description">
          <button
            aria-label="语音输入（预留）"
            className="assistant-voice-button assistant-icon-button"
            onClick={onVoiceInput}
            title="语音输入（预留）"
            type="button"
          >
            <MicRegular />
          </button>
        </Tooltip>
        <Tooltip content={editing ? "更新并发送" : "发送消息"} positioning="above" relationship="description">
          <button
            aria-label={editing ? "更新并发送" : "发送"}
            className="assistant-send assistant-icon-button"
            onClick={onSend}
            title={editing ? "更新并发送" : "发送"}
            type="button"
          >
            <SendRegular />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
