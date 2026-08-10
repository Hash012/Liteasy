import { lazy, Suspense } from "react";
import { AppShell } from "./app/layout/AppShell";

const ArtifactExportBrowserFixture = import.meta.env.DEV
  ? lazy(() => import("./tests/fixtures/artifactExportBrowserFixture"))
  : null;
const ArtifactLibraryBrowserFixture = import.meta.env.DEV
  ? lazy(() => import("./tests/fixtures/artifactLibraryBrowserFixture"))
  : null;
const SemanticGraphBrowserFixture = import.meta.env.DEV
  ? lazy(() => import("./tests/fixtures/semanticGraphBrowserFixture"))
  : null;
const ScienceDiagramBrowserFixture = import.meta.env.DEV
  ? lazy(() => import("./tests/fixtures/scienceDiagramBrowserFixture"))
  : null;
const BiologyStructureBrowserFixture = import.meta.env.DEV
  ? lazy(() => import("./tests/fixtures/biologyStructureBrowserFixture"))
  : null;
const FunctionPlotBrowserFixture = import.meta.env.DEV
  ? lazy(() => import("./tests/fixtures/functionPlotBrowserFixture"))
  : null;

export default function App() {
  const fixture = import.meta.env.DEV ? window.location.search : "";
  if (fixture === "?artifact-export-fixture" && ArtifactExportBrowserFixture) {
    return (
      <Suspense fallback={null}>
        <ArtifactExportBrowserFixture />
      </Suspense>
    );
  }
  if (fixture === "?artifact-library-fixture" && ArtifactLibraryBrowserFixture) {
    return (
      <Suspense fallback={null}>
        <ArtifactLibraryBrowserFixture />
      </Suspense>
    );
  }
  if (fixture === "?semantic-graph-fixture" && SemanticGraphBrowserFixture) {
    return (
      <Suspense fallback={null}>
        <SemanticGraphBrowserFixture />
      </Suspense>
    );
  }
  if (fixture === "?science-diagram-fixture" && ScienceDiagramBrowserFixture) {
    return (
      <Suspense fallback={null}>
        <ScienceDiagramBrowserFixture />
      </Suspense>
    );
  }
  if (fixture === "?biology-structure-fixture" && BiologyStructureBrowserFixture) {
    return (
      <Suspense fallback={null}>
        <BiologyStructureBrowserFixture />
      </Suspense>
    );
  }
  if (fixture === "?function-plot-fixture" && FunctionPlotBrowserFixture) {
    return (
      <Suspense fallback={null}>
        <FunctionPlotBrowserFixture />
      </Suspense>
    );
  }
  return <AppShell />;
}
