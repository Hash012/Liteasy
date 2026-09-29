import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { LocalMcpContext } from "../../../app/features/local-mcp/localMcpContext";
import { LocalMcpSettingsPanel } from "../../../app/features/local-mcp/LocalMcpSettingsPanel";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";
import "../../../app/features/settings/settingsPage.css";
Object.assign(globalThis, { isTauri: true });
const dark = location.search.includes("dark");
function Fixture() {
  const [policy, setPolicy] = useState({ enabled: false, writable: false });
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
    <LocalMcpContext.Provider value={{ info: { ...policy, executable: "D:\\Research Apps\\Liteasy.exe", connectionFile: "C:\\Users\\研究\\AppData\\Roaming\\com.liteasy.desktop\\local-mcp\\connection.json" },
      busy: false, error: "", configure: (enabled, writable) => setPolicy({ enabled, writable }) }}>
      <div className="settings-page" style={{ minHeight: "100vh", padding: 16, boxSizing: "border-box" }}><section className="settings-card" style={{ width: "100%", boxSizing: "border-box" }}>
        <header className="settings-card-header"><h2>本机 MCP · Codex</h2><p>将 Liteasy 研究资产接入自己的 AI 工作流。</p></header>
        <div className="settings-card-content"><LocalMcpSettingsPanel /></div>
      </section></div>
    </LocalMcpContext.Provider>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
