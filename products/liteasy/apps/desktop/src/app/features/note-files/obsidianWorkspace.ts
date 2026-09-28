export type ExternalEditingStatus = { available: boolean; open: boolean; editing: boolean };

/** A saved workspace is advisory, not a lock or proof that the process is still running. */
export function obsidianEditingStatus(workspace: unknown, path: string): ExternalEditingStatus {
  const result = { available: Boolean(workspace && typeof workspace === "object"), open: false, editing: false };
  const pending: unknown[] = [workspace];
  let visited = 0;
  while (pending.length && visited++ < 10_000) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    const value = node as Record<string, unknown>;
    const state = value.state as { file?: string; mode?: string } | undefined;
    if (value.type === "markdown" && state?.file?.replace(/\\/g, "/") === path) {
      result.open = true;
      result.editing ||= state.mode !== "preview";
    }
    pending.push(...Object.values(value).filter((child) => child && typeof child === "object"));
  }
  return result;
}
