import { useEffect, useRef, useState } from "react";
import type { GuideBatch, GuideGenerator, GuideMode, GuidePage } from "./literatureGuide";
import { defaultGuideOptions, guideCategories, guideModes, type GuideOptions } from "./literatureGuide.types";
import type { LiteratureGuideState } from "./LiteratureGuideControls";

export function useLiteratureGuide(input: {
  scope: string | null; title: string; pageCount: number; ready: boolean; count: number;
  generate?: GuideGenerator; readPage(page: number): Promise<string>;
  save(batch: GuideBatch, pages: number[], mode: GuideMode, runId: string, signal: AbortSignal, options: GuideOptions): Promise<number>;
  clear(): Promise<void>;
}): LiteratureGuideState {
  const [mode, setMode] = useState<GuideMode>("auto");
  const [options, setOptions] = useState<GuideOptions>(defaultGuideOptions);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const latest = useRef(input); latest.current = input;
  const running = useRef<AbortController>();
  const cursor = useRef(1);
  useEffect(() => {
    cursor.current = 1; setBusy(false); setError(""); setMessage(""); setVisible(true);
    return () => { running.current?.abort(); running.current = undefined; };
  }, [input.scope]);

  async function start(systemPrompt?: string) {
    const runOptions = { ...options, ...(systemPrompt === undefined ? {} : { systemPrompt }) };
    const request = latest.current;
    if (!request.ready || !request.generate || !options.categories.length || running.current) return;
    const controller = new AbortController(); running.current = controller;
    const { signal } = controller;
    setBusy(true); setVisible(true); setError("");
    const runId = crypto.randomUUID();
    let added = 0; let skipped = 0; let rejected = 0;
    const first = cursor.current > request.pageCount ? 1 : cursor.current;
    const last = Math.min(request.pageCount, first + 59);
    let pages: GuidePage[] = [];
    let characters = 0;
    let abstract = "";
    const check = () => { signal.throwIfAborted(); if (latest.current.scope !== request.scope) throw new DOMException("论文已切换", "AbortError"); };
    async function flush() {
      if (!pages.length) return;
      check();
      setMessage(`正在标注 ${pages[0].page}–${pages.at(-1)!.page} / ${request.pageCount} 页…`);
      const timeout = setTimeout(() => controller.abort(new Error("模型响应超时，请重试。")), 90_000);
      try {
        const batch = await request.generate!({ title: request.title, abstract, mode, pages, signal, ...runOptions });
        check();
        if (batch.rejected && !batch.items.length) throw new Error("本批讲解未能对应原文，原有标注已保留，请重试。");
        const saved = await request.save(batch, pages.map((page) => page.page), mode, runId, signal, runOptions);
        added += saved;
        check(); rejected += batch.rejected + Math.max(0, batch.items.length - saved);
        cursor.current = pages.at(-1)!.page + 1;
        pages = []; characters = 0;
      } finally { clearTimeout(timeout); }
    }
    try {
      // Read bounded text only. Never render a PDF page canvas for AI analysis.
      abstract = (await request.readPage(1)).slice(0, 4000);
      check();
      for (let page = first; page <= last; page++) {
        const text = await request.readPage(page); check();
        if (!text.trim() || text.length > 12_000) { skipped++; continue; }
        if (pages.length >= 3 || characters + text.length > 12_000) await flush();
        pages.push({ page, text }); characters += text.length;
      }
      await flush(); check(); cursor.current = last + 1;
      setMessage(`已标注 ${added} 处 · ${last}/${request.pageCount} 页${last < request.pageCount ? "；点击继续标注" : ""}${skipped ? `；${skipped} 页无可用文本或过长，未标注` : ""}${rejected ? `；另 ${rejected} 处已跳过` : ""}`);
    } catch (failure) {
      if (latest.current.scope === request.scope && running.current === controller) {
        setMessage(`已保留 ${added} 处讲解；再次点击从第 ${cursor.current} 页继续。`);
        if (!signal.aborted || signal.reason instanceof Error && signal.reason.name !== "AbortError") {
          setError(failure instanceof Error ? failure.message : "AI 标注未完成，请重试。");
        }
      }
    } finally {
      if (running.current === controller) { running.current = undefined; setBusy(false); }
    }
  }
  return { mode, options, busy, visible, count: input.count, resume: cursor.current > 1 && cursor.current <= input.pageCount, message, error, ready: input.ready && Boolean(input.generate),
    setOptions: (value) => {
      if (running.current) return;
      setOptions({ ...value, systemPrompt: value.systemPrompt.slice(0, 4000),
        categories: [...new Set(value.categories)].filter((key) => Object.prototype.hasOwnProperty.call(guideCategories, key)) });
      cursor.current = 1; setMessage(""); setError("");
    },
    setMode: (value) => { if (!Object.prototype.hasOwnProperty.call(guideModes, value) || running.current) return; setMode(value); cursor.current = 1; setMessage(""); },
    start: (systemPrompt?: string) => { void start(systemPrompt); }, cancel: () => running.current?.abort(), toggle: () => setVisible((value) => !value),
    clear: () => {
      if (running.current) return;
      const request = latest.current;
      void request.clear().then(() => {
        if (latest.current.scope !== request.scope) return;
        cursor.current = 1; setMessage("已删除自动标注，保留手动修改的讲解。"); setError("");
      }).catch((failure) => { if (latest.current.scope === request.scope) setError(failure instanceof Error ? failure.message : String(failure)); });
    }
  };
}
