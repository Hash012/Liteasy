import { useCallback, useRef } from "react";
import {
  createExtensionRuntime,
  type ExtensionHostBridge,
  type ExtensionRuntime
} from "../features/extensions/extensionApi";
import { LITEASY_READER_SELECTION_VERSION } from "../features/extensions/extensionApi.types";
import type { PdfReaderSelectionSnapshot } from "../features/pdf/PdfReader";

const unavailableExtensionHost: ExtensionHostBridge = {
  async invokeHandler() {
    throw new Error("extension_sandbox_host_unavailable");
  }
};

export type ExtensionRuntimeController = {
  actions: {
    publishReaderSelection: (selection: PdfReaderSelectionSnapshot | null) => void;
  };
  runtime: ExtensionRuntime;
};

export function useExtensionRuntimeController(
  bridge: ExtensionHostBridge = unavailableExtensionHost
): ExtensionRuntimeController {
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const runtimeRef = useRef<ExtensionRuntime | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = createExtensionRuntime({
      invokeHandler: (request) => bridgeRef.current.invokeHandler(request)
    });
  }
  const runtime = runtimeRef.current;

  const publishReaderSelection = useCallback((selection: PdfReaderSelectionSnapshot | null) => {
    void runtime.emitReaderSelectionChanged(selection
      ? {
          ...selection,
          version: LITEASY_READER_SELECTION_VERSION
        }
      : null);
  }, [runtime]);

  return {
    actions: {
      publishReaderSelection
    },
    runtime
  };
}
