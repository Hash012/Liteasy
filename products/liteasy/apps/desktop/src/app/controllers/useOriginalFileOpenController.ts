import { useEffect, useMemo, useRef, useState } from "react";
import { localDiagnostics } from "../features/local-diagnostics/localDiagnostics";
import {
  createOriginalFileService, isOriginalFileOpenAvailable,
  type OriginalFileDescriptor, type OriginalFileService
} from "../features/original-files/originalFileService";

type Input = {
  scopeId: string;
  onOpenPdf(file: OriginalFileDescriptor, bytes: Uint8Array): Promise<unknown>;
  onOpenEpub(file: OriginalFileDescriptor, bytes: Uint8Array): Promise<unknown>;
  onError(message: string): void;
  service?: OriginalFileService;
};
type Session = { live: boolean; busy: boolean; wake: boolean; drain(): Promise<void> };

/** Chooser and OS handoff share one grant reader and the existing document readers. */
export function useOriginalFileOpenController(input: Input) {
  const latest = useRef(input);
  latest.current = input;
  const scope = input.scopeId;
  const service = useMemo(() => input.service ?? createOriginalFileService(scope, () => latest.current.scopeId), [scope, input.service]);
  const available = Boolean(input.service) || isOriginalFileOpenAvailable();
  const [busy, setBusy] = useState(false);
  const session = useRef<Session>();
  const valid = (state: Session) => state.live && session.current === state && latest.current.scopeId === scope;
  const report = (state: Session, error: unknown) => {
    if (valid(state)) latest.current.onError(error instanceof Error ? error.message : String(error));
  };
  async function open(state: Session, file: OriginalFileDescriptor, diagnosticGeneration = localDiagnostics.getSnapshot().generation) {
    let retained = false;
    try {
      const options = { format: file.format, isCurrent: () => valid(state) && localDiagnostics.getSnapshot().generation === diagnosticGeneration };
      const bytes = await localDiagnostics.measure("read_file", () => service.read(file), options);
      if (!valid(state)) return;
      if (file.format === "pdf") {
        await localDiagnostics.measure("open_reader", () => latest.current.onOpenPdf(file, bytes), options);
        retained = valid(state);
      } else await localDiagnostics.measure("open_reader", () => latest.current.onOpenEpub(file, bytes), options);
    } finally {
      if (!retained) await service.release(file);
    }
  }

  useEffect(() => {
    const state: Session = { live: true, busy: false, wake: false, drain: async () => undefined };
    session.current = state;
    setBusy(false);
    let unsubscribe: (() => void) | undefined;
    state.drain = async () => {
      if (!valid(state)) return;
      state.wake = true;
      if (state.busy) return;
      state.busy = true;
      setBusy(true);
      try {
        while (state.wake && valid(state)) {
          state.wake = false;
          const batch = await service.drain();
          if (!valid(state)) { await Promise.allSettled(batch.files.map((file) => service.release(file))); return; }
          for (const error of batch.errors) report(state, error.message);
          for (const file of batch.files) {
            if (!valid(state)) { await service.release(file); continue; }
            try { await open(state, file); }
            catch (error) { report(state, error); }
          }
        }
      } catch (error) { report(state, error); }
      finally { state.busy = false; if (valid(state)) setBusy(false); }
    };
    if (available) {
      // Listen before draining so an event between startup and subscription is not lost.
      void service.subscribe(() => { void state.drain(); }).then((stop) => {
        if (!valid(state)) { stop(); return; }
        unsubscribe = stop;
        void state.drain();
      }).catch((error) => report(state, error));
    }
    return () => { state.live = false; unsubscribe?.(); localDiagnostics.reset(); };
  }, [scope, service, available]);

  return {
    available,
    busy,
    disabledReason: !available ? "请在桌面应用中打开原位置文件。" : busy ? "正在打开文件，请稍候。" : undefined,
    async openFile() {
      const state = session.current;
      if (!available || !state || !valid(state) || state.busy) return;
      state.busy = true;
      setBusy(true);
      const diagnosticGeneration = localDiagnostics.getSnapshot().generation;
      try {
        const file = await localDiagnostics.measure("choose_file", () => service.choose(), {
          isCurrent: () => valid(state) && localDiagnostics.getSnapshot().generation === diagnosticGeneration,
        });
        if (file) {
          if (valid(state)) await open(state, file, diagnosticGeneration);
          else await service.release(file);
        }
      } catch (error) { report(state, error); }
      finally {
        state.busy = false;
        if (valid(state)) {
          setBusy(false);
          if (state.wake) void state.drain();
        }
      }
    }
  };
}
