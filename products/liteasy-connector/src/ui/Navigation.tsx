import { useEffect, useState } from "react";
import { Button, FluentProvider, Tooltip, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { Library20Regular, Note20Regular, Whiteboard20Regular, Settings20Regular, Open20Regular } from "@fluentui/react-icons";

export function Provider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>{children}</FluentProvider>;
}

export function Navigation({ active = "library", tabId }: { active?: string; tabId?: number }) {
  const [workspace, setWorkspace] = useState(active);
  useEffect(() => {
    const observer = new MutationObserver(() => setWorkspace(document.body.dataset.workspace === "whiteboard" ? "whiteboard" : active));
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-workspace"] });
    return () => observer.disconnect();
  }, [active]);
  const navigate = async (page: string, mode?: string) => {
    if (page === "sidebar.html" && location.pathname.endsWith("sidebar.html")) {
      document.getElementById(mode === "whiteboard" ? "app-whiteboard" : "app-notes")?.click();
      return;
    }
    const query = new URLSearchParams();
    const target = tabId ?? (Number(new URLSearchParams(location.search).get("tabId")) || undefined);
    if (target) query.set("tabId", String(target));
    if (mode) query.set("mode", mode);
    location.href = chrome.runtime.getURL(page) + "?" + query;
  };
  const items = [
    { key: "library", title: "文献库", icon: <Library20Regular />, run: () => navigate("panel.html") },
    { key: "notes", title: "阅读批注", icon: <Note20Regular />, run: () => navigate("sidebar.html") },
    { key: "whiteboard", title: "知识白板", icon: <Whiteboard20Regular />, run: () => navigate("sidebar.html", "whiteboard") },
    { key: "settings", title: "设置与备份", icon: <Settings20Regular />, run: () => navigate("options.html") }
  ];
  return <nav className="activity-rail" aria-label="Liteasy 工作区">
    <img src="liteasy.svg" className="brand-mark" alt="Liteasy" />
    {items.map(item => <Tooltip key={item.key} content={item.title} relationship="label" positioning="after">
      <Button appearance="subtle" icon={item.icon} aria-label={item.title} aria-current={workspace === item.key ? "page" : undefined} onClick={item.run} />
    </Tooltip>)}
    <div className="rail-spacer" />
    <Tooltip content="在完整标签页打开" relationship="label" positioning="after">
      <Button appearance="subtle" icon={<Open20Regular />} aria-label="在完整标签页打开" onClick={() => void chrome.tabs.create({ url: location.href })} />
    </Tooltip>
  </nav>;
}
