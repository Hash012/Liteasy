export interface Creator {
  firstName?: string;
  lastName?: string;
  name?: string;
  creatorType?: string;
}

export interface Attachment {
  title?: string;
  url?: string;
  mimeType?: string;
  snapshot?: boolean;
}

export interface ReferenceItem {
  itemType: string;
  title: string;
  url: string;
  DOI?: string;
  ISBN?: string;
  ISSN?: string;
  date?: string;
  publicationTitle?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  abstractNote?: string;
  creators: Creator[];
  tags?: (string | { tag: string })[];
  attachments?: Attachment[];
  [key: string]: unknown;
}

export interface SavedItem {
  id: string;
  identity: string;
  item: ReferenceItem;
  collection: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sourceUrl: string;
  translator: string;
  attachments: SavedAttachment[];
  warnings: string[];
}

export interface SavedAttachment {
  id: string;
  title: string;
  mimeType: string;
  url: string;
  size: number;
}

export interface StoredFile extends SavedAttachment {
  blob: Blob;
  itemId: string;
}

export interface CaptureOptions {
  tabId: number;
  snapshot: boolean;
  attachments: boolean;
  collection: string;
  tags: string[];
}

export interface CollectedPage {
  items: ReferenceItem[];
  url: string;
  translator: string;
  snapshot?: string;
  warnings: string[];
}

export interface PageInfo {
  tabId: number;
  title: string;
  url: string;
  translators: { label: string; itemType: string }[];
  isPDF: boolean;
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: string };
