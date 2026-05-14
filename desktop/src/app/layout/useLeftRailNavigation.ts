import { useState } from "react";

export type LeftRailView = "library" | "organization" | "profile" | "settings";

function getPaneHeader(view: LeftRailView) {
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
    openLibrary: () => setLeftRailView("library"),
    openOrganization: () => setLeftRailView("organization"),
    openProfile: () => setLeftRailView("profile"),
    openSettings: () => setLeftRailView("settings"),
    paneHeader: getPaneHeader(leftRailView),
    setLeftRailView
  };
}
