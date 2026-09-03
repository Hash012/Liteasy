import type { UIDslComponentName, UIDslDataSourceId } from "../generative-ui/generativeUi.types";

export const LITEASY_EXTENSION_API_VERSION = "liteasy.extension/v1" as const;
export const LITEASY_READER_SELECTION_VERSION = "liteasy.reader-selection/v1" as const;

export type ExtensionPermission =
  | "artifact.renderer.register"
  | "reader.command.register"
  | "reader.context_menu.register"
  | "reader.selection.read"
  | "reader.selection.subscribe"
  | "ui.side_panel.register";

export type ExtensionEventName = "reader.selection.changed";
export type ExtensionServiceName = "reader.selection.get";

export type ReaderSelectionRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export type ReaderSelectionSnapshotV1 = {
  excerpt: string;
  page: number;
  paperId: string;
  paperTitle: string;
  rects: ReaderSelectionRect[];
  selectionId: string;
  version: typeof LITEASY_READER_SELECTION_VERSION;
};

export type ExtensionCommandContribution = {
  handlerId: string;
  id: string;
  title: string;
};

export type ExtensionContextMenuContribution = {
  commandId: string;
  group: "assistant" | "navigation" | "tools";
  id: string;
  when: "reader.has_selection";
};

export type ExtensionSidePanelContribution = {
  component: UIDslComponentName;
  dataSources: UIDslDataSourceId[];
  id: string;
  title: string;
};

export type ExtensionArtifactRendererContribution = {
  artifactType: string;
  component: UIDslComponentName;
  dataSources: UIDslDataSourceId[];
  id: string;
};

export type ExtensionEventSubscription = {
  event: ExtensionEventName;
  handlerId: string;
};

export type ExtensionManifestV1 = {
  apiVersion: typeof LITEASY_EXTENSION_API_VERSION;
  contributes: {
    artifactRenderers: ExtensionArtifactRendererContribution[];
    commands: ExtensionCommandContribution[];
    contextMenus: ExtensionContextMenuContribution[];
    sidePanels: ExtensionSidePanelContribution[];
  };
  handlers: string[];
  id: string;
  name: string;
  permissions: ExtensionPermission[];
  subscriptions: ExtensionEventSubscription[];
  uses: {
    services: ExtensionServiceName[];
  };
  version: string;
};

export type ExtensionHandlerTrigger =
  | {
      event: "reader.selection.changed";
      kind: "event";
    }
  | {
      commandId: string;
      kind: "command";
    };

export type ExtensionHandlerRequest = {
  apiVersion: typeof LITEASY_EXTENSION_API_VERSION;
  extensionId: string;
  handlerId: string;
  payload: Record<string, unknown>;
  trigger: ExtensionHandlerTrigger;
};

export type ExtensionHandlerResult = {
  data?: unknown;
  message?: string;
  status: "ok" | "rejected";
};

export type ExtensionDispatchResult = {
  error?: string;
  extensionId: string;
  handlerId: string;
  result?: ExtensionHandlerResult;
  status: "fulfilled" | "rejected";
};

export type ExtensionApiDescriptor = {
  apiVersion: typeof LITEASY_EXTENSION_API_VERSION;
  components: Array<{
    component: UIDslComponentName;
    supportedSurfaces: string[];
  }>;
  dataSources: UIDslDataSourceId[];
  events: ExtensionEventName[];
  permissions: ExtensionPermission[];
  services: ExtensionServiceName[];
};
