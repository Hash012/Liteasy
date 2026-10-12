/** A pinned navigation request must not silently open the current version. */
export type AssetOpenLocation = { revision: string; line?: number; quote?: string; scopeId: string };
export type OpenAgentAsset = (path: string, location?: AssetOpenLocation) => void | Promise<void>;
