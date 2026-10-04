import { SearchHighlight } from "../search/SearchOptions";
import { libraryFileDragType, libraryFolderKey } from "./libraryFolderMembership";
import { useMemo, useState, useEffect } from "react";
import { LibraryItemIcon, LibraryIconMenuItem } from "./LibraryItemIcon";
import { Button, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem } from "@fluentui/react-components";
import { EditRegular, TagRegular } from "@fluentui/react-icons";
import { LibraryTagChips } from "./LibraryTagChips";
import type { ReadingCatalogEntry, ReadingCatalogMetadataPatch } from "./readingCatalog.types";
import { readingCatalogFormatLabels } from "./readingCatalog.types";
import { writeAssetContextTransfer } from "../object-transfer/assetContextTransfer";
import { indexReadingCatalog, queryReadingCatalog, type ReadingCatalogFilters } from "./readingCatalogSearch";

export type LibraryFileAccess = {
  entries: ReadingCatalogEntry[];
  selectedId?: string;
  pending: boolean;
  message: string;
  onImport(files: File[], targetFolderPath?: string): Promise<void | string>;
  onMoveFile?(id: string, targetFolderPath?: string): Promise<void>;
  onRelocateFolder?(source: string, target: string): Promise<void>;
  onInspect(entry: ReadingCatalogEntry, open?: () => void): void;
  onOpen(entry: ReadingCatalogEntry): void;
  onMetadataChange?(id: string, patch: ReadingCatalogMetadataPatch): Promise<void>;
  onEditBibliography?(entry: ReadingCatalogEntry): void;
};

/** Non-PDF assets share the existing library search and selection inspector. */
export function LibraryFileList({ access, query, category, filters, folderPath, libraryRootPath = "", rootEntries, depth = 0, onEditMetadata }: { access: LibraryFileAccess; query: string; category: string; filters: ReadingCatalogFilters; folderPath?: string; libraryRootPath?: string; rootEntries?: Set<string>; depth?: number; onEditMetadata?: (entry: ReadingCatalogEntry) => void }) {
  const [limit, setLimit] = useState(50);
  const index = useMemo(() => indexReadingCatalog(access.entries.filter((entry) => entry.format !== "pdf" && (rootEntries ? rootEntries.has(entry.id)
    : libraryFolderKey(`${libraryRootPath}/${entry.folderPath ?? ""}`) === libraryFolderKey(`${libraryRootPath}/${folderPath ?? ""}`)))), [access.entries, folderPath, libraryRootPath, rootEntries]);
  const entries = useMemo(() => queryReadingCatalog(index, { ...filters, query, collection: category }), [index, query, category, filters]);
  useEffect(() => setLimit(50), [query, category, filters]);
  return <>
    <ul className="library-file-list" aria-label="文献库文件">
      {entries.slice(0, limit).map((entry) => <li key={entry.id}>
        <Menu openOnContext><MenuTrigger disableButtonEnhancement><button type="button" className={`library-file-row${access.selectedId === entry.id ? " active" : ""}`}
          data-library-depth={depth}
          style={{ paddingInlineStart: `${depth * 18 + 6}px` }}
          draggable={!access.pending && Boolean(entry.liteasyPath || access.onMoveFile)}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = access.onMoveFile ? "copyMove" : "copy";
            if (access.onMoveFile) event.dataTransfer.setData(libraryFileDragType, entry.id);
            if (entry.liteasyPath) {
              const scope = new URL(entry.liteasyPath).searchParams.get("scope") ?? "local";
              writeAssetContextTransfer(event.dataTransfer, scope, { kind: "path", path: entry.liteasyPath }, entry.title);
            }
          }}
          aria-label={`选择文件 ${entry.title}`} aria-pressed={access.selectedId === entry.id}
          data-reading-entry={entry.format !== "other" ? "true" : undefined}
          onClick={() => access.onInspect(entry)} onFocus={() => access.onInspect(entry)}
          onDoubleClick={() => access.onOpen(entry)} onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); access.onOpen(entry); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const row = event.currentTarget.parentElement;
              const next = event.key === "ArrowDown" ? row?.nextElementSibling : row?.previousElementSibling;
              next?.querySelector<HTMLButtonElement>("button")?.focus();
            }
          }}>
          <LibraryItemIcon itemKey={`file:local:${entry.id}`} kind={entry.format} fileName={entry.fileName} />
          <span className="library-file-name"><SearchHighlight text={entry.title} query={query} /><LibraryTagChips entry={entry} /></span>
          <small>{entry.format === "other" ? entry.fileName?.split(".").pop()?.toUpperCase() : readingCatalogFormatLabels[entry.format]}</small>
        </button></MenuTrigger><MenuPopover><MenuList>
          <LibraryIconMenuItem itemKey={`file:local:${entry.id}`} title={entry.title} />
          {access.onEditBibliography ? <MenuItem icon={<EditRegular />} onClick={() => access.onEditBibliography!(entry)}>编辑元信息</MenuItem> : null}
          {onEditMetadata && access.onMetadataChange ? <MenuItem icon={<TagRegular />} onClick={() => onEditMetadata(entry)}>编辑分类与标签</MenuItem> : null}
        </MenuList></MenuPopover></Menu>
      </li>)}
    </ul>
    {entries.length > limit ? <Button appearance="subtle" onClick={() => setLimit((value) => value + 50)}>显示更多文件（{entries.length - limit}）</Button> : null}
  </>;
}
