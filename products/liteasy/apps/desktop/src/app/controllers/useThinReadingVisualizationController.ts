import { useEffect, useRef, useState } from "react";
import {
  parseMultimodalVisualizationCapability,
  type MultimodalVisualizationCapability
} from "../features/account/accountCapabilitiesClient";
import type {
  ThinReadingVisualizationGenerationRequest,
  ThinReadingVisualizationOmissionReason,
  ThinReadingVisualizationStatus
} from "../features/artifacts/artifact.types";
import type {
  ThinReadingDocumentV2,
  ThinReadingNodeV2,
  VisualizationIntentV1
} from "../features/thin-reading/thinReading.types";
import { parseVisualizationArtifact } from "../features/visualization/visualizationArtifact.schema";
import type { VisualizationArtifactV1 } from "../features/visualization/visualizationArtifact.types";
import { VisualizationOrchestrationClientError } from "../features/visualization/visualizationOrchestrationClient";
import type { PendingVisualizationRequest } from "../features/visualization/visualizationPendingRequestStore";

export type ThinReadingVisualizationNodeInput = {
  artifactId: string;
  document: ThinReadingDocumentV2;
  node: ThinReadingNodeV2;
};

export type ThinReadingVisualizationCancellationReason =
  | "preference_disabled"
  | "user_cancelled"
  | "workflow_disposed";

type ActiveRequest = {
  abortController: AbortController;
  artifactId: string;
  intent: VisualizationIntentV1;
  nodeId: string;
  requestId: string;
};

export type UseThinReadingVisualizationControllerInput = {
  cancelGeneration?: (input: {
    artifactId: string;
    nodeId: string;
    reason: ThinReadingVisualizationCancellationReason;
    requestId: string;
  }) => Promise<void>;
  generateVisualization?: (
    request: ThinReadingVisualizationGenerationRequest
  ) => Promise<readonly unknown[]>;
  getCapability: () => unknown;
  getThinReadingDocument: (artifactId: string) => ThinReadingDocumentV2 | undefined;
  initialReadyArtifacts?: readonly VisualizationArtifactV1[];
  onDocumentUpdated: (document: ThinReadingDocumentV2) => void;
  resumeVisualization?: (
    request: PendingVisualizationRequest,
    signal: AbortSignal
  ) => Promise<readonly unknown[]>;
  saveThinReadingDocument: (
    artifactId: string,
    document: ThinReadingDocumentV2,
    signal: AbortSignal
  ) => Promise<void>;
  setVisualizationPreference?: (
    enabled: boolean
  ) => Promise<MultimodalVisualizationCapability>;
};

function requestKey(artifactId: string, nodeId: string) {
  return `${artifactId}:${nodeId}`;
}

function createRequestId() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `visualization-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function intentsMatch(left: VisualizationIntentV1, right: VisualizationIntentV1) {
  return left.nodeId === right.nodeId &&
    left.purpose === right.purpose &&
    left.requestedBy === right.requestedBy &&
    left.expectedLearningGain === right.expectedLearningGain &&
    left.candidateModalities.length === right.candidateModalities.length &&
    left.candidateModalities.every((value, index) => value === right.candidateModalities[index]) &&
    left.evidenceIds.length === right.evidenceIds.length &&
    left.evidenceIds.every((value, index) => value === right.evidenceIds[index]);
}

function omissionReason(
  capability: MultimodalVisualizationCapability,
  intent: VisualizationIntentV1,
  locallyEnabled: boolean
): ThinReadingVisualizationOmissionReason | undefined {
  if (!capability.allowed) {
    return "capability_unavailable";
  }
  if (!locallyEnabled || !capability.enabled) {
    return "preference_disabled";
  }
  if (!capability.serviceAvailable) {
    return "service_unavailable";
  }
  if (!capability.quota.available) {
    return "quota_unavailable";
  }
  if (intent.requestedBy === "explicit_user_request" && !capability.explicitRequestsAllowed) {
    return "explicit_request_unavailable";
  }
  if (!intent.candidateModalities.some((modality) => capability.availableModalities.includes(modality))) {
    return "modality_unavailable";
  }
  return undefined;
}

export function useThinReadingVisualizationController({
  cancelGeneration,
  generateVisualization,
  getCapability,
  getThinReadingDocument,
  initialReadyArtifacts = [],
  onDocumentUpdated,
  resumeVisualization,
  saveThinReadingDocument,
  setVisualizationPreference
}: UseThinReadingVisualizationControllerInput) {
  const [readyArtifacts, setReadyArtifacts] = useState<readonly VisualizationArtifactV1[]>(
    initialReadyArtifacts
  );
  const [statuses, setStatuses] = useState<Record<string, ThinReadingVisualizationStatus>>({});
  const activeRequestsRef = useRef(new Map<string, ActiveRequest>());
  const locallyEnabledRef = useRef(true);
  const mountedRef = useRef(true);
  const saveQueuesRef = useRef(new Map<string, Promise<void>>());
  const cancelGenerationRef = useRef(cancelGeneration);
  cancelGenerationRef.current = cancelGeneration;

  function currentCapability() {
    return parseMultimodalVisualizationCapability(getCapability());
  }

  function setNodeStatus(nodeId: string, status: ThinReadingVisualizationStatus) {
    if (!mountedRef.current) {
      return;
    }
    setStatuses((current) => ({ ...current, [nodeId]: status }));
  }

  function cancelRemoteGeneration(input: {
    artifactId: string;
    nodeId: string;
    reason: ThinReadingVisualizationCancellationReason;
    requestId: string;
  }) {
    const cancel = cancelGenerationRef.current;
    if (!cancel) {
      return;
    }
    const timeout = new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 1_000);
    });
    void Promise.race([
      Promise.resolve().then(() => cancel(input)),
      timeout
    ]).catch(() => undefined);
  }

  function disposeActiveRequests(
    reason: ThinReadingVisualizationCancellationReason = "workflow_disposed",
    options: { resetStatuses?: boolean } = {}
  ) {
    const requests = [...activeRequestsRef.current.values()];
    activeRequestsRef.current.clear();
    requests.forEach((request) => {
      request.abortController.abort();
      setNodeStatus(request.nodeId, {
        reasonCode: reason === "preference_disabled" ? "preference_disabled" : "stale_request",
        status: "omitted"
      });
      cancelRemoteGeneration({
        artifactId: request.artifactId,
        nodeId: request.nodeId,
        reason,
        requestId: request.requestId
      });
    });
    if (options.resetStatuses && mountedRef.current) {
      setStatuses({});
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      disposeActiveRequests();
    };
  }, []);

  async function runVisualization(
    input: ThinReadingVisualizationNodeInput,
    recovery?: PendingVisualizationRequest
  ) {
    const intent = input.node.visualizationDecision?.status === "accepted"
      ? input.node.visualizationDecision.intent
      : undefined;
    if (!intent || intent.nodeId !== input.node.id || input.document.version !== "liteasy.thin-reading/v2") {
      if (recovery) {
        cancelRemoteGeneration({
          artifactId: recovery.artifactId,
          nodeId: recovery.nodeId,
          reason: "workflow_disposed",
          requestId: recovery.requestId
        });
      }
      const status = { reasonCode: "intent_unavailable", status: "omitted" } as const;
      setNodeStatus(input.node.id, status);
      return status;
    }

    const capability = currentCapability();
    const reasonCode = omissionReason(capability, intent, locallyEnabledRef.current);
    if (reasonCode || (recovery ? !resumeVisualization : !generateVisualization)) {
      if (recovery) {
        cancelRemoteGeneration({
          artifactId: recovery.artifactId,
          nodeId: recovery.nodeId,
          reason: reasonCode === "preference_disabled" ? "preference_disabled" : "workflow_disposed",
          requestId: recovery.requestId
        });
      }
      const status = {
        reasonCode: reasonCode ?? "service_unavailable",
        status: "omitted"
      } as const;
      setNodeStatus(input.node.id, status);
      return status;
    }

    const key = requestKey(input.artifactId, input.node.id);
    const previous = activeRequestsRef.current.get(key);
    if (previous) {
      previous.abortController.abort();
      activeRequestsRef.current.delete(key);
    }
    const abortController = new AbortController();
    const requestId = recovery?.requestId ?? createRequestId();
    const activeRequest: ActiveRequest = {
      abortController,
      artifactId: input.artifactId,
      intent,
      nodeId: input.node.id,
      requestId
    };
    activeRequestsRef.current.set(key, activeRequest);
    setNodeStatus(input.node.id, { requestId, status: "generating" });

    try {
      const requestedArtifactCount = intent.requestedBy === "automatic" ? 1 : 2;
      if (recovery && (
        recovery.artifactId !== input.artifactId || recovery.nodeId !== input.node.id ||
        recovery.requestedArtifactCount !== requestedArtifactCount
      )) {
        cancelRemoteGeneration({
          artifactId: recovery.artifactId,
          nodeId: recovery.nodeId,
          reason: "workflow_disposed",
          requestId: recovery.requestId
        });
        throw new Error("thin_reading_visualization_recovery_stale");
      }
      const rawArtifacts = recovery
        ? await resumeVisualization!(recovery, abortController.signal)
        : await generateVisualization!({
          artifactId: input.artifactId,
          candidateModalities: intent.candidateModalities.filter((modality) => (
            capability.availableModalities.includes(modality)
          )),
          evidenceIds: intent.evidenceIds,
          nodeId: input.node.id,
          purpose: intent.purpose,
          requestId,
          requestedArtifactCount,
          signal: abortController.signal
        });
      const latestRequest = activeRequestsRef.current.get(key);
      const latestCapability = currentCapability();
      const latestDocument = getThinReadingDocument(input.artifactId);
      const latestNode = latestDocument?.nodes[input.node.id];
      const latestIntent = latestNode?.visualizationDecision?.status === "accepted"
        ? latestNode.visualizationDecision.intent
        : undefined;
      if (
        abortController.signal.aborted ||
        latestRequest?.requestId !== requestId ||
        !latestIntent ||
        !intentsMatch(intent, latestIntent) ||
        omissionReason(latestCapability, intent, locallyEnabledRef.current)
      ) {
        const status = { reasonCode: "stale_request", status: "omitted" } as const;
        if (latestRequest?.requestId === requestId) {
          activeRequestsRef.current.delete(key);
          setNodeStatus(input.node.id, status);
        }
        return status;
      }

      const limit = intent.requestedBy === "automatic" ? 1 : 2;
      let artifacts: VisualizationArtifactV1[];
      try {
        artifacts = rawArtifacts
          .map(parseVisualizationArtifact)
          .filter((artifact) => (
            artifact.nodeId === input.node.id &&
            artifact.modality !== "source_figure" &&
            intent.candidateModalities.includes(artifact.modality)
          ))
          .slice(0, limit);
      } catch {
        artifacts = [];
      }
      if (artifacts.length === 0 || !latestDocument || !latestNode) {
        activeRequestsRef.current.delete(key);
        const status = { reasonCode: "result_invalid", status: "omitted" } as const;
        setNodeStatus(input.node.id, status);
        return status;
      }

      const previousSave = saveQueuesRef.current.get(input.artifactId) ?? Promise.resolve();
      const persistResult = previousSave.then(async () => {
        const currentRequest = activeRequestsRef.current.get(key);
        const freshCapability = currentCapability();
        const currentDocument = getThinReadingDocument(input.artifactId);
        const currentNode = currentDocument?.nodes[input.node.id];
        const currentIntent = currentNode?.visualizationDecision?.status === "accepted"
          ? currentNode.visualizationDecision.intent
          : undefined;
        if (
          abortController.signal.aborted ||
          currentRequest?.requestId !== requestId ||
          !currentDocument ||
          !currentNode ||
          !currentIntent ||
          !intentsMatch(intent, currentIntent) ||
          omissionReason(freshCapability, intent, locallyEnabledRef.current)
        ) {
          return false;
        }
        const existingArtifactIds = new Set(currentNode.visualizations.map((artifact) => artifact.artifactId));
        const mergedArtifacts = artifacts.filter((artifact) => !existingArtifactIds.has(artifact.artifactId));
        if (mergedArtifacts.length === 0) {
          return false;
        }
        const nextDocument: ThinReadingDocumentV2 = {
          ...currentDocument,
          nodes: {
            ...currentDocument.nodes,
            [currentNode.id]: {
              ...currentNode,
              visualizations: [...currentNode.visualizations, ...mergedArtifacts]
            }
          }
        };
        await saveThinReadingDocument(input.artifactId, nextDocument, abortController.signal);
        const postSaveDocument = getThinReadingDocument(input.artifactId);
        const postSaveNode = postSaveDocument?.nodes[input.node.id];
        const postSaveIntent = postSaveNode?.visualizationDecision?.status === "accepted"
          ? postSaveNode.visualizationDecision.intent
          : undefined;
        if (
          abortController.signal.aborted ||
          activeRequestsRef.current.get(key)?.requestId !== requestId ||
          !postSaveIntent ||
          !intentsMatch(intent, postSaveIntent) ||
          omissionReason(currentCapability(), intent, locallyEnabledRef.current)
        ) {
          return false;
        }
        onDocumentUpdated(nextDocument);
        return true;
      });
      saveQueuesRef.current.set(
        input.artifactId,
        persistResult.then(() => undefined, () => undefined)
      );
      const didPersist = await persistResult;
      if (!didPersist) {
        if (activeRequestsRef.current.get(key)?.requestId === requestId) {
          activeRequestsRef.current.delete(key);
          setNodeStatus(input.node.id, { reasonCode: "stale_request", status: "omitted" });
        }
        return { reasonCode: "stale_request", status: "omitted" } as const;
      }
      activeRequestsRef.current.delete(key);
      setReadyArtifacts((current) => [...current, ...artifacts]);
      const status = { artifacts, status: "ready" } as const;
      setNodeStatus(input.node.id, status);
      return status;
    } catch (error) {
      if (activeRequestsRef.current.get(key)?.requestId !== requestId) {
        return { reasonCode: "stale_request", status: "omitted" } as const;
      }
      activeRequestsRef.current.delete(key);
      const status = {
        reasonCode: abortController.signal.aborted ||
          (error instanceof Error && error.message === "thin_reading_visualization_recovery_stale")
          ? "stale_request"
          : error instanceof VisualizationOrchestrationClientError
            ? error.reasonCode
            : "generation_failed",
        status: "omitted"
      } as const;
      setNodeStatus(input.node.id, status);
      return status;
    }
  }

  function startVisualization(input: ThinReadingVisualizationNodeInput) {
    return runVisualization(input);
  }

  async function resumePendingVisualization(request: PendingVisualizationRequest) {
    const document = getThinReadingDocument(request.artifactId);
    const node = document?.nodes[request.nodeId];
    if (!document || !node) {
      cancelRemoteGeneration({
        artifactId: request.artifactId,
        nodeId: request.nodeId,
        reason: "workflow_disposed",
        requestId: request.requestId
      });
      return { reasonCode: "stale_request", status: "omitted" } as const;
    }
    return runVisualization({ artifactId: request.artifactId, document, node }, request);
  }

  async function commitGeneratedNode(input: ThinReadingVisualizationNodeInput) {
    await saveThinReadingDocument(input.artifactId, input.document, new AbortController().signal);
    void startVisualization(input);
  }

  async function cancelVisualization(
    nodeId: string,
    reason: ThinReadingVisualizationCancellationReason
  ) {
    const matches = [...activeRequestsRef.current.entries()].filter(([, request]) => (
      request.nodeId === nodeId
    ));
    await Promise.all(matches.map(async ([key, request]) => {
      activeRequestsRef.current.delete(key);
      request.abortController.abort();
      setNodeStatus(request.nodeId, {
        reasonCode: reason === "preference_disabled" ? "preference_disabled" : "stale_request",
        status: "omitted"
      });
      cancelRemoteGeneration({
        artifactId: request.artifactId,
        nodeId: request.nodeId,
        reason,
        requestId: request.requestId
      });
    }));
  }

  async function setEnabled(enabled: boolean) {
    locallyEnabledRef.current = enabled;
    if (!enabled) {
      const activeNodeIds = [...new Set(
        [...activeRequestsRef.current.values()].map((request) => request.nodeId)
      )];
      await Promise.all(activeNodeIds.map((nodeId) => (
        cancelVisualization(nodeId, "preference_disabled")
      )));
    }
    if (setVisualizationPreference) {
      await setVisualizationPreference(enabled);
    }
  }

  function hydrateReadyArtifacts(
    artifacts: readonly VisualizationArtifactV1[],
    options: { replace?: boolean } = {}
  ) {
    if (!mountedRef.current) {
      return;
    }
    setReadyArtifacts((current) => {
      const byId = new Map(
        (options.replace ? [] : current).map((artifact) => [artifact.artifactId, artifact])
      );
      artifacts.forEach((artifact) => byId.set(artifact.artifactId, artifact));
      return [...byId.values()];
    });
  }

  return {
    cancelVisualization,
    commitGeneratedNode,
    dispose: disposeActiveRequests,
    hydrateReadyArtifacts,
    readyArtifacts,
    resumePendingVisualization,
    setEnabled,
    startVisualization,
    statuses
  };
}
