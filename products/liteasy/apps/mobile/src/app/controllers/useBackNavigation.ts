import { useEffect } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { hasNativeHost, nativeRequest } from "../platform/native";
import { hasOpenDialog, navigateBack } from "../features/navigation/backNavigation";

export function useBackNavigation() {
  useEffect(() => {
    let disposed = false; let remove: (() => void) | undefined;
    if (hasNativeHost()) void onBackButtonPress(() => {
      if (!navigateBack()) void nativeRequest("backgroundApp");
    }).then((listener) => { if (disposed) void listener.unregister(); else remove = () => { void listener.unregister(); }; }).catch(() => {});
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !hasOpenDialog() && navigateBack()) event.preventDefault();
    };
    document.addEventListener("keydown", key);
    return () => { disposed = true; remove?.(); document.removeEventListener("keydown", key); };
  }, []);
}
