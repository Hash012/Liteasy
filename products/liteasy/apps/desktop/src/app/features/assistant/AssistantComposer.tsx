import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { Tooltip } from "@fluentui/react-components";
import { MicRegular, SendRegular } from "@fluentui/react-icons";
import type { AssistantComposerSuggestion, AssistantContextToken } from "./assistant.types";
import { createAssistantSuggestionIndex } from "./assistantSuggestionIndex";

const emptySuggestions: AssistantComposerSuggestion[] = [];

type ActiveTrigger = {
  query: string;
  start: number;
  end: number;
  trigger: AssistantComposerSuggestion["trigger"];
};

type AssistantComposerProps = {
  contextTokens?: AssistantContextToken[];
  contextLoading?: boolean;
  editing?: boolean;
  input: string;
  inputRef?: RefObject<HTMLTextAreaElement>;
  modeHint: string;
  onCancelEdit?: () => void;
  onAddContextToken?: (token: AssistantContextToken) => void;
  onInputChange: (value: string) => void;
  onPasteLiteasyPath?: (path: string) => void;
  onResolveContextToken?: (resolve: () => Promise<AssistantContextToken>) => void;
  onRemoveContextToken?: (tokenId: string) => void;
  onSend: () => void;
  onVoiceInput: () => void;
  pending?: boolean;
  suggestions?: AssistantComposerSuggestion[];
  voiceInputMessage?: string;
};

function getActiveTrigger(input: string, caret: number): ActiveTrigger | null {
  const beforeCaret = input.slice(0, caret);
  // Mentions may contain spaces and nested paths. Commands finish at a space.
  const match = /(?:^|\s)([/\$][^\s]*)$|(@[^@\n]*)$/.exec(beforeCaret);
  if (!match || match.index === undefined) return null;
  const value = match[1] ?? match[2];
  const suffix = /^[^\s@]*/.exec(input.slice(caret))?.[0] ?? "";
  return { query: value.slice(1), start: caret - value.length, end: caret + suffix.length,
    trigger: value[0] as ActiveTrigger["trigger"] };
}


export function AssistantComposer({
  contextTokens = [],
  contextLoading = false,
  editing = false,
  input,
  inputRef,
  modeHint,
  onCancelEdit,
  onAddContextToken,
  onInputChange,
  onPasteLiteasyPath,
  onResolveContextToken,
  onRemoveContextToken,
  onSend,
  onVoiceInput,
  pending = false,
  suggestions = emptySuggestions,
  voiceInputMessage
}: AssistantComposerProps) {
  const localInputRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = inputRef ?? localInputRef;
  const menuId = useId();
  const [caret, setCaret] = useState(input.length);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); setActiveIndex(0); }, [input]);
  useEffect(() => {
    document.getElementById(`${menuId}-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, menuId]);
  const highlightRef = useRef<HTMLDivElement>(null);
  const suggestionIndex = useMemo(() => createAssistantSuggestionIndex(suggestions), [suggestions]);
  const highlightedInput = useMemo(() => {
    if (!input.includes("/")) return input;
    const highlighted = [];
    let offset = 0;
    while (offset < input.length) {
      const command = suggestionIndex.commands.find((value) => input.startsWith(value, offset) &&
        (offset === 0 || /\s/.test(input[offset - 1])));
      if (command) {
        highlighted.push(<mark className="assistant-command-chip" key={offset}>{command}</mark>);
        offset += command.length;
      } else highlighted.push(input[offset++]);
    }
    return highlighted;
  }, [input, suggestionIndex]);
  const activeTrigger = dismissed ? null : getActiveTrigger(input, Math.min(caret, input.length));
  const visibleSuggestions = activeTrigger
    ? suggestionIndex.search(activeTrigger.trigger, activeTrigger.query)
    : emptySuggestions;

  function selectSuggestion(suggestion: AssistantComposerSuggestion) {
    if (!activeTrigger) {
      return;
    }

    const beforeTrigger = input.slice(0, activeTrigger.start);
    const afterTrigger = input.slice(activeTrigger.end);
    if (suggestion.token || suggestion.resolveToken) {
      if (suggestion.resolveToken) onResolveContextToken?.(suggestion.resolveToken);
      else if (suggestion.token) onAddContextToken?.(suggestion.token);
      onInputChange(`${beforeTrigger}${afterTrigger}`.replace(/\s{2,}/g, " "));
      editorRef.current?.focus();
      return;
    }

    onInputChange(`${beforeTrigger}${suggestion.insertText ?? suggestion.label}${suggestion.trigger === "/" ? " " : ""}${afterTrigger}`);
    editorRef.current?.focus();
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
        <div aria-label="输入候选" id={menuId} role="group" className={`assistant-suggestion-menu${activeTrigger?.trigger === "/" ? " commands" : ""}`}>
          {visibleSuggestions.map((suggestion, index) => (
            <button
              className={`assistant-suggestion-item${index === activeIndex ? " active" : ""}`}
              id={`${menuId}-${index}`}
              aria-current={index === activeIndex}
              onMouseMove={() => setActiveIndex(index)}
              key={suggestion.id}
              title={`${suggestion.label}${suggestion.detail ? ` · ${suggestion.detail}` : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
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
        onPaste={(event) => {
          const text = event.clipboardData.getData("text/plain").trim();
          if (onPasteLiteasyPath && /^liteasy:\/\/\S+$/.test(text)) {
            event.preventDefault();
            onPasteLiteasyPath(text);
          }
        }}
        className="assistant-input"
        onScroll={(event) => {
          if (highlightRef.current) {
            highlightRef.current.scrollTop = event.currentTarget.scrollTop;
            highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
        ref={editorRef}
        aria-controls={visibleSuggestions.length ? menuId : undefined}
        aria-expanded={visibleSuggestions.length > 0}
        aria-activedescendant={visibleSuggestions.length ? `${menuId}-${Math.min(activeIndex, visibleSuggestions.length - 1)}` : undefined}
        onChange={(event) => {
          setCaret(event.target.selectionStart);
          onInputChange(event.target.value);
        }}
        onSelect={(event) => { setCaret(event.currentTarget.selectionStart); }}
        onKeyDown={(event) => {
          if (visibleSuggestions.length && !event.nativeEvent.isComposing) {
            if (event.key === "Escape") { event.preventDefault(); setDismissed(true); return; }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + visibleSuggestions.length) % visibleSuggestions.length);
              return;
            }
            if (event.key === "Tab") {
              event.preventDefault();
              selectSuggestion(visibleSuggestions[Math.min(activeIndex, visibleSuggestions.length - 1)]);
              return;
            }
          }
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
            selectSuggestion(visibleSuggestions[Math.min(activeIndex, visibleSuggestions.length - 1)]);
            return;
          }

          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
            return;
          }

          event.preventDefault();
          if (!contextLoading) onSend();
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
            disabled={contextLoading}
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
