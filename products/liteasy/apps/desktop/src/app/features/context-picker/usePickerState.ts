import { useCallback, useEffect, useRef, useState } from "react";
import { browserStateKey, defaultLocation, draftStateKey, navigatePicker, readBrowserState, readPickerRecord, routeKey, traversePickerHistory, writePickerRecord, type PickerLocation, type PickerPurpose, type PickerRoute } from "./pickerState";
import { addSelectionIntent, emptySelectionDraft, excludeSelectionMembers, readSelectionDraft, selectionMembers, type SelectionIntent } from "./selectionPlan";

export function usePickerState(input: { scope: string; workspace?: string; purpose: PickerPurpose; targetDraftId: string; root: string; initialQuery?: string; initialPreviewId?: string }) {
  const browseKey = browserStateKey(input.scope, input.workspace ?? "library", input.purpose);
  const draftKey = draftStateKey(input.scope, input.workspace ?? "library", input.purpose, input.targetDraftId);
  const [browse, setBrowse] = useState(() => {
    const state = readBrowserState(browseKey, input.scope, input.root);
    const key = routeKey(state.route), location = { ...defaultLocation(), ...state.locations[key] };
    if (input.initialQuery) { state.route = ["types"]; location.query = input.initialQuery; }
    if (input.initialPreviewId) { state.route = ["types"]; location.previewId = input.initialPreviewId; }
    state.locations[routeKey(state.route)] = location;
    if (input.initialQuery || input.initialPreviewId) { state.history = [state.route]; state.historyIndex = 0; }
    return state;
  });
  const [draft, setDraft] = useState(() => readSelectionDraft(readPickerRecord(draftKey)));
  const latest = useRef({ browse, draft }); latest.current = { browse, draft };
  useEffect(() => { writePickerRecord(browseKey, browse); }, [browseKey, browse]);
  useEffect(() => { writePickerRecord(draftKey, draft); }, [draftKey, draft]);
  useEffect(() => () => { writePickerRecord(browseKey, latest.current.browse); writePickerRecord(draftKey, latest.current.draft); }, [browseKey, draftKey]);
  const location = { ...defaultLocation(), ...browse.locations[routeKey(browse.route)] };
  const setLocation = useCallback((patch: Partial<PickerLocation>) => setBrowse(state => ({ ...state, locations: { ...state.locations, [routeKey(state.route)]: { ...defaultLocation(), ...state.locations[routeKey(state.route)], ...patch } } })), []);
  const navigate = (route: PickerRoute) => setBrowse(state => navigatePicker(state, route));
  const switchEntry = (entry: string) => setBrowse(state => navigatePicker(state, state.entries[entry] ?? [entry]));
  const select = (intent: SelectionIntent) => setDraft(state => addSelectionIntent(state, intent));
  const exclude = (ids: readonly string[]) => setDraft(state => excludeSelectionMembers(state, ids));
  return { browse, location, setLocation, navigate, switchEntry, back: () => setBrowse(state => traversePickerHistory(state, -1)), forward: () => setBrowse(state => traversePickerHistory(state, 1)),
    draft, setDraft, members: selectionMembers(draft), select, exclude, clear: () => setDraft(emptySelectionDraft()) };
}
