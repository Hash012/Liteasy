import { createRoot } from "react-dom/client";
import { useState } from "react";
import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { PersonalCenterPanel } from "../../../app/features/profile/PersonalCenterPanel";
import { useProfileActions } from "../../../app/features/profile/useProfileActions";
import "../../../app/styles/app.css";
function Fixture() {
  const [enabled, setEnabled] = useState(true);
  const profile = useProfileActions({ localMode: true, profileSamplingEnabled: enabled, onProfileSamplingChanged: setEnabled });
  return <FluentProvider theme={location.search.includes("dark") ? webDarkTheme : webLightTheme}>
    <main style={{ padding: 10, background: "var(--colorNeutralBackground1)", minHeight: "100vh", boxSizing: "border-box" }}>
      <PersonalCenterPanel academicProfile={profile.academicProfile} accountSession={null} profileMemory={profile.memory}
        organizationSummary={null} onLogout={() => undefined} onClearProfile={profile.openClearProfileConfirm}
        onOpenAcademicArchive={profile.openAcademicArchive} onToggleProfileSampling={profile.toggleProfileSampling}
        onUpdateAcademicProfile={profile.updateAcademicProfile} profileSamplingEnabled={enabled} profileTags={[]} readPaperCount={12} profileClearMessage={profile.profileClearMessage} />
    </main>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
