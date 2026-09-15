import { useEffect, useRef, useState } from "react";
import type { PdfAnnotationReview, PdfAnnotationV2 } from "./pdfAnnotationStorage";

export type PdfEntryReviewState = {
  pending?: boolean;
  error?: string;
  generated?: PdfAnnotationReview;
};

export function usePdfAnnotationReview(input: {
  scopeKey: string | null;
  getAnnotation(id: string): PdfAnnotationV2 | undefined;
  request(annotation: PdfAnnotationV2, signal: AbortSignal): Promise<string>;
  commit(id: string, expectedRevision: number, review: PdfAnnotationReview): Promise<void>;
}) {
  const latest = useRef(input);
  latest.current = input;
  const runs = useRef(new Map<string, AbortController>());
  const [states, setStates] = useState<Record<string, PdfEntryReviewState>>({});
  useEffect(() => {
    setStates({});
    return () => {
      for (const run of runs.current.values()) run.abort();
      runs.current.clear();
    };
  }, [input.scopeKey]);

  function cancel(id: string) {
    runs.current.get(id)?.abort();
    runs.current.delete(id);
    setStates((current) => ({ ...current, [id]: { ...current[id], pending: false } }));
  }

  async function generate(id: string) {
    const annotation = latest.current.getAnnotation(id);
    if (!annotation || runs.current.has(id)) return;
    const scopeKey = latest.current.scopeKey;
    const run = new AbortController();
    runs.current.set(id, run);
    setStates((current) => ({ ...current, [id]: { pending: true } }));
    let generated: PdfAnnotationReview | undefined;
    const active = () => !run.signal.aborted && runs.current.get(id) === run && latest.current.scopeKey === scopeKey;
    try {
      const text = (await latest.current.request(annotation, run.signal)).trim();
      if (!active()) return;
      if (!text) throw new Error("AI 未返回 review 内容，请重试。");
      const now = new Date().toISOString();
      generated = { text, generatedAt: now, updatedAt: now, sourceRevision: annotation.revision };
      const current = latest.current.getAnnotation(id);
      if (!current) throw new Error("该批注已删除，review 未写入其他条目。");
      if (current.revision !== annotation.revision) {
        throw new Error("批注已更改。review 结果已保留，请核对后保存。");
      }
      await latest.current.commit(id, annotation.revision, generated);
      if (active()) setStates((current) => ({ ...current, [id]: {} }));
    } catch (error) {
      if (active()) setStates((current) => ({
        ...current,
        [id]: { generated, error: error instanceof Error ? error.message : "AI review 失败，请重试。" },
      }));
    } finally {
      if (runs.current.get(id) === run) runs.current.delete(id);
    }
  }

  async function save(id: string, expectedRevision: number, review: PdfAnnotationReview) {
    cancel(id);
    const scopeKey = latest.current.scopeKey;
    try {
      await latest.current.commit(id, expectedRevision, review);
      if (latest.current.scopeKey === scopeKey) setStates((current) => ({ ...current, [id]: {} }));
    } catch (error) {
      if (latest.current.scopeKey === scopeKey) setStates((current) => ({
        ...current,
        [id]: { generated: review, error: error instanceof Error ? error.message : "review 保存失败。" },
      }));
      throw error;
    }
  }

  return { states, generate, cancel, save };
}
