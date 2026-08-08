import { useState } from "react";

export type LeftRailView =
  | "artifact-library"
  | "library"
  | "organization"
  | "profile"
  | "settings";

function getPaneHeader(view: LeftRailView) {
  if (view === "artifact-library") {
    return "产物库";
  }

  if (view === "settings") {
    return "Settings";
  }

  if (view === "profile") {
    return "Profile";
  }

  if (view === "organization") {
    return "Organization";
  }

  return "Library";
}

export function useLeftRailNavigation() {
  const [leftRailView, setLeftRailView] = useState<LeftRailView>("library");

  return {
    leftRailView,
    openArtifactLibrary: () => setLeftRailView("artifact-library"),
    openLibrary: () => setLeftRailView("library"),
    openOrganization: () => setLeftRailView("organization"),
    openProfile: () => setLeftRailView("profile"),
    openSettings: () => setLeftRailView("settings"),
    paneHeader: getPaneHeader(leftRailView),
    setLeftRailView
  };
}
