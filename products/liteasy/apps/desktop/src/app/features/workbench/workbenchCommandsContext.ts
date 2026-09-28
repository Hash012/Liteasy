import { createContext, useContext } from "react";
import type { WorkbenchCommandId } from "./workbenchCommands";

export const WorkbenchCommandsContext = createContext<((command: WorkbenchCommandId) => void) | null>(null);
export const useWorkbenchCommands = () => useContext(WorkbenchCommandsContext);
