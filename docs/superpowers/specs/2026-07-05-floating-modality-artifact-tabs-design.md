# Floating Modality Artifact Tabs Design

## Goal

The center workspace starts with only the Reader tab. Multimodal generation is launched from a draggable floating modality button inside the center workspace, and each generated artifact opens as its own closable center tab.

## Interaction

- Initial state: the main Dock region contains only `Reader`; the bottom pane is collapsed by default and no standalone artifact tab is shown.
- Floating launcher: a circular `模态` button floats above the center workspace content. Hovering or focusing it reveals radial buttons for `树形展开`, `思维导图`, `PPT`, and `对比表`.
- Dragging: users can drag the circular launcher within the center workspace bounds. The position is local UI state and stays above Reader and artifact tabs.
- Generation: clicking a modality uses the existing selected-document-set workflow. Each completed artifact gets a unique `artifactId` and opens as a new center tab.
- History: generated artifact tabs are retained until the user closes them with the tab close button.

## Architecture

- Keep `ReaderPane` focused on reading and remove the embedded artifact region from the default path.
- Keep artifact rendering through existing `ArtifactTabs`/`DynamicCanvas` content, but present individual `ArtifactTab` records as extra center tabs instead of a default bottom Dock item.
- Extend the artifact store/controller with unique IDs and tab close support.
- Extend the main Dock region with optional dynamic tabs for generated artifacts while keeping fixed Dock item behavior unchanged for left/right/bottom tools.

## Testing

- Default Dock layout has `Reader` in main and no default bottom artifact pane.
- Floating launcher shows radial modality choices and calls the selected modality handler.
- Completing multiple artifact tasks creates multiple distinct tabs.
- Closing a generated tab removes only that artifact result.
