import type { HelpContentProvider } from "./help.types";
import { manualArticles, manualTopics } from "./manual/manualCatalog";
import { createManualProvider } from "./manual/manualProvider";
import { commandShortcut, workbenchCommands } from "../workbench/workbenchCommands";

// Preserve the public export and the "liteasy" provider namespace used by the
// shell, contextual help and the assistant's resource catalog.
export const builtinHelpProviders: readonly HelpContentProvider[] = [
  createManualProvider(manualArticles, manualTopics, () =>
    `| 操作 | 当前平台快捷键 |\n| --- | --- |\n${workbenchCommands.map((command) =>
      `| ${command.title} | ${commandShortcut(command.id)} |`).join("\n")}`),
];
