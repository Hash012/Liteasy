import { ExtensionActions } from "./ExtensionActions";
import { useObjectWorkbench, type PdfCaptureInput } from "../objects/objectWorkbenchPort";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
/** The selected excerpt becomes an ordinary addressable asset before invoking an extension. */
export function ReaderExtensionActions({ input, resolve }: { input: PdfCaptureInput; resolve?(): Promise<PdfCaptureInput> }) {
  const host = useObjectWorkbench();
  if (!host?.scopeId) return null;
  const scope = host.scopeId;
  return <ExtensionActions location="reader.selection" paperCount={1} selection={[liteasyPath(scope, { kind: "paper", paperId: input.paper.id })]} resolveSelection={async () => {
    const refs = await host.capturePdf(resolve ? await resolve() : input, "tray");
    return refs.map((ref) => liteasyPath(scope, { kind: "object", ref }));
  }} />;
}
