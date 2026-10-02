import { useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { createNoteFileService, type NoteFileService, type NoteFileSnapshot } from "../features/note-files/noteFileService";
import type { DockItemId, DockRegionId } from "../features/dock/dock.types";
import type { WorkbenchCommandAvailability } from "../features/workbench/workbenchCommands";

type Visibility = { collapsed: { left: boolean; right: boolean; bottom: boolean }; hiddenRegions: DockRegionId[] };
export type WorkbenchTaskPreset = "reading" | "research" | "processing" | "custom";
/** Uses existing file grants/readers and visibility controls. Never launches a model or task. */
export function useWorkbenchStartController(input: {
  scopeId: string;
  visibility: Visibility;
  regionIds: DockRegionId[];
  restoreVisibility(visibility: Visibility): void;
  open(item: DockItemId): void;
  openNote(file: NoteFileSnapshot): void;
  files?: NoteFileService;
}) {
  const latest = useRef(input); latest.current = input;
  const files = useMemo(() => input.files ?? createNoteFileService(input.scopeId, () => latest.current.scopeId), [input.scopeId, input.files]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState("");
  const custom = useRef<Visibility>();
  async function select(kind: "file" | "folder") {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice("");
    const scope = input.scopeId;
    try {
      if (kind === "file") {
        const file = await files.chooseFile({ extension: "md", mode: "open" });
        if (scope !== latest.current.scopeId) return;
        if (file) latest.current.openNote(file);
      } else {
        const mount = await files.chooseFolder();
        if (scope !== latest.current.scopeId) return;
        if (mount) latest.current.open("notes");
      }
    } catch (error) {
      if (scope === latest.current.scopeId) setNotice(error instanceof Error ? error.message : "无法打开所选文件，请重试。");
    } finally { busyRef.current = false; setBusy(false); }
  }
  function applyPreset(preset: WorkbenchTaskPreset) {
    if (preset === "custom") {
      if (custom.current) input.restoreVisibility(custom.current);
      custom.current = undefined;
      return;
    }
    custom.current ??= { collapsed: { ...input.visibility.collapsed }, hiddenRegions: [...input.visibility.hiddenRegions] };
    if (preset === "reading") {
      input.restoreVisibility({ collapsed: { left: true, right: true, bottom: true }, hiddenRegions: input.regionIds.filter(region => region !== "main") });
    } else {
      input.restoreVisibility({ collapsed: { left: false, right: false, bottom: preset === "research" }, hiddenRegions: custom.current.hiddenRegions.filter(region => !["main", "left", "right", "bottom"].includes(region)) });
      input.open("library");
      input.open("assistant");
      if (preset === "processing") input.open("workflow-runs");
    }
  }
  const unavailable = busy ? "正在选择文件，请先完成当前选择。" : !input.files && !isTauri() ? "请在 Liteasy 桌面端使用系统文件选择器。" : undefined;
  const availability: WorkbenchCommandAvailability = unavailable ? { "open-note": unavailable, "open-folder": unavailable } : {};
  return { availability, notice, busy, reportError: setNotice, dismissNotice: () => setNotice(""), applyPreset, openNote: () => select("file"), openFolder: () => select("folder") };
}
