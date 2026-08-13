import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Option, ProgressBar, Tooltip } from "@fluentui/react-components";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ArrowClockwiseRegular,
  ArrowSwapRegular,
  ChatRegular,
  CopyRegular,
  DismissRegular,
  DocumentTextRegular,
  ImageMultipleRegular,
  TranslateRegular
} from "@fluentui/react-icons";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper } from "../workspace/workspace.types";
import type { MineruFigure } from "./import.types";
import { MineruMarkdown } from "./MineruMarkdown";
import { resolveMineruImageSource } from "./mineruImageSources";
import type { PersistedPaperTranslation } from "./paperTranslationRepository";
import type { PaperResourceKind } from "./paperResource.types";
import {
  auditTranslationAnchors,
  buildAnchoredTranslationDocument,
  restoreMissingMarkdownImages,
  splitTranslationByAnchor,
  type TranslationAnchor
} from "./translationAnchors";
import "./paperResource.css";

type PaperResourceTabProps = {
  figures: readonly MineruFigure[];
  kind: PaperResourceKind;
  onLoadTranslations?: (markedSource: string) => Promise<readonly PersistedPaperTranslation[]>;
  onCreatePresentation?: () => void;
  onTranslate?: (
    sourceLanguage: string,
    targetLanguage: string,
    markedSource: string,
    options: TranslationRequestOptions
  ) => Promise<string>;
  onUseInConversation?: () => void;
  paper: Paper;
  textChunks: readonly RetrievalChunk[];
};

export type TranslationProgress = {
  completedBatches: number;
  message: string;
  phase: "preflight" | "translating" | "repairing" | "completed";
  totalBatches: number;
};

export type TranslationRequestOptions = {
  onProgress: (progress: TranslationProgress) => void;
  signal: AbortSignal;
};

type TranslationFailureView = {
  action: string;
  detail: string;
  retryable?: boolean;
  title: string;
};

function sanitizeTranslationDetail(value: string) {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[API key 已隐藏]")
    .replace(/([?&](?:api[_-]?key|token)=)[^&\s)]+/gi, "$1[已隐藏]")
    .slice(0, 1_200);
}

function translationFailureView(error: unknown): TranslationFailureView {
  const shaped = error && typeof error === "object" ? error as {
    action?: unknown;
    detail?: unknown;
    message?: unknown;
    title?: unknown;
  } : null;
  const message = typeof shaped?.message === "string" ? shaped.message : String(error);
  const detail = sanitizeTranslationDetail(
    typeof shaped?.detail === "string" ? shaped.detail : message
  );
  if (typeof shaped?.title === "string" && typeof shaped?.action === "string") {
    return { action: shaped.action, detail, title: shaped.title };
  }
  if (/mosshubs?\.com/i.test(message)) {
    return {
      action: "请重启当前本地模型代理服务，确认生效的上游地址后再重试。已完成的译文不会被清空。",
      detail,
      title: "本地翻译服务仍在使用旧配置"
    };
  }
  if (/\b(?:401|403)\b|api[_ ]?key|unauthorized|forbidden/i.test(message)) {
    return {
      action: "请检查本地服务的模型密钥与上游地址，然后重启服务。",
      detail,
      title: "模型服务配置未通过验证"
    };
  }
  if (/\b(?:429|502|503|504|520|522|524)\b|timed?\s*out|timeout/i.test(message)) {
    return {
      action: "上游可能正在拥塞。稍后点击重试；已完成的分段会在本次会话中继续复用。",
      detail,
      title: "上游模型服务暂时不可用"
    };
  }
  if (/anchor|锚点/i.test(message)) {
    return {
      action: "模型没有完整保留原文同步锚点。请重试，Liteasy 会重新校验每个分段。",
      detail,
      title: "译文结构校验未通过"
    };
  }
  if (/failed to fetch|fetch failed|network|econnrefused|连接失败|无法连接/i.test(message)) {
    return {
      action: "请确认本地 Liteasy 模型服务已经启动，并检查当前模型代理地址。",
      detail,
      title: "无法连接本地翻译服务"
    };
  }
  return {
    action: "请重试；如果问题持续存在，可展开技术详情定位当前模型服务。",
    detail,
    title: "本次翻译未完成"
  };
}

function placementLabel(figure: MineruFigure) {
  switch (figure.analysis?.placement) {
    case "method": return "方法图解";
    case "results": return "结果证据";
    case "evidence": return "关键证据";
    default: return "论文插图";
  }
}

function MineruFigureImage({ figure }: { figure: MineruFigure }) {
  const alt = figure.analysis?.title ?? figure.alt;
  const source = resolveMineruImageSource(figure.dataUrl, [figure]);
  return source
    ? <img alt={alt} loading="lazy" src={source} />
    : <span className="mineru-markdown__blocked-image">[无法安全加载图片：{alt || "未命名图片"}]</span>;
}

type TranslationReadMode = "compare" | "source" | "translation";

export type ScrollAnchorPosition = {
  id: string;
  top: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateSynchronizedScrollTop(input: {
  sourceAnchors: readonly ScrollAnchorPosition[];
  sourceClientHeight: number;
  sourceScrollHeight: number;
  sourceScrollTop: number;
  targetAnchors: readonly ScrollAnchorPosition[];
  targetClientHeight: number;
  targetScrollHeight: number;
}) {
  const sourceMaximum = Math.max(0, input.sourceScrollHeight - input.sourceClientHeight);
  const targetMaximum = Math.max(0, input.targetScrollHeight - input.targetClientHeight);
  if (sourceMaximum === 0 || targetMaximum === 0) return 0;
  const sourceScrollTop = clamp(input.sourceScrollTop, 0, sourceMaximum);
  const fallback = targetMaximum * (sourceScrollTop / sourceMaximum);
  if (input.sourceAnchors.length === 0 || input.targetAnchors.length === 0) return fallback;

  let sourceIndex = 0;
  for (let index = 1; index < input.sourceAnchors.length; index += 1) {
    if (input.sourceAnchors[index].top > sourceScrollTop + 1) break;
    sourceIndex = index;
  }
  const sourceAnchor = input.sourceAnchors[sourceIndex];
  const targetIndex = input.targetAnchors.findIndex(({ id }) => id === sourceAnchor.id);
  if (targetIndex < 0) return fallback;

  const sourceStart = sourceIndex === 0 ? 0 : sourceAnchor.top;
  const sourceEnd = input.sourceAnchors[sourceIndex + 1]?.top ?? input.sourceScrollHeight;
  const targetStart = targetIndex === 0 ? 0 : input.targetAnchors[targetIndex].top;
  const targetEnd = input.targetAnchors[targetIndex + 1]?.top ?? input.targetScrollHeight;
  const intervalProgress = clamp(
    (sourceScrollTop - sourceStart) / Math.max(1, sourceEnd - sourceStart),
    0,
    1
  );
  return clamp(targetStart + (targetEnd - targetStart) * intervalProgress, 0, targetMaximum);
}

function anchorPositions(container: HTMLElement): ScrollAnchorPosition[] {
  const containerTop = container.getBoundingClientRect().top;
  return Array.from(container.querySelectorAll<HTMLElement>("[data-translation-anchor]")).flatMap((anchor) => (
    anchor.dataset.translationAnchor
      ? [{
          id: anchor.dataset.translationAnchor,
          top: container.scrollTop + anchor.getBoundingClientRect().top - containerTop
        }]
      : []
  ));
}

function AnchoredReadingPane({
  anchors,
  contentByAnchor,
  emptyLabel,
  figures,
  label,
  containerRef,
  onScroll
}: {
  anchors: readonly TranslationAnchor[];
  contentByAnchor: (anchor: TranslationAnchor) => string;
  emptyLabel: string;
  figures: readonly MineruFigure[];
  label: string;
  containerRef?: RefObject<HTMLElement>;
  onScroll?: () => void;
}) {
  return (
    <section aria-label={label} className="paper-resource-tab__reading-pane" onScroll={onScroll} ref={containerRef}>
      {anchors.map((anchor) => {
        const content = contentByAnchor(anchor);
        return (
          <article data-translation-anchor={anchor.id} key={anchor.id}>
            <header><span>{anchor.label}</span><small>{label}</small></header>
            {content ? <MineruMarkdown content={content} figures={figures} /> : <p className="paper-resource-tab__missing-translation">{emptyLabel}</p>}
          </article>
        );
      })}
    </section>
  );
}

function TranslationReadingView({
  anchors,
  figures,
  mode,
  targetLanguage,
  translation
}: {
  anchors: readonly TranslationAnchor[];
  figures: readonly MineruFigure[];
  mode: TranslationReadMode;
  targetLanguage: string;
  translation: string;
}) {
  const sourcePaneRef = useRef<HTMLElement>(null!);
  const translationPaneRef = useRef<HTMLElement>(null!);
  const synchronizingRef = useRef<"original" | "translation" | null>(null);
  const translations = useMemo(() => splitTranslationByAnchor(translation, anchors), [anchors, translation]);
  const translationByAnchor = useMemo(() => new Map(translations.map(({ anchor, translated }) => [anchor.id, translated])), [translations]);

  function synchronize(source: "original" | "translation") {
    if (synchronizingRef.current === source) {
      synchronizingRef.current = null;
      return;
    }
    const from = source === "original" ? sourcePaneRef.current : translationPaneRef.current;
    const to = source === "original" ? translationPaneRef.current : sourcePaneRef.current;
    if (!from || !to) return;
    const targetPane = source === "original" ? "translation" : "original";
    const top = calculateSynchronizedScrollTop({
      sourceAnchors: anchorPositions(from),
      sourceClientHeight: from.clientHeight,
      sourceScrollHeight: from.scrollHeight,
      sourceScrollTop: from.scrollTop,
      targetAnchors: anchorPositions(to),
      targetClientHeight: to.clientHeight,
      targetScrollHeight: to.scrollHeight
    });
    synchronizingRef.current = targetPane;
    if (typeof to.scrollTo === "function") {
      to.scrollTo({ behavior: "auto", top });
    } else {
      to.scrollTop = top;
    }
    const schedule = window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 0));
    schedule(() => {
      if (synchronizingRef.current === targetPane) synchronizingRef.current = null;
    });
  }

  const original = <AnchoredReadingPane anchors={anchors} containerRef={sourcePaneRef} contentByAnchor={(anchor) => anchor.source} emptyLabel="" figures={figures} label="原文" onScroll={() => synchronize("original")} />;
  const translated = <AnchoredReadingPane anchors={anchors} containerRef={translationPaneRef} contentByAnchor={(anchor) => restoreMissingMarkdownImages(anchor.source, translationByAnchor.get(anchor.id) ?? "")} emptyLabel="这一段没有保留同步锚点；可重新翻译以恢复对照。" figures={figures} label={`${targetLanguage} 译文`} onScroll={() => synchronize("translation")} />;
  if (mode === "source") return <div className="paper-resource-tab__single-reading">{original}</div>;
  if (mode === "translation") return <div className="paper-resource-tab__single-reading">{translated}</div>;
  return <div className="paper-resource-tab__comparison-reading">{original}{translated}</div>;
}

export function PaperResourceTab({
  figures,
  kind,
  onLoadTranslations,
  onCreatePresentation,
  onTranslate,
  onUseInConversation,
  paper,
  textChunks
}: PaperResourceTabProps) {
  const isFigureCollection = kind === "figures";
  const isMultimodal = kind === "multimodal";
  const orderedFigures = useMemo(() => [...figures].sort((left, right) => (
    left.page - right.page || left.sourcePath.localeCompare(right.sourcePath) || left.id.localeCompare(right.id)
  )), [figures]);
  const orderedChunks = useMemo(() => [...textChunks].sort((left, right) => left.page - right.page), [textChunks]);
  const sourceMarkdownChunk = orderedChunks.find((chunk) => (
    chunk.textExtraction === "mineru" && chunk.sourceMarkdown?.trim()
  ));
  const readableChunks = sourceMarkdownChunk
    ? [{ ...sourceMarkdownChunk, snippet: sourceMarkdownChunk.sourceMarkdown! }]
    : orderedChunks;
  const [sourceLanguage, setSourceLanguage] = useState("English");
  const [targetLanguage, setTargetLanguage] = useState("中文");
  const [translationDialogOpen, setTranslationDialogOpen] = useState(false);
  const [savedTranslations, setSavedTranslations] = useState<readonly PersistedPaperTranslation[]>([]);
  const [translatedContent, setTranslatedContent] = useState("");
  const [translatedLanguages, setTranslatedLanguages] = useState({ source: "English", target: "中文" });
  const [translationReadMode, setTranslationReadMode] = useState<TranslationReadMode>("compare");
  const [translationError, setTranslationError] = useState<TranslationFailureView | null>(null);
  const [translationProgress, setTranslationProgress] = useState<TranslationProgress | null>(null);
  const [translationCopied, setTranslationCopied] = useState(false);
  const [translating, setTranslating] = useState(false);
  const translationAbortRef = useRef<AbortController | null>(null);
  const copyResetTimerRef = useRef<number | undefined>(undefined);
  const loadTranslationsRef = useRef(onLoadTranslations);
  loadTranslationsRef.current = onLoadTranslations;
  const anchoredTranslation = useMemo(() => buildAnchoredTranslationDocument(orderedChunks), [orderedChunks]);
  const pages = [...new Set([...orderedChunks.map((chunk) => chunk.page), ...orderedFigures.map((figure) => figure.page)])]
    .sort((left, right) => left - right);
  const itemCount = isFigureCollection ? orderedFigures.length : isMultimodal ? pages.length : readableChunks.length;

  useEffect(() => () => {
    translationAbortRef.current?.abort();
    if (copyResetTimerRef.current !== undefined) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setSavedTranslations([]);
    const loadTranslations = loadTranslationsRef.current;
    if (!loadTranslations || !anchoredTranslation.markedSource.trim()) return () => { active = false; };
    void loadTranslations(anchoredTranslation.markedSource)
      .then((translations) => {
        if (!active) return;
        setSavedTranslations(translations.filter((translation) => (
          auditTranslationAnchors(translation.content, anchoredTranslation.anchors).valid
        )));
      })
      .catch((error) => {
        console.warn("Unable to load saved paper translations", error);
      });
    return () => { active = false; };
  }, [anchoredTranslation.markedSource, paper.id]);

  function viewSavedTranslation() {
    const saved = savedTranslations[0];
    if (!saved) return;
    setTranslatedContent(saved.content);
    setTranslatedLanguages({ source: saved.sourceLanguage, target: saved.targetLanguage });
    setTranslationReadMode("compare");
    setTranslationError(null);
  }

  async function translate() {
    if (!onTranslate) return;
    if (!anchoredTranslation.markedSource.trim()) {
      setTranslationDialogOpen(false);
      setTranslationError({
        action: "请先重新解析或重新导入这篇论文，确认 MinerU 已提取到正文后再翻译。",
        detail: "当前论文资源没有可翻译的文本分段，尚未调用模型服务。",
        retryable: false,
        title: "没有可翻译的论文文本"
      });
      return;
    }
    translationAbortRef.current?.abort();
    const abortController = new AbortController();
    translationAbortRef.current = abortController;
    setTranslating(true);
    setTranslationError(null);
    setTranslationCopied(false);
    setTranslationDialogOpen(false);
    setTranslationProgress({
      completedBatches: 0,
      message: "正在检查本地翻译服务…",
      phase: "preflight",
      totalBatches: 0
    });
    try {
      const nextTranslation = await onTranslate(
        sourceLanguage,
        targetLanguage,
        anchoredTranslation.markedSource,
        {
          onProgress: setTranslationProgress,
          signal: abortController.signal
        }
      );
      if (abortController.signal.aborted) return;
      setTranslatedContent(nextTranslation);
      setTranslatedLanguages({ source: sourceLanguage, target: targetLanguage });
      setTranslationReadMode("compare");
    } catch (error) {
      if (abortController.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        return;
      }
      setTranslationError(translationFailureView(error));
    } finally {
      if (translationAbortRef.current === abortController) {
        translationAbortRef.current = null;
        setTranslating(false);
        setTranslationProgress(null);
      }
    }
  }

  function cancelTranslation() {
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    setTranslating(false);
    setTranslationProgress(null);
  }

  async function copyTranslation() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("当前运行环境不支持剪贴板写入。");
      }
      const copyableTranslation = translatedContent
        .replace(/<!--\s*liteasy-anchor:[a-z0-9-]+\s*-->\s*/gi, "")
        .trim();
      await navigator.clipboard.writeText(copyableTranslation);
      setTranslationCopied(true);
      if (copyResetTimerRef.current !== undefined) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => setTranslationCopied(false), 2_000);
    } catch (error) {
      setTranslationError({
        action: "请允许 Liteasy 访问剪贴板，或从译文阅读区手动复制。",
        detail: sanitizeTranslationDetail(error instanceof Error ? error.message : String(error)),
        title: "无法复制译文"
      });
    }
  }

  return (
    <main className="paper-resource-tab" aria-label={`${paper.title} ${isFigureCollection ? "论文插图" : isMultimodal ? "提取图文版" : "提取文本"}`}>
      <header className="paper-resource-tab__header">
        <div>
          <span className="paper-resource-tab__eyebrow">
            {isFigureCollection || isMultimodal ? <ImageMultipleRegular aria-hidden="true" /> : <DocumentTextRegular aria-hidden="true" />}
            MinerU 多模态素材
          </span>
          <h1>{isFigureCollection ? "论文插图" : isMultimodal ? "论文提取图文版" : "论文提取文本"}</h1>
          <p title={paper.title}>{paper.title}</p>
        </div>
        <div className="paper-resource-tab__actions">
          {!isFigureCollection ? <Button
            appearance="secondary"
            disabled={itemCount === 0 || translating || (!onTranslate && savedTranslations.length === 0)}
            icon={savedTranslations.length > 0 && !translatedContent ? <DocumentTextRegular /> : <TranslateRegular />}
            onClick={() => {
              if (savedTranslations.length > 0 && !translatedContent) {
                viewSavedTranslation();
                return;
              }
              setTranslationDialogOpen(true);
            }}
          >
            {translating ? "正在翻译" : savedTranslations.length > 0 && !translatedContent ? "查看译文" : translatedContent ? "翻译其他语言" : "翻译文本"}
          </Button> : null}
          <Button
            appearance="secondary"
            disabled={itemCount === 0}
            icon={<ChatRegular />}
            onClick={onUseInConversation}
          >
            用作提问材料
          </Button>
          <Button
            appearance="primary"
            disabled={itemCount === 0}
            icon={<DocumentTextRegular />}
            onClick={onCreatePresentation}
          >
            制作展示内容
          </Button>
        </div>
      </header>
      {translating ? (
        <section aria-live="polite" className="paper-resource-tab__translation-progress" role="status">
          <div className="paper-resource-tab__translation-progress-heading">
            <div>
              <strong>正在翻译论文文本</strong>
              <span>{translationProgress?.message ?? "正在准备翻译…"}</span>
            </div>
            <Button appearance="subtle" icon={<DismissRegular />} onClick={cancelTranslation}>取消</Button>
          </div>
          <ProgressBar
            max={Math.max(1, translationProgress?.totalBatches ?? 1)}
            value={translationProgress?.totalBatches
              ? translationProgress.completedBatches
              : undefined}
          />
          <small>
            {translationProgress?.totalBatches
              ? `已完成 ${translationProgress.completedBatches} / ${translationProgress.totalBatches} 个分段`
              : "正在确认本地服务与生效的上游配置"}
          </small>
        </section>
      ) : null}
      {translatedContent ? (
        <section className="paper-resource-tab__translation" aria-label={`${translatedLanguages.target} 翻译`}>
          <header>
            <div>
              <span>译文 · {translatedLanguages.source} → {translatedLanguages.target}</span>
              <small>锚点来自原文；两栏在对照模式下联动</small>
            </div>
            <div className="paper-resource-tab__translation-actions">
              <Button appearance="subtle" icon={<CopyRegular />} onClick={() => void copyTranslation()}>
                {translationCopied ? "已复制" : "复制 Markdown"}
              </Button>
              <Button appearance="subtle" disabled={translating} icon={<ArrowClockwiseRegular />} onClick={() => setTranslationDialogOpen(true)}>
                重新翻译
              </Button>
            </div>
          </header>
          <div aria-label="翻译阅读方式" className="paper-resource-tab__translation-modes">
            <Button appearance={translationReadMode === "source" ? "primary" : "subtle"} onClick={() => setTranslationReadMode("source")}>仅看原文</Button>
            <Button appearance={translationReadMode === "translation" ? "primary" : "subtle"} onClick={() => setTranslationReadMode("translation")}>仅看译文</Button>
            <Button appearance={translationReadMode === "compare" ? "primary" : "subtle"} onClick={() => setTranslationReadMode("compare")}>左右对照</Button>
          </div>
          <TranslationReadingView anchors={anchoredTranslation.anchors} figures={orderedFigures} mode={translationReadMode} targetLanguage={translatedLanguages.target} translation={translatedContent} />
        </section>
      ) : null}
      {translationError ? (
        <section className="paper-resource-tab__translation-error" role="alert">
          <div>
            <strong>{translationError.title}</strong>
            <p>{translationError.action}</p>
          </div>
          <div className="paper-resource-tab__translation-error-actions">
            {translationError.retryable !== false ? (
              <Button appearance="primary" icon={<ArrowClockwiseRegular />} onClick={() => void translate()}>重试翻译</Button>
            ) : null}
            <Button appearance="secondary" onClick={() => {
              if (translationError.retryable === false) {
                setTranslationError(null);
                return;
              }
              setTranslationDialogOpen(true);
            }}>{translationError.retryable === false ? "关闭提示" : "重新选择语言"}</Button>
          </div>
          <details>
            <summary>技术详情</summary>
            <code>{translationError.detail}</code>
          </details>
        </section>
      ) : null}
      {translationDialogOpen ? <Dialog modalType="modal" onOpenChange={(_, data) => setTranslationDialogOpen(data.open)} open>
        <DialogSurface aria-label="选择翻译语言">
          <DialogBody>
            <DialogTitle>翻译 MinerU 提取内容</DialogTitle>
            <DialogContent className="paper-resource-tab__translation-dialog-content">
              <p>确认语言方向后再调用模型。图片会保留在图文版中的原始位置。</p>
              <div className="paper-resource-tab__translation-language-picker">
                <label>
                  <span>源语言</span>
                  <Dropdown aria-label="翻译源语言" onOptionSelect={(_, data) => setSourceLanguage(data.optionValue ?? sourceLanguage)} selectedOptions={[sourceLanguage]} value={sourceLanguage}>
                    <Option value="中文">中文</Option>
                    <Option value="English">English</Option>
                    <Option value="日本語">日本語</Option>
                  </Dropdown>
                </label>
                <Tooltip content="交换源语言和目标语言" relationship="label">
                  <Button appearance="subtle" aria-label="交换源语言和目标语言" icon={<ArrowSwapRegular />} onClick={() => {
                    setSourceLanguage(targetLanguage);
                    setTargetLanguage(sourceLanguage);
                  }} />
                </Tooltip>
                <label>
                  <span>目标语言</span>
                  <Dropdown aria-label="翻译目标语言" onOptionSelect={(_, data) => setTargetLanguage(data.optionValue ?? targetLanguage)} selectedOptions={[targetLanguage]} value={targetLanguage}>
                    <Option value="中文">中文</Option>
                    <Option value="English">English</Option>
                    <Option value="日本語">日本語</Option>
                  </Dropdown>
                </label>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setTranslationDialogOpen(false)}>取消</Button>
              <Button appearance="primary" disabled={sourceLanguage === targetLanguage || translating} icon={<TranslateRegular />} onClick={() => void translate()}>
                {translating ? "正在翻译" : `确认翻译为 ${targetLanguage}`}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog> : null}
      {!translatedContent && (isFigureCollection ? (
        orderedFigures.length > 0 ? (
          <section className="paper-resource-tab__figure-list" aria-label="按论文出现顺序排列的插图">
            {orderedFigures.map((figure, index) => (
              <figure className="paper-resource-tab__figure" key={figure.id}>
                <div className="paper-resource-tab__figure-index">{String(index + 1).padStart(2, "0")}</div>
                <MineruFigureImage figure={figure} />
                <figcaption>
                  <div><span>{placementLabel(figure)}</span><span>第 {figure.page} 页</span></div>
                  <h2>{figure.analysis?.title ?? figure.alt}</h2>
                  <p>{figure.analysis?.description ?? "MinerU 从论文原文提取的高清插图。"}</p>
                  {figure.analysis?.selectionReason ? <small>{figure.analysis.selectionReason}</small> : null}
                </figcaption>
              </figure>
            ))}
          </section>
        ) : <p className="paper-resource-tab__empty">该论文没有可展示的插图；重新解析后会自动补充。</p>
      ) : isMultimodal ? (
        sourceMarkdownChunk ? (
          <section className="paper-resource-tab__multimodal-list" aria-label="按论文原文顺序排列的图文版">
            <article className="paper-resource-tab__multimodal-document">
              <MineruMarkdown content={sourceMarkdownChunk.sourceMarkdown!} figures={orderedFigures} />
            </article>
          </section>
        ) : pages.length > 0 ? (
          <section className="paper-resource-tab__multimodal-list" aria-label="按论文原文顺序排列的图文版">
            {pages.map((page) => {
              const pageChunks = orderedChunks.filter((chunk) => chunk.page === page);
              const pageFigures = orderedFigures.filter((figure) => figure.page === page);
              return (
                <article className="paper-resource-tab__multimodal-page" key={page}>
                  <header><span>第 {page} 页</span><small>MinerU 图文提取</small></header>
                  {pageChunks.map((chunk, index) => <MineruMarkdown content={chunk.snippet} figures={pageFigures} key={`${chunk.paperId}-${chunk.page}-${index}`} />)}
                  {pageFigures.map((figure) => (
                    <figure key={figure.id}>
                      <MineruFigureImage figure={figure} />
                      <figcaption><strong>{figure.analysis?.title ?? figure.alt}</strong><span>{figure.analysis?.description ?? "原文插图"}</span></figcaption>
                    </figure>
                  ))}
                </article>
              );
            })}
          </section>
        ) : <p className="paper-resource-tab__empty">该论文尚未完成图文提取。</p>
      ) : (
        readableChunks.length > 0 ? (
          <section className="paper-resource-tab__text-list" aria-label="按页排列的论文提取文本">
            {readableChunks.map((chunk, index) => (
              <article key={`${chunk.paperId}-${chunk.page}-${index}`}>
                <header><span>{chunk.sourceMarkdown ? "完整论文" : `第 ${chunk.page} 页`}</span><small>{chunk.sourceMarkdown ? "MinerU Markdown" : chunk.textExtraction === "mineru" ? "MinerU 精准提取" : "PDF 文本提取"}</small></header>
                <MineruMarkdown content={chunk.snippet} figures={orderedFigures} />
              </article>
            ))}
          </section>
        ) : <p className="paper-resource-tab__empty">该论文尚未完成文本提取。</p>
      ))}
    </main>
  );
}
