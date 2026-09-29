import { useEffect, useState } from "react";
import { createBlockRegistry } from "../visual-blocks/blockRegistry";
import type { ExtensionPackageStore } from "./extensionPackageStore";

export function useExtensionPackages(store: ExtensionPackageStore) {
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<ExtensionPackageStore["active"]>>>({ packages: [], failures: [], registry: createBlockRegistry() });
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true, generation = 0;
    const reload = async () => {
      const current = ++generation;
      try { const value = await store.active(); if (alive && current === generation) { setSnapshot(value); setError(""); } }
      catch (failure) { if (alive && current === generation) setError(failure instanceof Error ? failure.message : String(failure)); }
    };
    setSnapshot({ packages: [], failures: [], registry: createBlockRegistry() });
    void reload();
    const unsubscribe = store.subscribe(() => void reload());
    return () => { alive = false; unsubscribe(); };
  }, [store]);
  return { store, snapshot, error };
}
export type ExtensionPackagesModel = ReturnType<typeof useExtensionPackages>;
