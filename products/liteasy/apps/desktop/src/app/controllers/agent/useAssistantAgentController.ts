import { useRef } from "react";
import type { ArtifactTask, ArtifactType } from "../../features/artifacts/artifact.types";
import { createFrontendAgentClient } from "../../features/agent-api/frontendAgentClient";
import type { AgentPublicApi } from "../../features/agent-api/agentApi.types";
import { defaultAgentCoreConfig, type AgentMemoryEntry } from "../../features/agent-core/agentCoreConfig";
import { createAgentCoreSession } from "../../features/agent-core/agentCoreSession";
import type { PendingCommandClarification } from "../../features/agent-runtime/agentRuntime.types";
import { buildAgentRuntimeContextView } from "../../features/agent-runtime/contextView";
import { createModelAssistedClarification } from "../../features/agent-runtime/modelClarification";
import { createModelSemanticPlanner } from "../../features/agent-runtime/modelSemanticPlanner";
import { createExecutionJournal } from "../../features/generative-ui/executionJournal";
import { createModelAssistedUIDslGenerator } from "../../features/generative-ui/uiDslGenerator";
import type { ModelTransport } from "../../features/models/modelHttpClient";
import type { ThinReadingExternalKnowledgeTransport } from "../../features/thin-reading/thinReadingExternalKnowledgeClient";
import type { ThinReadingExternalPdfTransport } from "../../features/thin-reading/thinReadingExternalFullTextClient";
import type { AcademicProfile } from "../../features/profile/profile.types";
import type { RetrievalChunk } from "../../features/retrieval/retrieval.types";
import type { SettingsState } from "../../features/settings/settings.types";
import type { createSettingsStore } from "../../features/settings/settings.store";
import type { ActionContext } from "../../features/skills/actionRegistry";
import type { ExtensionRuntime } from "../../features/extensions/extensionApi";
import {
  createBrowserPluginBuilderStore,
  createPluginBuilderRuntime,
  type PluginBuilderRuntime,
  type PluginSandboxTransport
} from "../../features/extensions/pluginBuilder";
import {
  createBrowserUserWorkflowStore,
  createWorkflowDesignerRuntime,
  type WorkflowDesignerRuntime
} from "../../features/skills/workflowDesigner";
import type { Paper, WorkspaceSource } from "../../features/workspace/workspace.types";
import {
  getAgentRequestThinReadingContext,
  resolveAgentKnowledgeScope
} from "./agentRequestScope";
import { createOpenAIAgentsSdkManager } from "./createOpenAIAgentsSdkManager";
import { createDesktopAgentService } from "./createDesktopAgentService";
import { createTauriAgentStateStore } from "./tauriAgentStateStore";
import { useTauriAgentHostBridge } from "./useTauriAgentHostBridge";

type SettingsStoreLike = ReturnType<typeof createSettingsStore>;

export type AssistantAgentControllerInput = {
  academicProfile?: AcademicProfile;
  getAgentMemories?: () => AgentMemoryEntry[];
  getAllPapers?: () => Paper[];
  getArtifactTasks?: () => readonly ArtifactTask[];
  getImportedChunksByPaperId?: () => Record<string, RetrievalChunk[]>;
  getImportedChunksForPaperId?: (paperId: string) => RetrievalChunk[];
  getSelectedPapers?: () => Paper[];
  getUserStateSummary?: () => string;
  importedChunksByPaperId: Record<string, RetrievalChunk[]>;
  importedSelectedCount: number;
  extensionRuntime: ExtensionRuntime;
  modelTransport?: ModelTransport;
  pluginSandboxTransport?: PluginSandboxTransport;
  thinReadingExternalKnowledgeTransport?: ThinReadingExternalKnowledgeTransport;
  thinReadingExternalPdfTransport?: ThinReadingExternalPdfTransport;
  onApplyGeneratedTheme?: ActionContext["applyGeneratedTheme"];
  onApplyLayoutPreset?: ActionContext["applyLayoutPreset"];
  onApplyPanelAction?: ActionContext["applyPanelAction"];
  onApplyThemePreset?: ActionContext["applyThemePreset"];
  onGenerateArtifact: (artifactType: ArtifactType) => string;
  onImportSelectedSet?: ActionContext["importSelectedSet"];
  onMoveDockItem?: ActionContext["moveDockItem"];
  onOpenAcademicArchive?: ActionContext["openAcademicArchive"];
  onOpenOrganizationSharedLibrary?: () => string | Promise<string>;
  onSettingsChanged?: (settings: SettingsState) => void;
  profilePersonalizationSummary?: string;
  profileUnlocked: boolean;
  runtimeOrganizationName?: string;
  runtimeWorkspace?: Partial<WorkspaceSource>;
  selectedPaperCount: number;
  selectedPapers: Paper[];
  selectionLocked: boolean;
  settingsStore: SettingsStoreLike;
};

export function useAssistantAgentController(input: AssistantAgentControllerInput) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const journalRef = useRef(createExecutionJournal());
  const pendingClarificationRef = useRef<PendingCommandClarification>();
  const apiRef = useRef<AgentPublicApi | null>(null);
  const stateStoreRef = useRef(createTauriAgentStateStore());
  const pluginBuilderRef = useRef<PluginBuilderRuntime | null>(null);
  const workflowDesignerRef = useRef<WorkflowDesignerRuntime | null>(null);

  if (!pluginBuilderRef.current && input.pluginSandboxTransport) {
    pluginBuilderRef.current = createPluginBuilderRuntime({
      extensionRuntime: input.extensionRuntime,
      store: createBrowserPluginBuilderStore(),
      transport: input.pluginSandboxTransport
    });
    void pluginBuilderRef.current.restore().then(({ issues }) => {
      if (issues.length > 0) {
        console.warn("Liteasy plugin restoration completed with issues", issues);
      }
    }).catch((error) => {
      console.warn("Liteasy plugin restoration failed", error);
    });
  }

  if (!workflowDesignerRef.current) {
    workflowDesignerRef.current = createWorkflowDesignerRuntime({
      store: createBrowserUserWorkflowStore()
    });
    void workflowDesignerRef.current.restore().catch((error) => {
      console.warn("Liteasy user workflow restoration failed", error);
    });
  }

  if (!apiRef.current) {
    apiRef.current = createDesktopAgentService({
      createCoreSession() {
        return createAgentCoreSession(undefined, {
          getMemories: () =>
            inputRef.current.getAgentMemories?.() ?? defaultAgentCoreConfig.memories,
          getUserStateSummary: () => inputRef.current.getUserStateSummary?.() ?? ""
        });
      },
      getEnvironment({ request } = {}) {
        const current = inputRef.current;
        const knowledgeScope = resolveAgentKnowledgeScope({
          allPapers: current.getAllPapers?.() ?? current.selectedPapers,
          fallbackImportedChunksByPaperId:
            current.getImportedChunksByPaperId?.() ?? current.importedChunksByPaperId,
          fallbackSelectedPapers: current.getSelectedPapers?.() ?? current.selectedPapers,
          getImportedChunksForPaperId: current.getImportedChunksForPaperId,
          request
        });
        const savedScope = request?.attachments?.find((attachment) => attachment.source === "selection")?.metadata?.knowledgeSnapshot as unknown as {
          papers?: import("../../features/workspace/workspace.types").Paper[];
          chunks?: typeof knowledgeScope.importedChunksByPaperId;
          settings?: import("../../features/settings/settings.types").SettingsState;
        } | undefined;
        const runtimeContext = buildAgentRuntimeContextView({
          academicProfile: current.academicProfile,
          importedCount: current.importedSelectedCount,
          organizationName: current.runtimeOrganizationName,
          profileEnabled: Boolean(current.settingsStore.getState()["profile.enabled"]),
          profilePersonalizationSummary: current.profilePersonalizationSummary,
          profileUnlocked: current.profileUnlocked,
          selectedCount: current.selectedPaperCount,
          selectionLocked: current.selectionLocked,
          workspace: current.runtimeWorkspace
        });

        return {
          activity: {
            artifactTasks: current.getArtifactTasks?.() ?? []
          },
          knowledge: {
            auditTransport: current.modelTransport,
            importedChunksByPaperId: savedScope?.chunks ?? knowledgeScope.importedChunksByPaperId,
            modelTransport: current.modelTransport,
            selectedPapers: savedScope?.papers ?? knowledgeScope.selectedPapers,
            settings: savedScope?.settings ?? current.settingsStore.getState(),
            thinReadingContext: getAgentRequestThinReadingContext(request),
            thinReadingExternalKnowledgeTransport: current.thinReadingExternalKnowledgeTransport,
            thinReadingExternalPdfTransport: current.thinReadingExternalPdfTransport
          },
          pluginBuilder: pluginBuilderRef.current ?? undefined,
          runtime: {
            applyGeneratedTheme: current.onApplyGeneratedTheme,
            applyLayoutPreset: current.onApplyLayoutPreset,
            applyPanelAction: current.onApplyPanelAction,
            applyThemePreset: current.onApplyThemePreset,
            clarifySemanticPlan: createModelAssistedClarification({
              modelTransport: current.modelTransport,
              settings: current.settingsStore.getState()
            }),
            contextView: runtimeContext,
            generateUIDsl: createModelAssistedUIDslGenerator({
              modelTransport: current.modelTransport,
              settings: current.settingsStore.getState()
            }),
            importSelectedSet: current.onImportSelectedSet,
            journal: journalRef.current,
            moveDockItem: current.onMoveDockItem,
            openAcademicArchive: current.onOpenAcademicArchive,
            openOrganizationSharedLibrary: current.onOpenOrganizationSharedLibrary,
            pendingClarification: pendingClarificationRef.current,
            profileUnlocked: current.profileUnlocked,
            semanticPlanner: createModelSemanticPlanner({
              modelTransport: current.modelTransport,
              settings: current.settingsStore.getState()
            }),
            settingsStore: current.settingsStore,
            startArtifactAnalysis: current.onGenerateArtifact
          },
          workflowDesigner: workflowDesignerRef.current ?? undefined
        };
      },
      managerAgent: createOpenAIAgentsSdkManager(),
      onCommandResult({ message, result }) {
        const clarification = result.events.find(
          (event) =>
            event.type === "clarification_request" && event.kind === "ambiguous_action"
        );
        if (clarification?.type === "clarification_request") {
          pendingClarificationRef.current = {
            clarification: {
              candidates: clarification.candidates,
              kind: clarification.kind,
              missing: clarification.missing,
              question: clarification.question
            },
            previousInput: message
          };
        } else {
          pendingClarificationRef.current = undefined;
        }

        if (result.settingsChanged) {
          const current = inputRef.current;
          current.onSettingsChanged?.({ ...current.settingsStore.getState() });
        }
      },
      onConfirmationResult(result) {
        if (result.settingsChanged) {
          const current = inputRef.current;
          current.onSettingsChanged?.({ ...current.settingsStore.getState() });
        }
      },
      onPersistenceError(error) {
        console.warn("Liteasy Agent state persistence failed", error);
      },
      stateStore: stateStoreRef.current
    });
  }

  const clientRef = useRef<ReturnType<typeof createFrontendAgentClient> | null>(null);
  if (!clientRef.current) {
    clientRef.current = createFrontendAgentClient(apiRef.current, {
      clientSessionId: "assistant-pane"
    });
  }

  useTauriAgentHostBridge(apiRef.current);

  return {
    agentClient: clientRef.current,
    executionJournal: journalRef.current
  };
}
