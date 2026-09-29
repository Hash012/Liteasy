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
