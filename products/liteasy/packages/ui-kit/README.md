# Liteasy UI kit

Declarative extensions compose host components instead of shipping a second renderer. The runtime catalog is exposed by `liteasy_extension_catalog`.

| Base family | Semantic content | Inherited host behavior |
| --- | --- | --- |
| `liteasy/RichTextBlock@1.0.0` | Markdown text | Typography, math/diagram/image rendering, drag/context, path and revision |
| `liteasy/MediaBlock@1.0.0` | Text and image reference | Same common shell and content fallback |
| `liteasy/ResourceBlock@1.0.0` | Referenced Liteasy asset | Navigation, source identity and readable fallback |
| `liteasy/CollectionBlock@1.0.0` | Structured rows | Bounded table rendering and rich cell content |
| `liteasy/GroupBlock@1.0.0` | Group content | Common shell; Canvas contains independent layout |

Derived schemas add semantic fields and cannot replace inherited fields. Templates append to base content. Allowed composition primitives: `Stack`, `Grid`, `Card`, `MarkdownView`, `Image`, `ResourceCard`, `Table`, `Divider`. Bind with `{ "$field": "text" }`; view configuration can use a bounded dotted binding such as `settings.reading.fontSize`. No expressions or event-handler source code.

Use theme tokens and the existing Fluent provider. Font, line height, wrapping, layout lock and layer are independent presentation properties. Updating structured content must retain manual position/size; Canvas metadata preserves presentation and typed content while plain Markdown remains readable outside Liteasy.

Inspect and edit the ordinary paper-comparison package in Workflow Studio for a complete type, composition, settings, view, workflow, skill and fixture example. It is installed and validated through the same path as user packages.

The catalog also includes `Split`, `Toolbar`, `Tabs`, `Status`, `EmptyState`, `Field`, `Dialog`, `EvidenceCard`, `CitationList`, `Timeline`, `TreeOutline`, `Visualization`, `MarkdownEditor` and `ResourcePicker`. They are trusted host primitives, not imported React source. `Visualization` validates the existing visualization artifact contract and uses its renderer registry. List primitives page at 30 items. `MarkdownEditor` explicitly reads a selected path and saves through the ordinary expected-revision asset service; partial reads and read-only resources cannot be replaced.

Discover a component's complete props schema through `liteasy_extension_catalog` with `kind: "component", id: "EvidenceCard"`. Invalid props and unknown components are rejected during package validation. `ResourcePicker` performs metadata search only when the user invokes it. More specialized professional surfaces retain their original strict validators; an unlisted component is not an available SDK component.

Images share a 24 MiB decoded-media budget, a two-read queue and URL cleanup. Canvas only mounts visible cards (80 maximum with overscan), and the layer list pages at 50 items. These are renderer-side resource limits, not a claim of WebView process isolation. Arbitrary scripts remain unavailable.
