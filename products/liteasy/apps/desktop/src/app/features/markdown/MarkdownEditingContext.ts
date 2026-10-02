import { createContext, useContext } from "react";

export type MarkdownEditingPreference = { mode: "live" | "manual"; autosave: boolean };
// Standalone consumers retain the legacy mode; the app injects the persisted preference (live by default).
export const MarkdownEditingContext = createContext<MarkdownEditingPreference>({ mode: "manual", autosave: false });
export const useMarkdownEditing = () => useContext(MarkdownEditingContext);
