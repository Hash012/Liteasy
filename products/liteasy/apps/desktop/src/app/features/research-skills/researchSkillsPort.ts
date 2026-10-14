import { createContext } from "react";
import type { AssistantOrigin } from "../assistant/assistantSessionContracts";
import type { ContextRef } from "../context/objectContext";
import type { ResearchDestination, ResearchSkillSelection } from "./researchDocument";
export type ResearchSkillsPort = {
  createEditableCopy(document: import("./researchDocument").ResearchDocument): Promise<void>;
  destinations: ResearchDestination[];
  start(input: { selection: ResearchSkillSelection; prompt: string; refs: ContextRef[]; origin: AssistantOrigin }): Promise<{ message: string; taskIds: string[] }>;
  retry(taskId: string): Promise<void>;
  cancel(taskId: string): Promise<string>;
};
export const ResearchSkillsContext = createContext<ResearchSkillsPort | null>(null);
