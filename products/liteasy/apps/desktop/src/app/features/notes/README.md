# Notes

Notes is a personal directory view over existing sources, with an optional connection to Markdown folders such as an Obsidian Vault. `notesRepository` stores folder metadata and references in the account-scoped `ObjectStorage`. User-created and imported note bodies are durable `content.note` objects in that store (desktop SQLite, browser IndexedDB). Native annotations and generated artifacts retain their own save and publication flow.

## Sources and directory references

- `default/paper` reads PDF comments, text boxes, and entries with saved AI reviews. A plain highlight can be collected explicitly. Its native annotation identity is retained, so later comment/review edits appear in the same Note entry.
- `default/board` lists board files and user notes placed on boards. Board files open their actual canvas.
- `default/note` contains other user-created or imported Markdown notes.
- `default/artifact` collects thin-reading annotations and explicitly saved generated pages.

Creating a personal directory, copying a reference, and removing a reference do not modify or delete the source. User-note and board directory references follow the latest object revision. Generated pages retain the exact revision captured when collected. PDF and thin-reading annotations resolve by native identity. Missing sources remain manageable as unavailable references. Empty user folders can be deleted; built-in and connected folders are not deleted by this view.

The list displays filenames. Selecting one opens its contents separately. Imported Markdown filenames remain stable when the body is edited. Native PDF/thin-reading entries are edited through **打开来源**; generated artifacts have no edit action in Notes. Editing a user object note advances its current head, while existing pinned board placements, evidence, and history retain their recorded revision.

## Markdown import and connected folders

**导入 Markdown 文件** accepts `.md` and `.markdown` files and creates editable, durable user notes. Dragging a folder imports its Markdown hierarchy; hidden directories such as `.obsidian` and non-Markdown attachments are omitted. Markdown text, frontmatter, and links are preserved verbatim. Import does not resolve Obsidian plugins or wiki links into Liteasy objects.

**连接文件夹 / Obsidian Vault** uses `note-files/noteFileService` to retain a user-selected filesystem grant for this account. The service owns native/browser access, relative-path validation, version checks, and mount persistence. Connected `.md`, `.markdown`, and `.canvas` files appear by filename. A Canvas file opens through the board controller and can be dragged through the workbench's trusted capture ticket.

The physical Markdown file is authoritative for a connected note. An object projection keyed by `note-file-${mountId}-${path}` provides a stable identity and immutable revisions for AI context and board cards; `ObjectRepository.setObjectFileBinding` retains its path. Editing writes to disk with the version captured when the editor opened. A concurrent edit in Obsidian rejects the write and preserves the user's draft. Refresh then projects the current disk contents. External file revisions do not rewrite previously pinned AI evidence.

Copying a connected file into a personal Note directory records an `external-file` reference. Dropping content onto a connected filesystem directory creates a standalone Markdown file (or a Canvas file for a board), preserving included AI review and source text/link. Existing filenames receive a numeric suffix; the service's create-only write still rejects a concurrent name collision. This operation creates an export on disk and does not move the original source. Markdown attachments are preserved as source references/text; the import/export adapter does not copy a Vault's binary asset tree.

## Refresh and integration

`useNotesController` coordinates sources and files; `NotesPanel` depends only on its model. The shell injects the existing `ObjectRepository`, paper/artifact readers, trusted capture receiver, and navigation/file callbacks. `notesFileDrop` reads HTML drag entries before asynchronous file IO and bounds folder traversal.

Local objects, directory references, and successful saves are published before optional PDF/artifact loading. An unavailable or hanging remote artifact request cannot hide a freshly saved local note or hold its save open. A failed PDF read is isolated to that paper. Previously loaded source entries remain in the current view during temporary failures, with a compact source-availability status. After an application restart, unresolved native references may temporarily appear unavailable until their source can be read. External refresh requests are coalesced so object-projection notifications do not enqueue a complete Vault scan for each file.

Features collect references through `useNotes()?.collect(target, folderId)` and call `notifyNotesSourcesChanged()` after successful native source saves. `subscribeObjectStorage` and `subscribeNoteFiles` provide local change notifications. File refresh also occurs when Notes is opened, the application regains focus, or the user selects refresh; this is not a filesystem watch daemon.

This module implements personal views and selected Markdown/Canvas folders. The broader virtual resource filesystem remains a separate proposal.
