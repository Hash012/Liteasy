import { libraryFileDragType, libraryFolderKey } from "./libraryFolderMembership";
import { useMemo, useState, useEffect } from "react";
import { LibraryItemIcon, LibraryIconMenuItem } from "./LibraryItemIcon";
import { Button, Menu, MenuTrigger, MenuPopover, MenuList } from "@fluentui/react-components";
import type { ReadingCatalogEntry, ReadingCatalogMetadataPatch } from "./readingCatalog.types";
import { readingCatalogFormatLabels } from "./readingCatalog.types";
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
};

/** Non-PDF assets share the existing library search and selection inspector. */
export function LibraryFileList({ access, query, category, filters, folderPath, libraryRootPath = "", rootEntries, depth = 0 }: { access: LibraryFileAccess; query: string; category: string; filters: ReadingCatalogFilters; folderPath?: string; libraryRootPath?: string; rootEntries?: Set<string>; depth?: number }) {
  const [limit, setLimit] = useState(50);
  const index = useMemo(() => indexReadingCatalog(access.entries.filter((entry) => entry.format !== "pdf" && (rootEntries ? rootEntries.has(entry.id)
    : libraryFolderKey(`${libraryRootPath}/${entry.folderPath ?? ""}`) === libraryFolderKey(`${libraryRootPath}/${folderPath ?? ""}`)))), [access.entries, folderPath, libraryRootPath, rootEntries]);
  const entries = useMemo(() => queryReadingCatalog(index, { ...filters, query, collection: category }), [index, query, category, filters]);
  useEffect(() => setLimit(50), [query, category, filters]);
  return <>
    <ul className="library-file-list" aria-label="文献库文件">
      {entries.slice(0, limit).map((entry) => <li key={entry.id}>
        <Menu openOnContext><MenuTrigger disableButtonEnhancement><button type="button" className={`library-file-row${access.selectedId === entry.id ? " active" : ""}`}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
          draggable={Boolean(access.onMoveFile) && !access.pending}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(libraryFileDragType, entry.id);
          }}
          aria-label={`选择文件 ${entry.title}`} aria-pressed={access.selectedId === entry.id}
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
          <span className="library-file-name">{entry.title}<small>{[entry.authors?.join(" · "), entry.collection, entry.tags?.join(" · ")].filter(Boolean).join(" · ")}</small></span>
          <small>{entry.format === "other" ? entry.fileName?.split(".").pop()?.toUpperCase() : readingCatalogFormatLabels[entry.format]}</small>
        </button></MenuTrigger><MenuPopover><MenuList>
          <LibraryIconMenuItem itemKey={`file:local:${entry.id}`} title={entry.title} />
        </MenuList></MenuPopover></Menu>
      </li>)}
    </ul>
    {entries.length > limit ? <Button appearance="subtle" onClick={() => setLimit((value) => value + 50)}>显示更多文件（{entries.length - limit}）</Button> : null}
  </>;
}
