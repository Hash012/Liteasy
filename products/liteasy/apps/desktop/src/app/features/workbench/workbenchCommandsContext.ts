import { createContext, useContext } from "react";
import type { WorkbenchCommandAvailability, WorkbenchCommandId } from "./workbenchCommands";

export const WorkbenchCommandsContext = createContext<((command: WorkbenchCommandId) => void) | null>(null);
export const useWorkbenchCommands = () => useContext(WorkbenchCommandsContext);

export const WorkbenchCommandAvailabilityContext = createContext<WorkbenchCommandAvailability>({});
export const useWorkbenchCommandAvailability = () => useContext(WorkbenchCommandAvailabilityContext);
