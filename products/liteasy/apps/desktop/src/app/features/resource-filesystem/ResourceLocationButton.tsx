import { displayPath } from "./displayPath";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Popover, PopoverSurface, PopoverTrigger, Tooltip } from "@fluentui/react-components";
import { CopyRegular, FolderOpenRegular, LinkRegular } from "@fluentui/react-icons";
import { useObjectWorkbench } from "../objects/objectWorkbenchPort";
import { liteasyPath, type ResourceLocation, type ResourceTarget } from "./liteasyPath";

export function ResourceLocationButton({ target, className }: { target: ResourceTarget; className?: string }) {
  const workbench = useObjectWorkbench();
  const [location, setLocation] = useState<ResourceLocation>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const path = workbench?.scopeId ? liteasyPath(workbench.scopeId, target) : "";
  useEffect(() => {
    request.current += 1;
    setLocation(undefined); setMessage(""); setBusy(false);
    return () => { request.current += 1; };
  }, [path]);
  if (!workbench?.describeResource || !workbench.scopeId) return null;
  async function inspect(reveal = false) {
    const current = ++request.current;
    setBusy(true); setMessage(""); setLocation(undefined);
    try { const result = await workbench!.describeResource!(target, reveal); if (request.current === current) setLocation(result); }
    catch (e) { if (request.current === current) setMessage(e instanceof Error ? e.message : String(e)); }
    finally { if (request.current === current) setBusy(false); }
  }
  return <Popover positioning="below" onOpenChange={(_, data) => { if (data.open) void inspect(); }}>
    <PopoverTrigger disableButtonEnhancement>
      <Tooltip content="位置与 Liteasy Path" relationship="description">
        <Button className={className} aria-label="位置与 Liteasy Path" appearance="subtle" size="small" icon={<LinkRegular />} />
      </Tooltip>
    </PopoverTrigger>
    <PopoverSurface style={{ maxWidth: "min(520px, 90vw)", minWidth: "280px" }}>
      <strong>位置与 Liteasy Path</strong>
      <p>复制 Liteasy Path，在 Agent 中添加为上下文。</p>
      <Input aria-label="Liteasy Path" readOnly value={path} style={{ width: "100%" }} />
      <Button size="small" icon={<CopyRegular />} onClick={() => {
        void navigator.clipboard.writeText(path).then(() => setMessage("已复制 Liteasy Path。")).catch(() => setMessage("复制失败，请选中路径手动复制。"));
      }}>复制 Liteasy Path</Button>
      <p>实际位置{location?.physicalKind === "database" ? "（内容保存在数据库中）" : ""}</p>
      <Input aria-label="资源实际位置" readOnly value={displayPath(location?.physicalPath ?? (busy ? "读取中…" : "位置不可用"))} style={{ width: "100%" }} />
      <Button size="small" icon={<FolderOpenRegular />} disabled={busy || !location?.canReveal} onClick={() => void inspect(true)}>在文件管理器中显示</Button>
      {message ? <p role="status">{message}</p> : null}
    </PopoverSurface>
  </Popover>;
}
