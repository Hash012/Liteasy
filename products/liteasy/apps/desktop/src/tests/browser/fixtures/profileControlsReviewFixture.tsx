import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Button } from "@fluentui/react-components";
import { ApplicationThemeProvider } from "../../../app/features/theme/ApplicationThemeProvider";
import { notifyAppearancePreference } from "../../../app/features/theme/appearancePreference";
import { AcademicProfileForm } from "../../../app/features/profile/AcademicProfileForm";
import { defaultAcademicProfile } from "../../../app/features/profile/profile.types";
import { ProfileMemoryPanel } from "../../../app/features/profile/ProfileMemoryPanel";
import { useProfileMemory } from "../../../app/features/profile/useProfileMemory";
import { OrganizationOverview } from "../../../app/features/organization/OrganizationOverview";
import { organizationUiSummary } from "../../fixtures/organizationUiFixtures";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";
import "../../../app/features/profile/personalCenter.css";
function Fixture() {
  const [view, setView] = useState("学术档案"), [saved, setSaved] = useState("");
  const memory = useProfileMemory({ scope: "ui-review-v2-synthetic", enabled: true });
  return <ApplicationThemeProvider><main className="profile-page" style={{ width: "min(100%, 520px)", padding: 8, boxSizing: "border-box" }}>
    <nav style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{["学术档案", "已记偏好", "组织"].map(label => <Button key={label} onClick={() => setView(label)}>{label}</Button>)}<Button onClick={() => notifyAppearancePreference("dark")}>深色</Button></nav>
    {view === "学术档案" ? <AcademicProfileForm academicProfile={defaultAcademicProfile} onSave={(profile) => setSaved(JSON.stringify(profile))} /> : view === "已记偏好" ? <ProfileMemoryPanel enabled memory={memory} /> : <OrganizationOverview summary={{ ...organizationUiSummary, sharedLibrary: { ...organizationUiSummary.sharedLibrary, status: "unavailable" }, accessSnapshot: undefined }} />}
    {saved ? <output hidden aria-label="已保存画像" style={{ overflowWrap: "anywhere" }}>{saved}</output> : null}
    {memory.notice ? <p role="status">{memory.notice}</p> : null}
  </main></ApplicationThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
