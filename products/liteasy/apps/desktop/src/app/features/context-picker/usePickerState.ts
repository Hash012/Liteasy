import { useCallback, useEffect, useRef, useState } from "react";
import { browserStateKey, defaultLocation, draftStateKey, navigatePicker, readBrowserState, readPickerRecord, routeKey, traversePickerHistory, writePickerRecord, type PickerLocation, type PickerPurpose, type PickerRoute } from "./pickerState";
import { addSelectionIntent, emptySelectionDraft, excludeSelectionMembers, readSelectionDraft, selectionMembers, type SelectionIntent } from "./selectionPlan";

export function usePickerState(input: { scope: string; workspace?: string; purpose: PickerPurpose; targetDraftId: string; browseDraftId?: string; root: string; initialQuery?: string; initialPreviewId?: string }) {
  const browseKey = browserStateKey(input.scope, input.workspace ?? "library", input.purpose, input.browseDraftId ?? input.targetDraftId);
  const draftKey = draftStateKey(input.scope, input.workspace ?? "library", input.purpose, input.targetDraftId);
  const [browse, setBrowse] = useState(() => {
    const oldKey = browserStateKey(input.scope, input.workspace ?? "library", input.purpose);
    const legacy = readPickerRecord<{ schemaVersion?: number }>(oldKey);
    const state = readBrowserState(!readPickerRecord(browseKey) && legacy?.schemaVersion === 2 ? oldKey : browseKey, input.scope, input.root);
    const key = routeKey(state.route), location = { ...defaultLocation(), ...state.locations[key] };
    if (input.initialQuery) { state.route = ["types"]; location.query = input.initialQuery; }
    if (input.initialPreviewId) { state.route = ["types"]; location.previewId = input.initialPreviewId; }
    state.locations[routeKey(state.route)] = location;
    if (input.initialQuery || input.initialPreviewId) { state.history = [state.route]; state.historyIndex = 0; }
    return state;
  });
  useEffect(() => {
    const legacyKey = browserStateKey(input.scope, input.workspace ?? "library", input.purpose);
    if (readPickerRecord<{ schemaVersion?: number }>(legacyKey)?.schemaVersion === 2) {
      writePickerRecord(legacyKey, readBrowserState(legacyKey, input.scope, input.root));
    }
  }, [input.scope, input.workspace, input.purpose, input.root]);
  const [draft, setDraft] = useState(() => readSelectionDraft(readPickerRecord(draftKey)));
  const latest = useRef({ browse, draft }); latest.current = { browse, draft };
  useEffect(() => { const timer = setTimeout(() => writePickerRecord(browseKey, browse), 180); return () => clearTimeout(timer); }, [browseKey, browse]);
  useEffect(() => { writePickerRecord(draftKey, draft); }, [draftKey, draft]);
  useEffect(() => () => { writePickerRecord(browseKey, latest.current.browse); writePickerRecord(draftKey, latest.current.draft); }, [browseKey, draftKey]);
  const location = { ...defaultLocation(), ...browse.locations[routeKey(browse.route)] };
  const setLocation = useCallback((patch: Partial<PickerLocation>) => setBrowse(state => ({ ...state, locations: { ...state.locations, [routeKey(state.route)]: { ...defaultLocation(), ...state.locations[routeKey(state.route)], ...patch } } })), []);
  const setActiveKind = (activeKind: string) => setBrowse(state => {
    const old = { ...defaultLocation(), ...state.locations[routeKey(state.route)] };
    if (old.activeKind === activeKind) return state;
    const paperIndex = state.route.findIndex(id => id.startsWith("paper:"));
    const route = paperIndex >= 0 ? state.route.slice(0, paperIndex + 1) : state.route;
    const next = navigatePicker(state, route);
    return { ...next, locations: { ...next.locations, [routeKey(route)]: { ...old, activeKind, page: 0, anchor: undefined, focusId: undefined } } };
  });
  const navigate = (route: PickerRoute) => setBrowse(state => navigatePicker(state, route));
  const switchEntry = (entry: string, patch?: Partial<PickerLocation>) => setBrowse(state => {
    const next = navigatePicker(state, state.entries[entry] ?? [entry]);
    return patch ? { ...next, locations: { ...next.locations, [routeKey(next.route)]: { ...defaultLocation(), ...next.locations[routeKey(next.route)], ...patch } } } : next;
  });
  const select = (intent: SelectionIntent) => setDraft(state => addSelectionIntent(state, intent));
  const exclude = (ids: readonly string[]) => setDraft(state => excludeSelectionMembers(state, ids));
  return { browse, location, setLocation, setActiveKind, navigate, switchEntry, back: () => setBrowse(state => traversePickerHistory(state, -1)), forward: () => setBrowse(state => traversePickerHistory(state, 1)),
    draft, setDraft, members: selectionMembers(draft), select, exclude, clear: () => setDraft(emptySelectionDraft()) };
}
