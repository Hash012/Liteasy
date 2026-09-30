# Android acceptance guide

Use a physical ARM64 phone with Android 8+ and an up-to-date Android System WebView. Install the debug APK with `adb install -r`; keep the same signing key for subsequent upgrades. Do not uninstall or clear app data when testing upgrade preservation. The debug build includes native symbols and is intentionally larger than a release build.

| Flow | Procedure | Expected outcome |
| --- | --- | --- |
| Cold/warm share | From another app, share a PDF, image, URL and plain text; repeat with Liteasy already open and with multiple files | Each capture appears independently for review; title/category/note and the destination library can be confirmed before saving |
| Capture durability | Finish capture, remove the source, kill/reopen Liteasy, then save | The private copy remains readable; interrupted capture reports a recoverable error rather than an empty saved item |
| Offline reading | Import a text PDF and a scanned PDF; disconnect networking, open/search/jump/zoom | Local pages render; embedded-text search/reflow works where text exists; the scanned case does not invent text |
| Annotation persistence | Highlight, underline, write with finger/stylus, erase, add notes, undo/redo, kill/reopen | Saved annotations remain on the correct page/geometry; two-finger zoom creates no accidental ink |
| Phone/tablet navigation | Rotate while reading; use back from a modal, annotation list, reflow and the reader; open the keyboard | Layers close before the document; current document/page survives rotation; controls avoid system bars/cutouts/keyboard |
| Upgrade | Save a file, reading position, notes and ink, install the next build with `-r`, reopen | Local files, metadata and annotations survive; a version-1 database upgrades to version 2 without losing records |
| Two-device sync | Configure the same HTTPS WebDAV folder on phone and desktop; edit separate annotations, then the same annotation, and sync both ways | Independent annotations converge; conflicting changes remain as visible private copies; wrong PDF hashes never accept old geometry |
| Interrupted sync | Interrupt a transfer/publish; reconnect and retry | Completed downloads are reusable; missing/corrupt remote state reports an error; local edits are not silently replaced |
| Account boundaries | Login, explicitly copy guest resources, switch accounts, logout while requests are pending | Guest originals remain; libraries/credentials/results stay separate; late responses cannot repopulate the previous account |
| Desktop tasks | Follow [device setup](device-control.md), pair, submit each supported action, disable summary consent and retry a summary | The active desktop performs the permitted action and returns a bounded result; summary requires explicit permission and a configured live model |
| Unknown delivery | Disconnect after submission, cancel before the receipt arrives, reopen/reconnect | The same operation ID is retried; cancellation survives; no duplicate desktop effects are automatically executed |
| Offline result | Open a completed task result, disconnect and reopen it | Previously opened result text remains readable; an older cached result cannot impersonate a newer task version |

Native instrumentation covers storage, capture, WebDAV/JNI and account/outbox fault handling. Browser flows cover PDF rendering and touch interactions. Neither replaces the physical-device scenarios above or acceptance against the deployed identity provider, business API, WebDAV provider and configured desktop model. See the [evidence log](../../../../../docs/agent-dev/2026-09-30-mobile-implementation.md) for the latest executed checks and remaining limitations.
