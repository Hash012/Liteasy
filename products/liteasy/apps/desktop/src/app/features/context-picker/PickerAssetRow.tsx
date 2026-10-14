import { Button, Checkbox, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "@fluentui/react-components";
import { DocumentRegular, FolderRegular, LocationRegular, MoreHorizontalRegular, ImageRegular, InfoRegular } from "@fluentui/react-icons";
import { IconAction } from "../../shared/ui/productPrimitives";
import { ContextAssetThumbnail } from "../assistant/ContextAssetThumbnail";
import { ResourceLink } from "../resource-links/ResourceReferenceView";
import { SearchHighlight } from "../search/SearchOptions";
import type { PickerNode } from "./catalogPort";

export function PickerAssetRow({ node, query, checked, disabled, previewing, added, referenceMode, hasReferences, reason, canLocate, onSelect, onActivate, onLocate }: {
  node: PickerNode; query: string; checked: boolean | "mixed"; disabled: boolean; previewing: boolean; added: boolean;
  referenceMode: boolean; hasReferences: boolean; reason?: string; canLocate: boolean;
  onSelect(checked: boolean, shift: boolean): void; onActivate(): void; onLocate(): void;
}) {
  const asset = node.asset;
  const detail = asset ? asset.unavailableReason ?? (added ? "已加入对话" : asset.searchMetadata?.format?.toUpperCase() ?? "") : node.detail || (node.countState === "ready" ? `${node.count ?? 0} 项` : node.countState === "error" ? "加载失败" : node.countState === "loading" ? "正在加载" : "清单尚未就绪");
  return <article className={`context-picker-row ${asset ? "context-asset-card" : "context-picker-container"}${previewing ? " previewing" : ""}${checked ? " is-selected" : ""}`} data-picker-id={node.id}>
    <span className="context-picker-row-check">{!referenceMode ? <Checkbox aria-label={`选择 ${node.title}`} checked={checked} disabled={disabled} onChange={(event, data) => onSelect(data.checked === true, "shiftKey" in event.nativeEvent && Boolean(event.nativeEvent.shiftKey))} /> : null}</span>
    <span className="context-picker-row-icon">{asset?.loadThumbnail ? <ContextAssetThumbnail asset={asset} compact /> : asset ? asset.category === "图片" ? <ImageRegular /> : <DocumentRegular /> : <FolderRegular />}</span>
    <Button appearance="subtle" className="context-picker-row-main" data-picker-focus data-asset-id={asset?.id} data-node-id={asset ? undefined : node.id} aria-label={`${asset ? "预览" : "进入"} ${node.title}`} aria-pressed={asset ? previewing : undefined} title={node.title} onClick={onActivate}>
      <strong><SearchHighlight text={node.title} query={query} /></strong><small>{detail || "\u00a0"}</small>
    </Button>
    <span className="context-picker-row-actions">
      {asset?.resourcePath && hasReferences ? <ResourceLink locator={asset.resourcePath} sourceMember={asset.sourceMember} ariaLabel={`定位来源 ${node.title}`} presentation="picker" intent="origin" previewOnClick><LocationRegular /></ResourceLink> : null}
      {canLocate || reason ? <Menu><MenuTrigger disableButtonEnhancement><IconAction label={`${node.title} 更多`} appearance="subtle" density="compact" icon={<MoreHorizontalRegular />} /></MenuTrigger><MenuPopover><MenuList>
        {canLocate ? <MenuItem icon={<FolderRegular />} onClick={onLocate}>在资料库中显示</MenuItem> : null}
        {reason ? <MenuItem icon={<InfoRegular />}>{reason}</MenuItem> : null}
      </MenuList></MenuPopover></Menu> : null}
    </span>
  </article>;
}
