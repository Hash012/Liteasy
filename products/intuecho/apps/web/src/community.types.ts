import type {
  AnnotationTarget as ContractAnnotationTarget,
  LiteratureReference as ContractLiteratureReference,
  LiteratureCandidate,
  LiteratureConfirmInput,
  LiteratureRecord,
  LiteratureResolveInput,
  LiteratureResolveResult,
  UpdateReplyPublicationInput
} from "@intuecho/contracts";

export type {
  AnnotationTarget as ContractAnnotationTarget,
  LiteratureReference as ContractLiteratureReference,
  LiteratureCandidate,
  LiteratureConfirmInput,
  LiteratureRecord,
  LiteratureResolveInput,
  LiteratureResolveResult,
  UpdateReplyPublicationInput
} from "@intuecho/contracts";

export type PaperIdentity = {
  id: string;
  kind: "doi" | "arxiv_id" | "semantic_scholar_id" | "openalex_id" | "openreview_id" | "dblp_key" | "pmlr_id" | "title_authors_year_hash";
  source: "inferred" | "metadata";
  value: string;
};

export type LiteratureReference = ContractLiteratureReference;
export type AnnotationTarget = ContractAnnotationTarget;
type LiteratureReadReference<T> = T & { literatureRecord?: LiteratureRecord };
type AnnotationReadEvidence<T> = T extends { literature: infer Reference }
  ? Omit<T, "literature"> & { literature: LiteratureReadReference<Reference> }
  : T;
type AnnotationReadProjection<T> = T extends { literature: infer Reference }
  ? Omit<T, "evidence" | "literature"> &
      { literature: LiteratureReadReference<Reference> } &
      (T extends { evidence: Array<infer Evidence> } ? { evidence: Array<AnnotationReadEvidence<Evidence>> } : {})
  : T;
export type AnnotationReadTarget = AnnotationReadProjection<ContractAnnotationTarget>;

export type AnnotationVisibility = "private" | "organization" | "mutual_followers" | "public";

export type CommunityAnnotation = {
  author: {
    id: string;
    initials: string;
    name: string;
    profile: {
      educationStage: string | null;
      institutions: Array<{ name: string }>;
    };
  };
  body: string;
  createdAt: string;
  id: string;
  organizationId: string | null;
  originalReply: { replyId: string; status: "available" | "parent_deleted" } | null;
  ratingAverage: number | null;
  ratingCount: number;
  revision: number;
  shareToPlaza: boolean;
  tags: Array<{ confidence: number | null; name: string; origin: "platform" | "user"; state: "active" | "appealed" | "upheld" }>;
  targets: AnnotationReadTarget[];
  updatedAt: string;
  viewerCanModerate: boolean;
  viewerIsAuthor: boolean;
  viewerSaved: boolean;
  viewerRating: number | null;
  visibility: AnnotationVisibility;
  withdrawnAt: string | null;
};

export type OrganizationAnnotationGroup = {
  annotations: CommunityAnnotation[];
  name: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
};

export type CreateAnnotationInput = {
  body: string;
  organizationId?: string;
  shareToPlaza: boolean;
  tags: string[];
  targets: AnnotationTarget[];
  visibility: AnnotationVisibility;
};

export type AcademicProfile = {
  educationStage: string | null;
  institutions: Array<{ name: string }>;
  revision: number;
};

export type CommunityReply = {
  author: CommunityAnnotation["author"];
  body: string;
  createdAt: string;
  derivedAnnotationId: string | null;
  derivedAnnotationState: "none" | "published" | "withdrawn";
  id: string;
  parentAnnotationId: string;
  revision: number;
  updatedAt: string;
  viewerIsAuthor: boolean;
};

export type DirectMessage = {
  body: string;
  createdAt: string;
  id: string;
  invitation: Record<string, string> | null;
  kind: "text" | "organization_invitation";
  senderId: string;
};

export type ConversationSummary = {
  canSend: boolean;
  createdAt: string;
  id: string;
  lastMessage: Omit<DirectMessage, "id"> | null;
  participant: CommunityAnnotation["author"];
  unreadCount: number;
};

export type CreateReplyInput = {
  body: string;
  publishAsAnnotation: boolean;
  tags: string[];
  targets: AnnotationTarget[];
};

export type ReplyPublicationInput = UpdateReplyPublicationInput;

export type PlazaFilters = {
  documentType?: string;
  educationStage?: string;
  institution?: string;
  limit?: number;
  literatureId?: string;
  literatureIdentityKind?: PaperIdentity["kind"];
  literatureIdentityValue?: string;
  query?: string;
  sort?: "latest" | "recommended";
};
