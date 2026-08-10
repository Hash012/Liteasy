import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { ThinReadingTab } from "../../app/features/thin-reading/ThinReadingTab";
import type { ThinReadingDocument } from "../../app/features/thin-reading/thinReading.types";
import { createThinReadingDocument } from "../../app/features/thin-reading/thinReadingProjection";
import {
  createThinReadingAnchorGraphFixture,
  createThinReadingMaximumDensityAnchorGraphFixture
} from "./thinReadingFixtures";

type PageRecommendationGraphFixtureVariant = "maximum" | "standard";

function PageRecommendationGraphFixture({ variant }: { variant: PageRecommendationGraphFixtureVariant }) {
  const fixture = variant === "maximum"
    ? createThinReadingMaximumDensityAnchorGraphFixture()
    : createThinReadingAnchorGraphFixture();
  const [document, setDocument] = useState<ThinReadingDocument>(() =>
    createThinReadingDocument(fixture)
  );

  return (
    <FluentProvider theme={webLightTheme}>
      <ThinReadingTab
        artifactId={fixture.artifactId}
        document={document}
        onUpdateDocument={(_, nextDocument) => setDocument(nextDocument)}
        papers={[...fixture.papers]}
      />
    </FluentProvider>
  );
}

export async function mountPageRecommendationGraphFixture(
  container: HTMLElement | null,
  variant: PageRecommendationGraphFixtureVariant = "standard"
) {
  if (!container) throw new Error("Page recommendation graph fixture mount point is missing.");
  document.documentElement.style.overflowX = "hidden";
  document.body.style.margin = "0";
  container.style.minHeight = "100vh";
  createRoot(container).render(<PageRecommendationGraphFixture variant={variant} />);
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
