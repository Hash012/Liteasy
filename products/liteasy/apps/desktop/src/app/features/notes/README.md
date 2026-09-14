# Notes

Notes is a personal directory view over existing sources. `notesRepository` stores folder metadata and references in the same account-scoped `ObjectStorage` used by the object workbench. It stores no note bodies, PDF annotation publication fields, generated pages, or multimodal payloads.

`default/paper` reads user-written PDF comments and text boxes from the existing PDF store. `default/board` maps user-created object notes currently on a board; `default/note` contains other user object notes. `default/artifact` collects thin-reading annotations and explicitly saved generated pages. A plain highlight with no user comment is not automatically classified as user-written text, but can still be collected explicitly. Images without user text are not automatically added.

Creating a directory, copying a reference, and removing a directory reference do not modify or delete any source. User-note directory entries follow the object's latest revision. Generated pages retain the exact object revision captured when collected. PDF and thin-reading annotation references resolve through their native identities. Missing sources remain visible as unavailable references so users can clean their directories. Empty user folders can be deleted; built-in folders cannot.

`useNotesController` handles scope, read adapters, live refresh, and source-opening callbacks. `NotesPanel` depends only on its model. The shell injects the existing `ObjectRepository`, paper and artifact readers, and navigation callbacks. Features use `useNotes()?.collect(target, folderId)` and call `notifyNotesSourcesChanged()` after their own native source saves complete. Object-store commits already notify live Notes views through `subscribeObjectStorage`.

Editing a user object note changes that object's current head. Existing pinned board placements, evidence, and history retain their revision. Native PDF/thin-reading notes are edited through **打开来源**, preserving their owner’s save and publication flow. Generated artifacts have no edit action in Notes.

This module is a bounded personal view, not the proposed full virtual resource filesystem.
