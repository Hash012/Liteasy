import { useEffect, useRef, useState } from "react";
import type { Paper } from "../features/workspace/workspace.types";
import { hasRecommendationDescription, recommendationDocument } from "../features/recommendations/recommendationSeed";

export function hasRecommendationMetadata(paper: Paper) {
  return paper.literature?.status === "confirmed" && Boolean(paper.literature.title.trim()) &&
    paper.literature.identifiers.some((id) => id.source === "public_registry" && id.kind !== "title_authors_year_hash") &&
    hasRecommendationDescription(recommendationDocument(paper));
}
function bibliographicPaper(paper: Paper): Paper {
  return { ...paper, title: paper.literature!.title, authors: paper.literature!.authors, year: paper.literature!.year };
}

/** No filename reaches either recommendation backend while selected papers lack identity. */
export function useRecommendationMetadataController(input: {
  enabled: boolean; papers: Paper[]; workspace: string;
  prepare?: (paper: Paper) => Promise<Paper | undefined>;
}) {
  const latest = useRef(input); latest.current = input;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ scope: string; resolved: Record<string, Paper>; errors: Record<string, string> }>({ scope: input.workspace, resolved: {}, errors: {} });
  const keyOf = (paper: Paper) => JSON.stringify([input.workspace, paper.id, paper.sourcePath, paper.contentHash, paper.title]);
  const pending = useRef(new Map<string, Promise<Paper | undefined>>());
  const signature = JSON.stringify([input.workspace, input.enabled, input.papers.map((paper) => [keyOf(paper), paper.literature])]);
  const generation = useRef(signature); generation.current = signature;
  const validState: Pick<typeof state, "resolved" | "errors"> = state.scope === input.workspace ? state : { resolved: {}, errors: {} };
  const papers = input.papers.flatMap((paper) => {
    const resolved = hasRecommendationMetadata(paper) ? paper : validState.resolved[keyOf(paper)];
    return resolved && hasRecommendationMetadata(resolved) ? [bibliographicPaper(resolved)] : [];
  });
  const missing = input.papers.filter((paper) => !hasRecommendationMetadata(paper) && !validState.resolved[keyOf(paper)]);
  const blocked = input.enabled && missing.length > 0;
  useEffect(() => {
    if (!input.enabled || !missing.length) return;
    let cancelled = false;
    const active = () => !cancelled && generation.current === signature;
    const timer = setTimeout(() => { void (async () => {
      for (const paper of missing) {
        if (!active()) return;
        const key = keyOf(paper);
        if (validState.errors[key]) continue;
        let resolved: Paper | undefined;
        let error = "";
        try {
          if (!latest.current.prepare) throw new Error("请先获取或确认所选论文的元数据。");
          let task = pending.current.get(key);
          if (!task) {
            task = latest.current.prepare(paper);
            pending.current.set(key, task);
            void task.finally(() => pending.current.delete(key)).catch(() => undefined);
          }
          resolved = await task;
          if (!resolved || !hasRecommendationMetadata(resolved)) throw new Error(resolved?.literature?.status === "confirmed"
            ? "题名过短且缺少摘要或学科信息，无法可靠区分同名主题。请获取完整元数据后再推荐。"
            : "元数据尚未确认，请右键论文选择“获取元数据”或“确认文献身份”。");
        } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
        if (!active()) return;
        setState((current) => {
          const value = current.scope === input.workspace ? current : { scope: input.workspace, resolved: {}, errors: {} };
          return error ? { ...value, errors: { ...value.errors, [key]: error } }
            : { ...value, resolved: { ...value.resolved, [key]: resolved! } };
        });
      }
    })(); }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [signature, retry]);
  const errors = missing.map((paper) => validState.errors[keyOf(paper)]).filter(Boolean);
  return { papers, blocked, pending: blocked && errors.length < missing.length,
    message: blocked ? errors.length ? `${missing.length} 篇所选论文尚未完成元数据确认。${errors[0]}`
      : `正在获取所选论文元数据（${papers.length}/${input.papers.length}），完成后生成推荐…` : "",
    retry: () => { setState((current) => ({ ...current, errors: {} })); setRetry((value) => value + 1); }
  };
}
