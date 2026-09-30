import { createRoot } from "react-dom/client";
import { Navigation, Provider } from "./Navigation";
import "./styles.css";

const host = document.createElement("div");
host.id = "connector-navigation";
document.body.prepend(host);
createRoot(host).render(<Provider><Navigation active={location.pathname.endsWith("options.html") ? "settings" : "notes"} /></Provider>);

if (location.pathname.endsWith("sidebar.html")) {
  const updateTitle = () => {
    const heading = document.querySelector(".topbar h1");
    if (heading?.firstChild) heading.firstChild.textContent = document.body.dataset.workspace === "whiteboard" ? "知识白板 " : "阅读批注 ";
  };
  const observer = new MutationObserver(updateTitle);
  observer.observe(document.body, { attributes: true, attributeFilter: ["data-workspace"] });
  updateTitle();
}
