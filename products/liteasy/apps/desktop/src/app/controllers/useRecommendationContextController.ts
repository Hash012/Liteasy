import { NOTES_SOURCES_CHANGED } from "../features/notes/notesPort";
import type { ObjectRepository } from "../features/objects/objectRepository";
import { useEffect, useRef, useState } from "react";
import { buildRecommendationContext, type RecommendationAssetSelection, type RecommendationContext } from "../features/recommendations/recommendationContext";
import { useRecommendationPreferences } from "../features/recommendations/recommendationPreferences";
import { subscribeObjectStorage } from "../features/objects/objectStorage";
import { subscribeNoteFiles } from "../features/note-files/noteFileService";
import { PAPER_ANNOTATIONS_SAVED_EVENT } from "../features/library/userPaperArtifactClient";
import { recommendationDocument } from "../features/recommendations/recommendationSeed";
import type { AgentAssetService } from "../features/resource-filesystem/agentAssetService";
import type { createPaperProjectRepository } from "../features/paper-projects/paperProjectRepository";
import type { Paper } from "../features/workspace/workspace.types";
import type { RecommendationResearchProfile } from "../features/recommendations/recommendation.types";
export type RecommendationResourceInput = { scope: string; repository?: ObjectRepository; assets?: AgentAssetService; projects?: ReturnType<typeof createPaperProjectRepository>; selected?: RecommendationAssetSelection[] };
const empty: RecommendationContext = { views: [], documents: [], warnings: [] };
export function useRecommendationContextController(input: { enabled: boolean; papers: Paper[]; resources?: RecommendationResourceInput; profile?: RecommendationResearchProfile }) {
  const preferences = useRecommendationPreferences();
  const latest = useRef(input); latest.current = input;
  const scope = input.resources?.scope || "local";
  const signature = JSON.stringify([scope, input.enabled, input.papers.map(recommendationDocument), input.resources?.selected, input.profile, preferences]);
  const [revision, updateRevision] = useState(0);
  const [state, setState] = useState({ signature: "", pending: false, context: empty });
  useEffect(() => {
    if (!input.enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => updateRevision((n) => n + 1), 600); };
    const object = subscribeObjectStorage(scope, changed), files = subscribeNoteFiles(scope, changed);
    window.addEventListener(NOTES_SOURCES_CHANGED, changed); window.addEventListener(PAPER_ANNOTATIONS_SAVED_EVENT, changed); window.addEventListener("storage", changed);
    return () => { object(); files(); clearTimeout(timer); window.removeEventListener(NOTES_SOURCES_CHANGED, changed); window.removeEventListener(PAPER_ANNOTATIONS_SAVED_EVENT, changed); window.removeEventListener("storage", changed); };
  }, [scope, input.enabled]);
  useEffect(() => {
    const abort = new AbortController();
    if (!input.enabled) { setState({ signature, pending: false, context: empty }); return; }
    setState((state) => ({ signature, pending: true, context: state.signature === signature ? state.context : empty }));
    const current = latest.current;
    void buildRecommendationContext({ scope, papers: current.papers, profile: current.profile, preferences, ...current.resources, signal: abort.signal })
      .then((context) => { if (!abort.signal.aborted) setState({ signature, pending: false, context }); }, (error: unknown) => {
        if (!abort.signal.aborted) setState({ signature, pending: false, context: { views: [], documents: current.papers.map(recommendationDocument), warnings: [String(error)] } });
      });
    return () => abort.abort();
  }, [signature, revision]);
  return { preferences, context: state.signature === signature ? state.context : empty, pending: state.signature !== signature || state.pending };
}
