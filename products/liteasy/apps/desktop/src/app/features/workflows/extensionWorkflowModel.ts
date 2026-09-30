import type { WorkflowTriggers } from "./workflowTriggers";
import type { WorkflowDefinition } from "./workflowDefinition";
import type { JsonObject } from "../extensions/extensionSchema";
import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import type { WorkflowRunner, WorkflowRun } from "./workflowRunner";
export type PendingWorkflow = { owner: string; digest: string; definition: WorkflowDefinition; selection: string[]; input: JsonObject; capabilities: string[] };
export type ExtensionWorkflowModel = { runner: WorkflowRunner; triggers: WorkflowTriggers; pending?: PendingWorkflow; error: string; connection: string; assets: AgentAssetService; request(owner: string, workflow: string, selection?: string[]): Promise<void>; start(input: JsonObject, selection: string[]): Promise<WorkflowRun | undefined>; close(): void };
