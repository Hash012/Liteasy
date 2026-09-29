import type { StudioModel } from "../workflow-studio/studioModel";
import type { ExtensionWorkflowModel } from "../workflows/extensionWorkflowModel";
import { createContext, useContext } from "react";
import type { ExtensionPackagesModel } from "./useExtensionPackages";
import type { ExtensionWorkspaceStore, ExtensionViewInstance } from "./extensionWorkspaceStore";
import type { JsonObject } from "./extensionSchema";

export type ExtensionWorkbench = {
  packages: ExtensionPackagesModel;
  workflows?: ExtensionWorkflowModel;
  studio?: StudioModel;
  openRuns(): void;
  workspace: ExtensionWorkspaceStore;
  views: ExtensionViewInstance[];
  error: string;
  openView(owner: string, viewId: string, args?: JsonObject, instanceId?: string): Promise<void>;
  openLink(path: string): Promise<void>;
  openStudio(): void;
  invoke(owner: string, command: string, selection?: string[]): Promise<void>;
  refreshViews(): Promise<void>;
};
export const ExtensionWorkbenchContext = createContext<ExtensionWorkbench | null>(null);
export const useExtensionWorkbench = () => useContext(ExtensionWorkbenchContext);
