import { useRef, useState } from "react";
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
  saveThinReadingDocument: (
    artifactId: string,
    document: ThinReadingDocumentV2
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
  saveThinReadingDocument,
  setVisualizationPreference
}: UseThinReadingVisualizationControllerInput) {
  const [readyArtifacts, setReadyArtifacts] = useState<readonly VisualizationArtifactV1[]>(
    initialReadyArtifacts
  );
  const [statuses, setStatuses] = useState<Record<string, ThinReadingVisualizationStatus>>({});
  const activeRequestsRef = useRef(new Map<string, ActiveRequest>());
  const locallyEnabledRef = useRef(true);
  const capabilityOverrideRef = useRef<MultimodalVisualizationCapability>();

  function currentCapability() {
    return capabilityOverrideRef.current ?? parseMultimodalVisualizationCapability(getCapability());
  }

  function setNodeStatus(nodeId: string, status: ThinReadingVisualizationStatus) {
    setStatuses((current) => ({ ...current, [nodeId]: status }));
  }

  async function startVisualization(input: ThinReadingVisualizationNodeInput) {
    const intent = input.node.visualizationDecision?.status === "accepted"
      ? input.node.visualizationDecision.intent
      : undefined;
    if (!intent || intent.nodeId !== input.node.id || input.document.version !== "liteasy.thin-reading/v2") {
      const status = { reasonCode: "intent_unavailable", status: "omitted" } as const;
      setNodeStatus(input.node.id, status);
      return status;
    }

    const capability = currentCapability();
    const reasonCode = omissionReason(capability, intent, locallyEnabledRef.current);
    if (reasonCode || !generateVisualization) {
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
    const requestId = createRequestId();
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
      const rawArtifacts = await generateVisualization({
        artifactId: input.artifactId,
        candidateModalities: intent.candidateModalities.filter((modality) => (
          capability.availableModalities.includes(modality)
        )),
        evidenceIds: intent.evidenceIds,
        nodeId: input.node.id,
        purpose: intent.purpose,
        requestId,
        requestedArtifactCount: intent.requestedBy === "automatic" ? 1 : 2,
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

      // Once persistence starts, the request is committed and preference changes preserve it.
      activeRequestsRef.current.delete(key);
      const nextDocument: ThinReadingDocumentV2 = {
        ...latestDocument,
        nodes: {
          ...latestDocument.nodes,
          [latestNode.id]: {
            ...latestNode,
            visualizations: [...latestNode.visualizations, ...artifacts]
          }
        }
      };
      await saveThinReadingDocument(input.artifactId, nextDocument);
      onDocumentUpdated(nextDocument);
      setReadyArtifacts((current) => [...current, ...artifacts]);
      const status = { artifacts, status: "ready" } as const;
      setNodeStatus(input.node.id, status);
      return status;
    } catch {
      if (activeRequestsRef.current.get(key)?.requestId !== requestId) {
        return { reasonCode: "stale_request", status: "omitted" } as const;
      }
      activeRequestsRef.current.delete(key);
      const status = {
        reasonCode: abortController.signal.aborted ? "stale_request" : "generation_failed",
        status: "omitted"
      } as const;
      setNodeStatus(input.node.id, status);
      return status;
    }
  }

  async function commitGeneratedNode(input: ThinReadingVisualizationNodeInput) {
    await saveThinReadingDocument(input.artifactId, input.document);
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
      try {
        await cancelGeneration?.({
          artifactId: request.artifactId,
          nodeId: request.nodeId,
          reason,
          requestId: request.requestId
        });
      } catch {
        // Local abort is authoritative; remote cancellation is best effort.
      }
      setNodeStatus(request.nodeId, {
        reasonCode: reason === "preference_disabled" ? "preference_disabled" : "stale_request",
        status: "omitted"
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
      capabilityOverrideRef.current = parseMultimodalVisualizationCapability(
        await setVisualizationPreference(enabled)
      );
    }
  }

  return {
    cancelVisualization,
    commitGeneratedNode,
    readyArtifacts,
    setEnabled,
    startVisualization,
    statuses
  };
}
