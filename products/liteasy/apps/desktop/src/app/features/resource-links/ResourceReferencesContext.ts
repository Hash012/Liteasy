import { createContext } from "react";
import type { AssistantComposerSuggestion, AssistantContextToken } from "../assistant/assistant.types";
import type { ReferenceDocument, ResourceReferenceService } from "./resourceReferenceService";
import type { ReferenceRange } from "./referenceText";
export type ResourceReferences = {
  picker?: { catalog: import("../context-picker/catalogPort").ContextCatalogPort; activePaperId?: string; workspaceId?: string };
  resolvePickerToken?(member: import("../context-picker/selectionPlan").PlannedMember): Promise<AssistantContextToken>;
  service: ResourceReferenceService;
  suggestions: AssistantComposerSuggestion[];
  open(path: string): void | Promise<void>;
  capture(document: ReferenceDocument, range: ReferenceRange): Promise<AssistantContextToken>;
};
export const ResourceReferencesContext = createContext<ResourceReferences | null>(null);
export const ReferenceSourceContext = createContext<string | undefined>(undefined);
export const ReferenceDepthContext = createContext<readonly string[]>([]);
