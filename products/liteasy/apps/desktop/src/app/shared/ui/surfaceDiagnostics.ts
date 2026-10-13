import packageInfo from "../../../../package.json";
export type SurfaceDiagnostic = { id: string; time: string; version: string; surface: string; kind: "render" | "event" | "promise"; error: string; frames: string[] };
const records: SurfaceDiagnostic[] = [];
const listeners = new Set<(record: SurfaceDiagnostic, instance?: string) => void>();
const errorNames = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError", "AbortError", "TimeoutError"]);
const safeName = (name: string) => name.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 80);
/** Deliberately excludes messages, URLs, filesystem paths, component props and document text. */
export function reportSurfaceError(surface: string, error: unknown, kind: SurfaceDiagnostic["kind"], componentStack = "", instance?: string) {
  const record: SurfaceDiagnostic = {
    id: `ui-${Date.now().toString(36)}`, time: new Date().toISOString(), version: packageInfo.version,
    surface: safeName(surface), kind, error: error instanceof Error && errorNames.has(error.name) ? error.name : "UnknownError",
    frames: (componentStack || (error instanceof Error ? error.stack : "") || "").split("\n").slice(1, 13).flatMap(line => {
      const match = line.match(/^\s*at\s+([A-Za-z_$][\w.$]*)/); return match ? [safeName(match[1])] : [];
    }),
  };
  const duplicate = records.find(item => item.surface === record.surface && item.kind === kind && item.error === record.error && item.frames.join() === record.frames.join() && Date.now() - Date.parse(item.time) < 60_000);
  if (!duplicate) { records.push(record); if (records.length > 20) records.shift(); }
  // Deduplicate retained diagnostics, never the visible feedback for a new failed attempt.
  for (const listener of listeners) listener(duplicate ?? record, instance);
  return duplicate ?? record;
}
export function subscribeSurfaceDiagnostics(listener: (record: SurfaceDiagnostic, instance?: string) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function surfaceDiagnostics() { return records.map(record => ({ ...record, frames: [...record.frames] })); }
export function installSurfaceErrorListeners(target: Window = window) {
  const activeOwner = () => target.document.activeElement?.closest<HTMLElement>("[data-error-surface]");
  const report = (cause: unknown, kind: "event" | "promise") => {
    const owner = activeOwner();
    reportSurfaceError(owner?.dataset.errorSurface ?? "workspace", cause, kind, "", owner?.dataset.errorInstance);
  };
  const error = (event: ErrorEvent) => { report(event.error, "event"); };
  const rejection = (event: PromiseRejectionEvent) => { report(event.reason, "promise"); };
  target.addEventListener("error", error); target.addEventListener("unhandledrejection", rejection);
  return () => { target.removeEventListener("error", error); target.removeEventListener("unhandledrejection", rejection); };
}
