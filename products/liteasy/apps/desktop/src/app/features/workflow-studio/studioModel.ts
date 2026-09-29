import type { ExtensionDraftStore, ExtensionDraft, DraftChange } from "./extensionDraftStore";
import type { ExtensionStudioService } from "./extensionStudioService";
export type StudioModel = {
  drafts: ExtensionDraftStore;
  service: ExtensionStudioService;
  propose(draft: ExtensionDraft, request: string, signal: AbortSignal): Promise<DraftChange[]>;
};
