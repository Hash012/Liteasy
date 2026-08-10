# Task 5 Review Package

Status: complete
Commits:

- `85c7e7c` `feat: deepen thin reading visual objects`
- `b5fb027` `fix: wire thin reading visual deep dives`

## Scope

Task 5 adds fail-closed deep-dive targets for generated semantic objects, whole source figures, and bounded source regions. A visualization target is now a typed thin-reading branch source. V1 branches continue to use the existing clone-to-v2 path; V2 branches use the normal child-node projection.

## Test-first Evidence

- RED: the new target and overlay suites initially failed because both requested modules were absent.
- GREEN: `npm test -- src/tests/thinReadingDeepDiveTarget.test.ts src/tests/SourceFigureSelectionOverlay.test.tsx src/tests/thinReadingProjection.test.ts src/tests/useArtifactActions.test.ts`
- Result: 4 files passed, 58 tests passed.

## Quality Review

- Coordinate normalization clamps drag endpoints to the rendered image box, rejects non-finite/tiny/invalid rectangles, and preserves intrinsic pixel dimensions.
- Generated object targets resolve by stable artifact/object IDs and require selectable objects plus known claim evidence. Unknown claims fail with `deep_dive_target_evidence_invalid`.
- Production composition now mounts source-figure overlay controls in `ThinReadingSourceFigures` and keyboard-accessible semantic-object actions in `VisualizationArtifactHost`, both wired through `ThinReadingTab` to the existing branch generator.
- Source targets require stable figure identity and non-empty evidence; persisted target validation also bounds normalized regions and pixel sizes.
- Projection freezes target arrays/objects and maps target evidence into the selected-passage recommendation scope.
- Recovery snapshots validate visualization targets against their parent node before retry.
- UI uses Fluent `Button`, `Popover`, `Field`, and bounded numeric inputs; no provider/model/cost diagnostics are shown.

## Verification

- `npm run build`: TypeScript, Vite, and 129 production-asset checks passed.
- `git diff --cached --check`: passed.
- Composition regression: `npm test -- src/tests/thinReadingDeepDiveComposition.test.tsx` passed (1/1).
- Real provider smoke remains unavailable without deployment-admin configuration.

## Concerns

- Real-provider smoke still requires deployment-admin route and account configuration.

## Pointer Overlay Fix

Fresh exact-HEAD verification exposed that pointer selection rendered an unpositioned span. A regression test now checks the normalized visible rectangle, and the overlay renders bounded percentage geometry over the source image.

```text
RED: SourceFigureSelectionOverlay pointer rectangle test could not find a positioned test target.
GREEN: SourceFigureSelectionOverlay.test.tsx passed 2/2.
```

## Finding-Driven Compatibility

`thinReading.types.ts`, `thinReadingProjection.ts`, `useArtifactActions.ts`, `artifactTaskRecovery.ts`, `thinReadingVersioning.ts`, and one external-knowledge fallback guard in `generateAssistantAnswer.ts` are included because the new `visualization_target` branch source must compile, persist, recover, and generate through the existing reader pipeline. Existing unrelated user edits remain unstaged.

## Review Fix Round 1

All five Important findings are addressed in a separate follow-up change.

- Source-region input uses the loaded native image rectangle and intrinsic pixel dimensions. The visible selection rectangle is positioned against the same image content box, including centered letterboxed images.
- Generated-object targets require a currently passing visualization artifact and exact selected object path and claim IDs; every claim must belong to both the artifact and active node.
- Only agent-recommended, evidence-bound source figures expose deep-dive controls. Fallback figures remain static, and branch generation independently verifies the exact recommendation binding.
- Persisted v2 documents and interrupted-task recovery now reject stale generated objects, stale figures, mismatched claims, and invalid regions through the same parent-node binding validator.
- V1 branching saves a complete v2 `AgentArtifactResult` before creating the local clone or invoking recursive generation. A save failure leaves no clone and starts no Agent run.

### Test-first Evidence

- RED: new regression cases failed for stale persistence/recovery, fallback source controls, native image geometry, injected claims, and v1 clone durability.
- GREEN: `npm test -- src/tests/thinReadingDeepDiveTarget.test.ts src/tests/SourceFigureSelectionOverlay.test.tsx src/tests/thinReadingDeepDiveComposition.test.tsx src/tests/thinReadingProjection.test.ts src/tests/useArtifactActions.test.ts src/tests/thinReadingVersioning.test.ts src/tests/artifactTaskRecovery.test.ts` passed, 84/84.
- `npm run build` passed, including TypeScript and production-asset verification.
- `git diff --check` passed.

Real provider smoke remains unavailable without deployment-admin route and account configuration.
