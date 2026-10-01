import { createContext, useContext } from "react";
import type { SettingsState } from "../settings/settings.types";

export const GenerationPromptContext = createContext<Partial<SettingsState>>({});
export function useGenerationPromptSettings() { return useContext(GenerationPromptContext); }
