import { isResearchSkillPosition } from "../research-skills/researchSkillCommand";
import { ActionButton as Button } from "../../shared/ui/productPrimitives";
import { ContextAssetThumbnail } from "./ContextAssetThumbnail";
import "../models/assistantModelPicker.css";
import { displayPath } from "../resource-filesystem/displayPath";
import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Popover, PopoverSurface, PopoverTrigger, Slider, Tooltip, useRestoreFocusTarget } from "@fluentui/react-components";
import { thinkingDepths, thinkingDepthLabels, type ThinkingDepth } from "./thinkingDepth";
import { DismissRegular, AddRegular, BrainCircuitRegular, EyeRegular, FlashRegular, GridRegular, MicRegular, SendRegular } from "@fluentui/react-icons";
import type { AgentContextUsage, AssistantComposerSuggestion, AssistantContextToken } from "./assistant.types";
import { createAssistantSuggestionIndex } from "./assistantSuggestionIndex";
import { ContextAssetBrowser } from "./ContextAssetBrowser";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import { inlineContextParts, insertContextNames, shortContextName, type ContextInsertion } from "./inlineContext";

import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { ResourceLink } from "../resource-links/ResourceReferenceView";
import { ResourceReferencesContext } from "../resource-links/ResourceReferencesContext";
import { liteasyPath } from "../resource-filesystem/liteasyPath";

const emptySuggestions: AssistantComposerSuggestion[] = [];

type ActiveTrigger = {
  query: string;
  start: number;
  end: number;
  trigger: AssistantComposerSuggestion["trigger"];
};

type AssistantComposerProps = {
  researchSelection?: ReactNode;
  researchSelected?: boolean;
  onSelectResearchSkill?: (skill: import("../research-skills/researchDocument").ResearchSkillRef) => void;
  contextUsage?: AgentContextUsage;
  modelPicker?: ReactNode;
  thinkingDepth?: ThinkingDepth;
  onThinkingDepthChange?: (depth: ThinkingDepth) => void;
  thinkingRules?: ReactNode;
  contextTokens?: AssistantContextToken[];
  contextLoading?: boolean;
  contextScopeId?: string;
  editing?: boolean;
  input: string;
  inputRef?: RefObject<HTMLTextAreaElement>;
  modeHint: string;
  onCancelEdit?: () => void;
  onAddContextToken?: (token: AssistantContextToken, insertion?: ContextInsertion) => void;
  onInputChange: (value: string) => void;
  onHistoryChange?: (direction: -1 | 1) => void;
  onPasteLiteasyPath?: (path: string) => void;
  onResolveContextToken?: (resolve: () => Promise<AssistantContextToken>, insertion?: ContextInsertion) => void | Promise<boolean | void>;
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
  if (value.startsWith("$") && !isResearchSkillPosition(input, caret - value.length)) return null;
  const suffix = /^[^\s@]*/.exec(input.slice(caret))?.[0] ?? "";
  return { query: value.slice(1), start: caret - value.length, end: caret + suffix.length,
    trigger: value[0] as ActiveTrigger["trigger"] };
}


export function AssistantComposer({
  researchSelection, researchSelected, onSelectResearchSkill,
  contextUsage,
  modelPicker,
  thinkingDepth = "balanced",
  onThinkingDepthChange,
  thinkingRules,
  contextTokens = [],
  contextLoading = false,
  contextScopeId,
  editing = false,
  input,
  inputRef,
  modeHint,
  onCancelEdit,
  onAddContextToken,
  onInputChange,
  onHistoryChange,
  onPasteLiteasyPath,
  onResolveContextToken,
  onRemoveContextToken,
  onSend,
  onVoiceInput,
  pending = false,
  suggestions = emptySuggestions,
  voiceInputMessage
}: AssistantComposerProps) {
  const { tChinese } = useUiTranslation();
  const references = useContext(ResourceReferencesContext);
  const localInputRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = inputRef ?? localInputRef;
  const menuId = useId();
  const [caret, setCaret] = useState(input.length);
  const [textSelected, setTextSelected] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const restoreContextFocus = useRestoreFocusTarget();
  const [browserQuery, setBrowserQuery] = useState<string | null>(null);
  const [browserPreviewId, setBrowserPreviewId] = useState<string>();
  const insertionCaret = useRef<number>();
  const browserInsertion = useRef<ContextInsertion>();
  useEffect(() => { setBrowserQuery(null); }, [contextScopeId]);
  useEffect(() => { setDismissed(false); setActiveIndex(0); }, [input]);
  useEffect(() => {
    if (insertionCaret.current === undefined) return;
    const position = insertionCaret.current;
    insertionCaret.current = undefined;
    editorRef.current?.setSelectionRange(position, position);
    setCaret(position);
  }, [input, editorRef]);
  useEffect(() => {
    document.getElementById(`${menuId}-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, menuId]);
  const highlightRef = useRef<HTMLDivElement>(null);
  const suggestionIndex = useMemo(() => createAssistantSuggestionIndex(suggestions), [suggestions]);
  function tokenLocator(token: AssistantContextToken) {
    const ref = token.contextRefs?.find(value => "objectId" in value);
    if (ref && "objectId" in ref && references) return liteasyPath(references.service.scope, { kind: "object", ref });
    if (token.resourcePath) return token.resourcePath;
    // Restore pre-existing drafts and messages that predate source locators.
    if (token.kind === "paper" && token.id.startsWith("paper-") && references)
      return liteasyPath(references.service.scope, { kind: "paper", paperId: token.id.slice(6) });
    return undefined;
  }
  function removeToken(token: AssistantContextToken) {
    return <Tooltip content={tChinese("context.composer.remove", "移除上下文：{{label}}", { label: token.label })} relationship="label"><Button appearance="subtle" size="small" icon={<DismissRegular />} aria-label={tChinese("context.composer.remove", "移除上下文：{{label}}", { label: token.label })} onClick={() => onRemoveContextToken?.(token.id)} /></Tooltip>;
  }
  function tokenPreview(token: AssistantContextToken, label: string) {
    const locator = tokenLocator(token);
    const diagnostic = token.contextRefs?.find(ref => "type" in ref && ref.type === "diagnostic");
    return locator && references ? <ResourceLink locator={locator} ariaLabel={token.label} previewOnClick actions={removeToken(token)}><span title={token.label}>{label}</span></ResourceLink>
      : <Popover positioning="above" trapFocus={false}><PopoverTrigger disableButtonEnhancement><Button appearance="transparent" className="assistant-context-preview-trigger" aria-label={tChinese("context.composer.preview", "预览上下文：{{label}}", { label: token.label })}>{label}</Button></PopoverTrigger><PopoverSurface aria-label={tChinese("context.composer.previewTitle", "上下文预览")}><strong>{token.label}</strong><p>{displayPath(token.detail ?? tChinese("context.composer.unavailable", "来源预览不可用"))}</p>{diagnostic && "message" in diagnostic ? <pre style={{ maxHeight: "min(50vh, 320px)", maxWidth: "min(80vw, 600px)", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "inherit" }}>{diagnostic.message}</pre> : null}{removeToken(token)}</PopoverSurface></Popover>;
  }
  const inputParts = inlineContextParts(input, contextTokens);
  const mentionedIds = new Set(inputParts.flatMap(part => part.token ? [part.token.id] : []));
  const highlightedInput = useMemo(() => {
    return inlineContextParts(input, contextTokens).map((part, index) => {
      if (part.token) return <mark className="assistant-command-chip assistant-inline-context" key={index}>{tokenPreview(part.token, part.text)}</mark>;
      if (!part.text.includes("/")) return part.text;
      const highlighted = [];
      let offset = 0;
      let plainStart = 0;
      while (offset < part.text.length) {
        const command = suggestionIndex.commands.find((value) => part.text.startsWith(value, offset) &&
          (offset === 0 || /\s/.test(part.text[offset - 1])) &&
          (offset + value.length === part.text.length || /[\s，。！？,!?;；]/.test(part.text[offset + value.length])));
        if (command) {
          if (offset > plainStart) highlighted.push(part.text.slice(plainStart, offset));
          highlighted.push(<mark className="assistant-command-chip" data-prefix="/" key={offset}>{command.slice(1)}</mark>);
          offset += command.length;
          plainStart = offset;
        } else offset++;
      }
      if (plainStart < part.text.length) highlighted.push(part.text.slice(plainStart));
      return <span key={index}>{highlighted}</span>;
    });
  }, [input, contextTokens, suggestionIndex, references, onRemoveContextToken, tChinese]);
  const activeTrigger = dismissed ? null : getActiveTrigger(input, Math.min(caret, input.length));
  const visibleSuggestions = activeTrigger
    ? suggestionIndex.search(activeTrigger.trigger, activeTrigger.query)
    : emptySuggestions;
  const showBrowseEntry = activeTrigger?.trigger === "@";
  const menuItemCount = visibleSuggestions.length + (showBrowseEntry ? 1 : 0);

  function openAssetBrowser(previewId?: string) {
    setBrowserPreviewId(previewId);
    setBrowserQuery(activeTrigger?.trigger === "@" ? activeTrigger.query.trim() : "");
    if (activeTrigger?.trigger === "@") {
      const nextInput = `${input.slice(0, activeTrigger.start)}${input.slice(activeTrigger.end)}`;
      browserInsertion.current = { input: nextInput, start: activeTrigger.start, end: activeTrigger.start };
      onInputChange(nextInput);
    } else browserInsertion.current = { input, start: editorRef.current?.selectionStart ?? input.length,
      end: editorRef.current?.selectionEnd ?? input.length };
    setDismissed(true);
  }

  function selectMenuItem() {
    const index = Math.min(activeIndex, menuItemCount - 1);
    if (index === visibleSuggestions.length && showBrowseEntry) openAssetBrowser();
    else if (visibleSuggestions[index]) selectSuggestion(visibleSuggestions[index]);
  }

  function advanceBrowserInsertion(token: AssistantContextToken) {
    const insertion = browserInsertion.current;
    if (!insertion) return;
    const next = insertContextNames(insertion.input, [{ ...token, label: shortContextName(token) }], insertion);
    browserInsertion.current = { input: next.input, start: next.caret, end: next.caret };
  }

  async function resolveBrowserToken(resolve: () => Promise<AssistantContextToken>) {
    let token: AssistantContextToken | undefined;
    const result = await onResolveContextToken?.(async () => { token = await resolve(); return token; }, browserInsertion.current);
    if (result !== false && token) advanceBrowserInsertion(token);
    return result;
  }

  function selectSuggestion(suggestion: AssistantComposerSuggestion) {
    if (!activeTrigger || suggestion.unavailableReason) {
      return;
    }

    const beforeTrigger = input.slice(0, activeTrigger.start);
    const afterTrigger = input.slice(activeTrigger.end);
    if (suggestion.researchSkill && onSelectResearchSkill) {
      onSelectResearchSkill(suggestion.researchSkill);
      onInputChange(`${beforeTrigger}${afterTrigger}`);
      setDismissed(true);
      editorRef.current?.focus();
      return;
    }
    if (suggestion.token || suggestion.resolveToken) {
      const insertion = { input, start: activeTrigger.start, end: activeTrigger.end };
      if (suggestion.resolveToken) void onResolveContextToken?.(async () => ({ ...await suggestion.resolveToken!(), resourcePath: suggestion.resourcePath }), insertion);
      else if (suggestion.token) onAddContextToken?.({ ...suggestion.token, resourcePath: suggestion.resourcePath }, insertion);
      setDismissed(true);
      editorRef.current?.focus();
      return;
    }

    const inserted = `${suggestion.insertText ?? suggestion.label}${suggestion.trigger === "/" ? " " : ""}`;
    insertionCaret.current = beforeTrigger.length + inserted.length;
    setCaret(insertionCaret.current);
    onInputChange(`${beforeTrigger}${inserted}${afterTrigger}`);
    editorRef.current?.focus();
  }

  const lastToken = contextTokens[contextTokens.length - 1];

  return (
    <div className="assistant-input-wrap" data-tour="assistant-composer">
      {researchSelection}
      {pending ? (
        <div className="assistant-command-feedback">
          当前回复仍在执行；发送的新消息会先暂存，可随后选择执行时机。
        </div>
      ) : null}
      {editing ? (
        <div className="assistant-editing-banner">
          <span>正在编辑原问题；发送后创建分支，原讨论保留</span>
          <button className="assistant-editing-cancel" onClick={onCancelEdit} type="button">
            取消编辑
          </button>
        </div>
      ) : null}
      {voiceInputMessage ? (
        <div className="assistant-voice-placeholder">{voiceInputMessage}</div>
      ) : null}
      {contextTokens.some(token => !mentionedIds.has(token.id)) ? (
        <div aria-label="已添加到对话上下文" className="assistant-context-token-row">
          {contextTokens.filter(token => !mentionedIds.has(token.id)).map(token => <span className={`assistant-context-token ${token.kind}`} key={token.id}>
            {tokenPreview(token, shortContextName(token))}{removeToken(token)}
          </span>)}
        </div>
      ) : null}
      {menuItemCount > 0 ? (
        <div aria-label="输入候选" id={menuId} role="group" className={`assistant-suggestion-menu${activeTrigger?.trigger === "/" ? " commands" : ""}`}>
          {visibleSuggestions.map((suggestion, index) => (
            <button
              className={`assistant-suggestion-item${index === activeIndex ? " active" : ""}`}
              id={`${menuId}-${index}`}
              aria-current={index === activeIndex}
              aria-disabled={Boolean(suggestion.unavailableReason)}
              onMouseMove={() => setActiveIndex(index)}
              key={suggestion.id}
              title={[suggestion.label, suggestion.projectTitle, suggestion.description, suggestion.unavailableReason, suggestion.detail].filter(Boolean).join(" · ")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
              type="button"
            >
              <ContextAssetThumbnail asset={suggestion} compact />
              <span className="assistant-suggestion-trigger">{suggestion.trigger}</span>
              <span className="assistant-suggestion-main">
                <strong>{suggestion.label}</strong>
                {suggestion.trigger === "@" && (suggestion.category || suggestion.projectTitle || suggestion.readOnly) ?
                  <span className="assistant-suggestion-metadata">{[suggestion.category, suggestion.projectTitle,
                    undefined].filter(Boolean).join(" · ")}</span> : null}
                {suggestion.unavailableReason ? <span>{suggestion.unavailableReason}</span> : null}
                {suggestion.detail ? <span>{suggestion.detail}</span> : null}
              </span>
            </button>
          ))}
          {showBrowseEntry ? <>
            {!visibleSuggestions.length ? <p className="assistant-suggestion-empty">没有找到匹配项，可打开资产浏览器按类别和项目查找。</p> : null}
            {visibleSuggestions[activeIndex] ? <Button icon={<EyeRegular />} appearance="subtle"
              onMouseDown={(event) => event.preventDefault()} onClick={() => openAssetBrowser(visibleSuggestions[activeIndex].id)}>预览当前候选</Button> : null}
            <Button className={`assistant-suggestion-browse${activeIndex === visibleSuggestions.length ? " active" : ""}`}
              id={`${menuId}-${visibleSuggestions.length}`} aria-current={activeIndex === visibleSuggestions.length}
              icon={<GridRegular />} onMouseMove={() => setActiveIndex(visibleSuggestions.length)}
              onMouseDown={(event) => event.preventDefault()} onClick={() => openAssetBrowser()}>浏览全部资产</Button>
          </> : null}
        </div>
      ) : null}
      <div className={`assistant-input-editor${textSelected ? " has-text-selection" : ""}`}>
      <div className="assistant-input-highlight" ref={highlightRef}>{highlightedInput}{"\n"}</div>
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
        aria-controls={menuItemCount ? menuId : undefined}
        aria-expanded={menuItemCount > 0}
        aria-activedescendant={menuItemCount ? `${menuId}-${Math.min(activeIndex, menuItemCount - 1)}` : undefined}
        onChange={(event) => {
          setCaret(event.target.selectionStart);
          setTextSelected(event.target.selectionStart !== event.target.selectionEnd);
          onInputChange(event.target.value);
        }}
        onSelect={(event) => { setCaret(event.currentTarget.selectionStart); setTextSelected(event.currentTarget.selectionStart !== event.currentTarget.selectionEnd); }}
        onKeyDown={(event) => {
          if (onHistoryChange && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
            event.preventDefault();
            onHistoryChange(event.key.toLowerCase() === "y" || event.shiftKey ? 1 : -1);
            return;
          }
          if (menuItemCount && !event.nativeEvent.isComposing) {
            if (event.key === "Escape") { event.preventDefault(); setDismissed(true); return; }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + menuItemCount) % menuItemCount);
              return;
            }
            if (event.key === "Tab") {
              event.preventDefault();
              selectMenuItem();
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
            menuItemCount > 0
          ) {
            event.preventDefault();
            selectMenuItem();
            return;
          }

          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
            return;
          }

          event.preventDefault();
          if (!contextLoading) onSend();
        }}
        placeholder="输入你的问题或命令"
        rows={3}
        title={modeHint}
        value={input}
      />
      </div>
      <div className="assistant-composer-actions">
        {modelPicker}
        <Tooltip content="按类别和项目浏览资料，组合添加到上下文" relationship="description">
          <Button {...restoreContextFocus} appearance="subtle" aria-label="添加上下文" data-tour="add-context" className="assistant-add-context" icon={<AddRegular />} onClick={() => openAssetBrowser()} />
        </Tooltip>
        {onThinkingDepthChange ? <Popover positioning={{ position: "above", autoSize: "height", overflowBoundaryPadding: 12 }} trapFocus>
          <PopoverTrigger disableButtonEnhancement>
            <Tooltip content={`思考深度与规矩：${thinkingDepthLabels[thinkingDepth]}`} relationship="description">
              <Button aria-label={`调整思考深度：${thinkingDepthLabels[thinkingDepth]}`} appearance="subtle"
                className="assistant-thinking-trigger" icon={thinkingDepth === "quick" ? <FlashRegular /> : <BrainCircuitRegular />} />
            </Tooltip>
          </PopoverTrigger>
          <PopoverSurface aria-label="思考深度设置" className={`assistant-thinking-popover${thinkingRules ? " assistant-thinking-popover-with-rules" : ""}`}>
            <div className="assistant-thinking-depth">
              <strong>思考深度 · {thinkingDepthLabels[thinkingDepth]}</strong>
              <Slider aria-label="思考深度" aria-valuetext={thinkingDepthLabels[thinkingDepth]} min={0} max={2} step={1}
                value={thinkingDepths.indexOf(thinkingDepth)}
                onChange={(_, data) => onThinkingDepthChange(thinkingDepths[data.value])} />
              <div className="assistant-thinking-labels"><span>快速</span><span>均衡</span><span>熟虑</span></div>
              <p className="assistant-thinking-description">快速优先简洁回应；熟虑加强分析与核验，通常需要更长时间。</p>
            </div>
            {thinkingRules ? <section className="assistant-thinking-rules" aria-label="思考规矩">
              <strong>思考规矩</strong>
              {thinkingRules}
            </section> : null}
          </PopoverSurface>
        </Popover> : null}
        {contextUsage ? <ContextUsageIndicator usage={contextUsage} /> : null}
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
        <Tooltip content={researchSelected ? "生成并保存" : editing ? "更新并发送" : "发送消息"} positioning="above" relationship="description">
          <Button appearance="primary" size="small" icon={<SendRegular />}
            aria-label={researchSelected ? "生成并保存" : editing ? "更新并发送" : "发送"}
            className="assistant-send assistant-icon-button"
            disabled={contextLoading}
            onClick={onSend}
            title={researchSelected ? "生成并保存" : editing ? "更新并发送" : "发送"}
            type="button"
          />
        </Tooltip>
      </div>
      {browserQuery !== null ? <ContextAssetBrowser key={contextScopeId} purpose="context" targetDraftId={contextScopeId} draftText={input} suggestions={suggestions} contextTokens={contextTokens} initialPreviewId={browserPreviewId}
        initialQuery={browserQuery} onAddContextToken={onAddContextToken ? (token) => {
          onAddContextToken(token, browserInsertion.current);
          advanceBrowserInsertion(token);
        } : undefined}
        onResolveContextToken={onResolveContextToken ? resolveBrowserToken : undefined}
        onClose={() => { setBrowserQuery(null); editorRef.current?.focus(); }} /> : null}
    </div>
  );
}
