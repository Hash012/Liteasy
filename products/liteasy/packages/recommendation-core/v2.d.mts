/**
 * Versioned recommendation v2 port contracts. Runtime adapters validate all boundaries.
 * Owner identity is supplied by the authenticated controller and enforced by object_store.
 * Never trust caller-supplied owner/workspace without host authorization.
 * Validate wire values, bounds, dates, model IDs and evidence permissions at runtime.
 */
export type IsoTime = string;
export type Id = string;
export type Revision = string;
export type FeedbackAction =
  | "useful" | "not_relevant" | "saved" | "read" | "mastered"
  | "snoozed" | "too_basic" | "too_advanced" | "undo";

export interface AuthorizedScope {
  readonly ownerId: Id; // resolved from the authenticated local/remote identity
  readonly workspaceId: Id;
  readonly policyEpoch: number;
}

export interface EvidenceRef {
  readonly evidenceId: Id;
  readonly resourcePath: string; // reuse existing authorized liteasy:// resource references
  readonly sourceRevision: Revision;
  readonly contentHash: string;
  readonly classification: "public_verified" | "private" | "unknown";
  readonly anchor?: string; // absent unless a real parsed anchor exists
}

export interface EventBase {
  readonly schemaVersion: 2;
  readonly eventId: Id;
  readonly producerActionId: Id;
  readonly scope: AuthorizedScope;
  readonly occurredAt: IsoTime;
  readonly recordedAt: IsoTime;
  readonly source: EvidenceRef;
  readonly supersedesEventId?: Id;
  readonly consentEpoch: number;
  readonly attribution?: {
    readonly origin: "organic" | "recommendation" | "preset";
    readonly snapshotId?: Id;
    readonly candidateId?: Id;
  };
}

// No automatic-assistant-answer or UI-selection event is a preference signal.
export type RecommendationEvent = EventBase & (
  | { readonly type: "annotation_committed";
      readonly payload: { readonly kind: "highlight" | "user_note"; readonly semanticContentChanged: boolean } }
  | { readonly type: "user_question_committed";
      readonly payload: { readonly messageId: Id; readonly actor: "user"; readonly userAuthored: boolean } }
  | { readonly type: "qualified_reading_interval";
      readonly payload: { readonly documentId: Id; readonly sessionId: Id;
        readonly activeMilliseconds: number; readonly intervalId: Id; readonly monotonicClockSource: string } }
  | { readonly type: "accepted_insight";
      readonly payload: { readonly acceptanceActionId: Id; readonly acceptedByUser: true } }
  | { readonly type: "topic_instruction";
      readonly payload: { readonly facetId: Id; readonly instruction: "follow" | "exclude" | "pause" | "resume" } }
  | { readonly type: "feedback";
      readonly payload: { readonly candidateId: Id; readonly action: FeedbackAction;
        readonly facetId?: Id; readonly snapshotId?: Id; readonly undoOf?: Id; readonly snoozeUntil?: IsoTime } }
  | { readonly type: "visible_impression";
      readonly payload: { readonly candidateId: Id; readonly snapshotId: Id; readonly position: number;
        readonly visibleFraction: number; readonly visibleMilliseconds: number } }
);

export interface InterestFacet {
  readonly id: Id;
  readonly version: Revision;
  readonly label: string;
  readonly problem: string;
  readonly methods: readonly string[];
  readonly tasksOrDatasets: readonly string[];
  readonly metrics: readonly string[];
  readonly stage: "learning" | "mapping" | "hypothesis" | "experiment" | "writing" | "unspecified";
  readonly unresolvedQuestions: readonly { readonly id: Id; readonly text: string; readonly evidenceIds: readonly Id[] }[];
  readonly status: "tentative" | "confirmed" | "pinned" | "paused";
  readonly evidenceIds: readonly Id[];
  readonly exclusions: readonly { readonly text: string; readonly explicit: boolean; readonly evidenceIds: readonly Id[] }[];
  readonly confidenceBand: "limited" | "moderate" | "strong"; // not a calibrated probability
  readonly centroid?: { readonly embeddingSpaceId: string; readonly vectorRecordId: Id };
}

export interface RecommendationCard {
  readonly candidateId: Id; // MUST belong to the validated candidate snapshot
  readonly canonicalId: string;
  readonly title: string; // canonical provider/asset title, not an LLM-invented title
  readonly facetIds: readonly Id[];
  readonly role: "next_read" | "alternative" | "foundation" | "bridge" | "new_evidence";
  readonly reason: { readonly text: string; readonly userEvidenceIds: readonly Id[];
    readonly candidateEvidenceRefs: readonly EvidenceRef[];
    readonly basis: "metadata_only" | "abstract" | "verified_section";
    readonly origin: "deterministic" | "model_assisted" };
  readonly suggestedReading?: { readonly target: "abstract" | "section";
    readonly anchor?: string; readonly estimatedEffort: "brief" | "moderate" | "unknown" };
  readonly scoreDiagnostics?: { readonly recipe: string; readonly relevanceRank: number;
    readonly coverageContribution: number; readonly noveltyPenalty: number };
}

export interface FeedSnapshot {
  readonly schemaVersion: 2;
  readonly snapshotId: Id;
  readonly scope: AuthorizedScope;
  readonly feedId: Id;
  readonly generationId: Id;
  readonly profileVersion: Revision;
  readonly settingsVersion: Revision;
  readonly candidateSnapshotId: Id;
  readonly feedbackRevision: Revision;
  readonly recipeVersion: string;
  readonly modelRevisions: readonly string[];
  readonly generatedAt: IsoTime;
  readonly expiresAt: IsoTime;
  readonly evidenceWatermark: Revision;
  readonly items: readonly RecommendationCard[]; // length <= configured K; zero is valid
  readonly mode: "lexical" | "hybrid" | "model_assisted";
  readonly completeness: "complete" | "partial_sources" | "legacy_pool";
}

export interface SeedSnapshot {
  readonly id: Id;
  readonly scope: AuthorizedScope;
  readonly createdAt: IsoTime;
  readonly sources: readonly EvidenceRef[];
  readonly userActionId: Id; // only explicit submit creates this object
}

export interface RefreshRequest {
  readonly requestId: Id; // durable idempotency key; retries keep the same ID
  readonly feedId: Id;
  readonly reason: "initial" | "scheduled" | "manual_check" | "explicit_seed";
  readonly seedSnapshotId?: Id;
  readonly expectedProfileVersion: Revision;
  readonly expectedSettingsVersion: Revision;
  readonly expectedPolicyEpoch: number;
}
export type RefreshDecision =
  | { readonly kind: "cache_hit"; readonly snapshot: FeedSnapshot }
  | { readonly kind: "queued" | "joined_inflight"; readonly jobId: Id }
  | { readonly kind: "cooldown"; readonly reason: "quota" | "provider" | "interval"; readonly retryAt: IsoTime }
  | { readonly kind: "disabled" | "empty"; readonly reason: string };

export interface RecommendationCoordinator {
  getSnapshot(scope: AuthorizedScope, feedId: Id): Promise<FeedSnapshot | null>;
  requestRefresh(scope: AuthorizedScope, request: RefreshRequest): Promise<RefreshDecision>;
  recordEvent(scope: AuthorizedScope, event: RecommendationEvent): Promise<{ readonly duplicate: boolean; readonly projectionRevision: Revision }>;
  recordFeedback(scope: AuthorizedScope, input: {
    readonly actionId: Id; readonly candidateId: Id; readonly snapshotId: Id;
    readonly facetId?: Id; readonly action: FeedbackAction; readonly undoOf?: Id; readonly snoozeUntil?: IsoTime;
  }): Promise<{ readonly feedbackRevision: Revision }>;
  acceptPendingSnapshot(scope: AuthorizedScope, input: {
    readonly feedId: Id; readonly snapshotId: Id; readonly expectedPolicyEpoch: number;
  }): Promise<FeedSnapshot>;
  forgetSources(scope: AuthorizedScope, input: {
    readonly actionId: Id; readonly sourceIds: readonly Id[]; readonly expectedPolicyEpoch: number;
  }): Promise<{ readonly policyEpoch: number; readonly immediatelyMasked: true; readonly physicalCleanup: "queued" | "complete" }>;
  subscribe(scope: AuthorizedScope, feedId: Id, listener: (event: {
    readonly kind: "snapshot_available" | "display_invalidated" | "status_changed";
    readonly snapshotId?: Id;
  }) => void): () => void;
}

export interface PublishGuard {
  readonly scope: AuthorizedScope;
  readonly leaseFencingToken: number;
  readonly generationId: Id;
  readonly expectedProfileVersion: Revision;
  readonly expectedSettingsVersion: Revision;
  readonly expectedSourceWatermark: Revision;
}

export interface BudgetReceipt {
  readonly reservationId: Id;
  readonly workspaceId: Id;
  readonly credentialScopeHash: string;
  readonly providerRequests: number;
  readonly embeddingRequests: number;
  readonly rerankerRequests: number;
  readonly generationRequests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly embeddingTokens: number;
  readonly accounting: "measured" | "conservative_estimate";
  readonly cost?: { readonly amount: number; readonly currency: string; readonly priceVersion: string };
}
