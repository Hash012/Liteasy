import type { ArtifactTask } from "./artifact.types";
import { findThinReadingChildBySource } from "../thin-reading/thinReadingProjection";
import type {
  ThinReadingBranchSource,
  ThinReadingDocument,
  ThinReadingNode
} from "../thin-reading/thinReading.types";

const storageKey = "liteasy.artifact-task-recovery/v1";

const maxExcerptLength = 6000;
const maxPromptLength = 1200;
const maxSourceReferenceCount = 64;
const maxSectionLabelLength = 96;
const maxSectionKeyLength = 96;
const maxPersistedTaskCount = 6;
const maxPersistedTaskMessageLength = 480;

export type ThinReadingBranchRecoverySnapshot = {
  artifactId: string;
  documentVersion: "liteasy.thin-reading/v1";
  parentNodeId: string;
  primaryPaperId: string;
  source: ThinReadingBranchSource;
};

type PersistedTask = Pick<ArtifactTask, "agentRunId" | "artifactId" | "id" | "message" | "progress" | "stage" | "thinReadingBranchRecovery" | "type" | "status">;

function isUniqueBoundedStringArray(value: unknown) {
  return Array.isArray(value) && value.length <= maxSourceReferenceCount &&
    value.every((item) => typeof item === "string" && item.trim().length > 0) &&
    new Set(value).size === value.length;
}

function isRecoverableBranchSource(value: unknown): value is ThinReadingBranchSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (source.kind === "omitted_section") {
    return typeof source.label === "string" && source.label.trim().length > 0 &&
      source.label.length <= maxSectionLabelLength &&
      typeof source.sectionKey === "string" && source.sectionKey.trim().length > 0 &&
      source.sectionKey.length <= maxSectionKeyLength;
  }
  if (source.kind !== "selected_text" || typeof source.excerpt !== "string" ||
    source.excerpt.trim().length === 0 || source.excerpt.length > maxExcerptLength) return false;
  return (source.prompt === undefined ||
      (typeof source.prompt === "string" && source.prompt.length <= maxPromptLength)) &&
    (source.evidenceIds === undefined || isUniqueBoundedStringArray(source.evidenceIds)) &&
    (source.externalSourceIds === undefined || isUniqueBoundedStringArray(source.externalSourceIds));
}

function isThinReadingBranchRecoverySnapshot(value: unknown): value is ThinReadingBranchRecoverySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.artifactId === "string" && snapshot.artifactId.trim().length > 0 &&
    snapshot.documentVersion === "liteasy.thin-reading/v1" &&
    typeof snapshot.parentNodeId === "string" && snapshot.parentNodeId.trim().length > 0 &&
    typeof snapshot.primaryPaperId === "string" && snapshot.primaryPaperId.trim().length > 0 &&
    isRecoverableBranchSource(snapshot.source);
}

export function createThinReadingBranchRecoverySnapshot(input: {
  artifactId: string;
  document: ThinReadingDocument;
  parentNodeId: string;
  primaryPaperId: string;
  source: ThinReadingBranchSource;
}): ThinReadingBranchRecoverySnapshot {
  const snapshot: ThinReadingBranchRecoverySnapshot = {
    artifactId: input.artifactId,
    documentVersion: input.document.version,
    parentNodeId: input.parentNodeId,
    primaryPaperId: input.primaryPaperId,
    source: input.source
  };
  if (!isThinReadingBranchRecoverySnapshot(snapshot)) {
    throw new Error("薄读分支输入超出可恢复范围，无法安全保存重提交快照。");
  }
  return snapshot;
}

function excerptIsAuditable(source: Extract<ThinReadingBranchSource, { kind: "selected_text" }>, parent: ThinReadingNode) {
  const text = source.excerpt.trim();
  return parent.summary.replace(/\s+/g, "").includes(text.replace(/\s+/g, ""));
}

export function validateThinReadingBranchRecoverySnapshot(
  snapshot: ThinReadingBranchRecoverySnapshot,
  document: ThinReadingDocument
): { valid: true } | { valid: false; reason: string } {
  if (snapshot.documentVersion !== document.version || snapshot.artifactId !== document.artifactId) {
    return { valid: false, reason: "薄读文档版本或产物标识已变化。" };
  }
  if (!document.paperIds.includes(snapshot.primaryPaperId)) {
    return { valid: false, reason: "薄读主论文已不在当前文档中。" };
  }
  const parent = document.nodes[snapshot.parentNodeId];
  if (!parent) return { valid: false, reason: "原分支父节点已不存在。" };
  if (findThinReadingChildBySource(document, parent.id, snapshot.source)) {
    return { valid: false, reason: "当前文档已包含同一薄读分支。" };
  }
  if (snapshot.source.kind === "omitted_section") {
    const source = snapshot.source;
    return parent.omittedSections.some((section) => (
      section.sectionKey === source.sectionKey && section.label === source.label
    ))
      ? { valid: true }
      : { valid: false, reason: "原未覆盖模块已不在父页面的可深入列表中。" };
  }
  const evidenceIds = new Set([...parent.evidence.paperEvidence, ...(parent.evidence.paperEvidenceSpans ?? []).map((span) => span.id)]);
  if ((snapshot.source.evidenceIds ?? []).some((id) => !evidenceIds.has(id))) {
    return { valid: false, reason: "原分支引用的论文证据已变化。" };
  }
  const externalSourceIds = new Set((parent.evidence.externalSources ?? []).map((source) => source.id));
  if ((snapshot.source.externalSourceIds ?? []).some((id) => !externalSourceIds.has(id))) {
    return { valid: false, reason: "原分支引用的外部来源已变化。" };
  }
  return excerptIsAuditable(snapshot.source, parent)
    ? { valid: true }
    : { valid: false, reason: "原选区已无法在父节点正文中复核。" };
}

function isPersistedTask(value: unknown): value is PersistedTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const task = value as Partial<PersistedTask>;
  return typeof task.id === "string" && task.id.trim().length > 0 &&
    typeof task.message === "string" &&
    typeof task.progress === "number" && Number.isFinite(task.progress) &&
    typeof task.stage === "string" &&
    typeof task.type === "string" &&
    (task.status === "queued" || task.status === "running") &&
    (task.agentRunId === undefined || typeof task.agentRunId === "string") &&
    (task.artifactId === undefined || typeof task.artifactId === "string") &&
    (task.thinReadingBranchRecovery === undefined ||
      (task.type === "thin_reading" && isThinReadingBranchRecoverySnapshot(task.thinReadingBranchRecovery)));
}

function getStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function persistInterruptedArtifactTasks(tasks: readonly ArtifactTask[]) {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  const pending = tasks
    .filter((task) => task.status === "queued" || task.status === "running")
    .slice(0, maxPersistedTaskCount)
    .map(({ agentRunId, artifactId, id, message, progress, stage, status, thinReadingBranchRecovery, type }) => ({
      ...(agentRunId ? { agentRunId } : {}),
      ...(artifactId ? { artifactId } : {}),
      id,
      message: message.slice(0, maxPersistedTaskMessageLength),
      progress,
      stage,
      status,
      ...(thinReadingBranchRecovery ? { thinReadingBranchRecovery } : {}),
      type
    }));
  if (pending.length === 0) {
    storage.removeItem(storageKey);
    return;
  }
  try {
    storage.setItem(storageKey, JSON.stringify(pending));
  } catch {
    // Task recovery is optional. Browsers can reject writes once their local quota is
    // full; leaving the exception uncaught would prevent the actual Agent task from starting.
    try {
      storage.removeItem(storageKey);
    } catch {
      // Storage may be unavailable altogether; generation still remains usable.
    }
  }
}

export function takeInterruptedArtifactTasks(): PersistedTask[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  const raw = storage.getItem(storageKey);
  storage.removeItem(storageKey);
  if (!raw) {
    return [];
  }
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isPersistedTask) : [];
  } catch {
    return [];
  }
}
