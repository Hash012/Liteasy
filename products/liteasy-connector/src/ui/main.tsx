import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Provider } from "./Navigation";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<Provider><App popup={location.pathname.endsWith("popup.html")} /></Provider>);
