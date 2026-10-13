import { boardTemplateSchema } from "../extensions/extensionPackage";
import { workflowSchema } from "../workflows/workflowDefinition";
import { parseBlockDefinition } from "../visual-blocks/blockRegistry";
import { parseDataSchema } from "../extensions/extensionSchema";

export type StudioFiles = Record<string, string>;
export type StudioEditState = { files: StudioFiles; past: StudioFiles[]; future: StudioFiles[] };
export function editStudioFiles(state: StudioEditState, files: StudioFiles): StudioEditState {
  if (JSON.stringify(files) === JSON.stringify(state.files)) return state;
  return { files, past: [...state.past.slice(-79), state.files], future: [] };
}
export function travelStudioHistory(state: StudioEditState, direction: "undo" | "redo"): StudioEditState {
  if (direction === "undo") return state.past.length ? { files: state.past.at(-1)!, past: state.past.slice(0, -1), future: [state.files, ...state.future] } : state;
  return state.future.length ? { files: state.future[0], past: [...state.past, state.files], future: state.future.slice(1) } : state;
}
export function studioTabForPath(path: string) {
  return path.startsWith("templates/") ? "composition" : path.startsWith("workflows/") ? "workflow" : path.startsWith("blocks/") ? "type" : path.startsWith("settings/") ? "settings" : "source";
}
export function studioBlocks(files: StudioFiles) {
  return Object.entries(files).filter(([path]) => path.startsWith("blocks/")).map(([, text]) => {
    const raw = JSON.parse(text);
    return parseBlockDefinition(raw, String(raw.id).split("/")[0]);
  });
}
/** Structural editor validation allows an unfinished empty canvas; publish retains the full package gate. */
export function parseStudioFile(path: string, text: string) {
  const value: unknown = JSON.parse(text);
  if (path.startsWith("templates/")) return boardTemplateSchema.extend({ cards: boardTemplateSchema.shape.cards.min(0) }).parse(value);
  if (path.startsWith("workflows/")) return workflowSchema.extend({ nodes: workflowSchema.shape.nodes.min(0) }).parse(value);
  if (path.startsWith("blocks/")) { const definition = parseBlockDefinition(value, String((value as { id?: string }).id).split("/")[0]); return definition; }
  if (path.startsWith("settings/")) return parseDataSchema(value);
  return value;
}
export function studioSourceError(path: string, text: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const offset = /position (\d+)/.exec(message)?.[1];
  const before = offset ? text.slice(0, Number(offset)) : "";
  const location = offset ? `第 ${before.split("\n").length} 行，第 ${(before.split("\n").at(-1)?.length ?? 0) + 1} 列` : "请检查下列字段路径或 JSON 结束位置";
  return `${path} · ${location}：${message}`;
}
