import { NOTES_SOURCES_CHANGED } from "../features/notes/notesPort";
import type { ObjectRepository } from "../features/objects/objectRepository";
import { useEffect, useRef, useState } from "react";
import { buildRecommendationContext, type RecommendationAssetSelection, type RecommendationContext } from "../features/recommendations/recommendationContext";
import { useRecommendationPreferences } from "../features/recommendations/recommendationPreferences";
import { subscribeObjectStorage } from "../features/objects/objectStorage";
import { subscribeNoteFiles } from "../features/note-files/noteFileService";
import { PAPER_ANNOTATIONS_SAVED_EVENT } from "../features/library/userPaperArtifactClient";
import { pdfAnnotationStorageKey } from "../features/pdf/pdfAnnotationStorage";
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
  const [state, setState] = useState({ signature: "", pending: false, ready: false, context: empty });
  useEffect(() => {
    if (!input.enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => updateRevision((n) => n + 1), 600); };
    // Reader positions, Dock state and recommendation cache writes do not change recommendation evidence.
    const object = subscribeObjectStorage(scope, (keys) => {
      if (!keys || keys.some((key) => /^(head\/|relation\/|paper-project\/(project|asset)\/|object-file\/|board-file\/|reading-library\/(file|metadata)\/)/.test(key))) changed();
    });
    const files = subscribeNoteFiles(scope, changed);
    const annotationsChanged = (event: Event) => {
      const paperId = (event as CustomEvent<unknown>).detail;
      if (latest.current.papers.some((paper) => paper.id === paperId)) changed();
    };
    const storedAnnotationsChanged = (event: StorageEvent) => {
      if (event.key === null || latest.current.papers.some((paper) => pdfAnnotationStorageKey(paper) === event.key)) changed();
    };
    window.addEventListener(NOTES_SOURCES_CHANGED, changed); window.addEventListener(PAPER_ANNOTATIONS_SAVED_EVENT, annotationsChanged); window.addEventListener("storage", storedAnnotationsChanged);
    return () => { object(); files(); clearTimeout(timer); window.removeEventListener(NOTES_SOURCES_CHANGED, changed); window.removeEventListener(PAPER_ANNOTATIONS_SAVED_EVENT, annotationsChanged); window.removeEventListener("storage", storedAnnotationsChanged); };
  }, [scope, input.enabled]);
  useEffect(() => {
    const abort = new AbortController();
    if (!input.enabled) { setState({ signature, pending: false, ready: false, context: empty }); return; }
    setState((state) => ({ signature, pending: true, ready: state.signature === signature && state.ready, context: state.signature === signature ? state.context : empty }));
    const current = latest.current;
    void buildRecommendationContext({ scope, papers: current.papers, profile: current.profile, preferences, ...current.resources, signal: abort.signal })
      .then((context) => { if (!abort.signal.aborted) setState({ signature, pending: false, ready: true, context }); }, (error: unknown) => {
        if (!abort.signal.aborted) setState({ signature, pending: false, ready: true, context: { views: [], documents: current.papers.map(recommendationDocument), warnings: [String(error)] } });
      });
    return () => abort.abort();
  }, [signature, revision]);
  return { preferences, context: state.signature === signature ? state.context : empty, pending: state.signature !== signature || state.pending && !state.ready };
}
