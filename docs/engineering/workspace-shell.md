# Desktop workspace shell

The native window title bar is unchanged. `AppShell` composes a permanent 40px
`WorkspaceCommandBar`, the existing dock workspace, and a 26px `FileStatusBar`.
`workspaceShell.css` owns these dimensions and uses the surrounding Fluent
provider's neutral, interaction, and status tokens. It removes only the outer
dock borders, radii, and shadows; pane sizing, resizing, tab placement, and page
content remain owned by their existing implementations.

`useWorkspaceShellController` projects the active dock surface into
`WorkspaceToolbarState` and `FileStatus`. Pointer and keyboard focus follow the
current pane, including the persistent Agent portal. Opening a dynamic tab also
updates context. Back/Forward traverse visited open surfaces, skip closed
surfaces, and discard forward history after a new visit. Changing the active
note updates its title and status without adding a separate note-level route.

Search focuses the existing Library/Notes search field or opens the existing
PDF search. Layout calls the existing left/right/bottom collapse operations.
Lower priority commands move into More as the bar narrows; More also exposes
the existing Settings entry. View options is omitted until it has a concrete
workspace command. The activity bar and its existing controls are retained.

PDF metadata comes from an optional read-only `onDocumentInfo` callback using
the document already loaded by PDF.js. It does not re-fetch the file. Import
jobs provide parsing/indexing status. Notes use their existing selected item;
external file projection timestamps are not presented as file modification
times. Unknown byte counts, timestamps, source, indexing, and sync state are
omitted. In particular, an open PDF never implies that synchronization has
succeeded. Paths appear only in the filename tooltip.

## Theme work and validation

The change does not edit `main.tsx`, `app.css`, theme providers, appearance
preferences, or Settings. The shell inherits either Fluent theme supplied by
the separate appearance work. `workspaceShell.browser.spec.ts` uses a dedicated
fixture to exercise live light/dark token changes and portaled menus, alongside
real AppShell workflows for Library, Settings, Notes, PDF, history, search,
metadata, and narrow-window overflow. `dockWorkspace.browser.spec.ts` checks
that tab movement, pane splitting, and the persistent Agent surface still work.

Run from `products/liteasy/apps/desktop`:

```sh
npm test -- src/tests/workspaceShell.test.tsx src/tests/AppShell.test.tsx src/tests/ReaderPane.test.tsx
npx playwright test workspaceShell.browser.spec.ts dockWorkspace.browser.spec.ts --workers=1
npm run ci:smoke
npm run build
# After committing, with a clean worktree:
npm run ci:contracts
```

Screenshots generated during local review belong in ignored output, not source
control. The local review bundle for this implementation is
`.liteasy-run/ui-shell/index.html`: matching 1440×900 before/after screenshots,
a narrow-window screenshot, and a dark compatibility preview combining this
shell with the other session's appearance provider/styles in a disposable
checkout. Browser screenshots do not include native Windows window chrome;
this validation does not claim a Windows installer run.
