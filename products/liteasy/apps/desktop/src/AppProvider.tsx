import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { PropsWithChildren } from "react";

export function AppProvider({ children }: PropsWithChildren) {
  return <FluentProvider applyStylesToPortals={false} className="fluent-app-root" theme={webLightTheme}>{children}</FluentProvider>;
}
