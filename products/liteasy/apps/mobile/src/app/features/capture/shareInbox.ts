import { hasNativeHost, nativeRequest } from "../../platform/native";
import type { LibraryItem } from "../library/library.types";

export type SharedCapture = {
  id: string; title: string; state: "capturing" | "ready" | "error";
  receivedAt: string; filename?: string; mimeType?: string; size?: number;
  text?: string; sourceUrl?: string; collection: string; note: string; error?: string;
};
export type CaptureEdit = Pick<SharedCapture, "title" | "collection" | "note">;
export interface ShareInbox {
  list(): Promise<SharedCapture[]>;
  import(scope: string, id: string, input: CaptureEdit): Promise<LibraryItem>;
  discard(id: string): Promise<void>;
}
export const shareInbox: ShareInbox = {
  list: () => hasNativeHost() ? nativeRequest<SharedCapture[]>("listShares") : Promise.resolve([]),
  import: (scope, id, input) => nativeRequest<LibraryItem>("importShare", { scope, id, input }),
  discard: (id) => nativeRequest<void>("discardShare", { id })
};
