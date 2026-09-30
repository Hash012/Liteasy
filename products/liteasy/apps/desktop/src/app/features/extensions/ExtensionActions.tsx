import { useState } from "react";
import { Button, MenuItem } from "@fluentui/react-components";
import { useExtensionWorkbench } from "./extensionWorkbenchContext";

/** Menus are host slots, never DOM injection. Selection contains canonical resource paths. */
export function ExtensionActions({ location, selection, paperCount = 0, menu = false, resolveSelection }: {
  location: "library.item.context" | "reader.selection" | "board.context";
  selection: string[]; paperCount?: number; menu?: boolean; resolveSelection?(): Promise<string[]>;
}) {
  const host = useExtensionWorkbench();
  const [error, setError] = useState("");
  const actions = host?.packages.snapshot.packages.flatMap((pkg) => pkg.manifest.contributes.menus.filter((item) => item.location === location && (!item.when || (item.when.left.context === "selection.paperCount" ? paperCount : selection.length) >= item.when.right)).map((item) => ({ owner: pkg.manifest.id, command: pkg.manifest.contributes.commands.find((command) => command.id === item.command)! }))) ?? [];
  const Component = menu ? MenuItem : Button;
  return <>{actions.map(({ owner, command }) => <Component key={`${owner}/${command.id}`} onClick={() => { setError(""); void (async () => host?.invoke(owner, command.id, resolveSelection ? await resolveSelection() : selection))().catch((e) => setError(String(e))); }}>{command.title}</Component>)}{error ? <span role="alert">{error}</span> : null}</>;
}
