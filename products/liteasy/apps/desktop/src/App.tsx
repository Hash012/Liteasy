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
  return <AppShell />;
}
