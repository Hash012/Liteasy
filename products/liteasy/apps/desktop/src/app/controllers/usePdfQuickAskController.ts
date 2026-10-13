import { createQuickAskService, type QuickAskServiceDependencies } from "../features/pdf/quickAskService";

/** Deliberately has no Agent, workbench, tool or context-tray dependency. */
export function usePdfQuickAskController(input: QuickAskServiceDependencies) {
  return createQuickAskService(input).run;
}
