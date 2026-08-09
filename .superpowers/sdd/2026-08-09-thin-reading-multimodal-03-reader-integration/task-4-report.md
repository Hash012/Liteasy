# Task 4 Report: Fixed Reader Layout And Minimal Toggle

status: complete
commit: 5b469924729e14ca6e68f2305102f3ff2f0f4cbd

## RED

Added order and capability tests to `src/tests/thinReadingTab.test.tsx` with
`src/tests/fixtures/thinReadingVisualProps.tsx`. Before implementation:

```text
Test Files  1 failed | 1 passed (2)
Tests  2 failed | 44 passed (46)
```

The new tests failed because the reader had no stable node/region ordering and
no capability-gated `多模态` switch.

## GREEN

```text
npm test -- src/tests/thinReadingTab.test.tsx src/tests/ArtifactTabs.test.tsx \
  src/tests/layoutStyleContract.test.ts src/tests/thinReadingStyleContract.test.ts
Test Files  4 passed (4)
Tests  68 passed (68)
```

```text
npm run build
TypeScript, Vite, and 129 production-asset checks passed

git diff --check
passed
```

## Files

- `ThinReadingVisualizationRegion.tsx`: fixed top generated-visual region.
- `ThinReadingSourceFigures.tsx`: fixed bottom paper-figure gallery.
- `VisualizationArtifactHost.tsx`: lazy renderer loading with accessible fallback.
- `ThinReadingTab.tsx`: stable order, v1 read-only legacy label, Fluent switch.
- `thinReading.css`: stable artifact/source stages and responsive stacking.
- `ArtifactTabs.tsx`, `AppShell.tsx`: controller capability/status/artifact wiring.
- `thinReadingTab.test.tsx`, `thinReadingVisualProps.tsx`: RED/GREEN coverage.

## Concerns

- No registered production renderer is present in this checkout, so the host
  intentionally presents the validated accessibility summary until a renderer
  is registered; real-provider smoke still requires deployment-admin setup.
- React test output reports an `act(...)` warning from the asynchronous lazy
  renderer load; assertions and production build are green.
