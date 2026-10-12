import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider, webDarkTheme, webLightTheme, useRestoreFocusTarget } from "@fluentui/react-components";
import CitationGraphDialog from "../../../app/features/citation-graph/CitationGraphDialog";
import { createCitationGraphClient } from "../../../app/features/citation-graph/citationGraphClient";
import { ContextAssetBrowser } from "../../../app/features/assistant/ContextAssetBrowser";
import "../../../app/styles/app.css";
const dark = new URLSearchParams(location.search).get("theme") === "dark";
function picture(color: string) {
  const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
  const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#e8edf4"; ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = color; [100, 180, 260].forEach((height, i) => ctx.fillRect(80 + 150 * i, 310 - height, 80, height));
  return canvas.toDataURL("image/png");
}
const suggestions = ["实验结果图", "模型结构图", "向量插图"].map((label, i) => {
  const preview = { text: "图片内容", images: [{ url: i === 2 ? "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#eef1f5"/><circle cx="300" cy="200" r="150" fill="#d17820"/></svg>') : picture(i ? "#178d72" : "#446ecb"), label }] };
  return { id: String(i), trigger: "@" as const, category: "图片", label,
    token: { id: String(i), kind: "object" as const, label, prompt: "" }, loadThumbnail: async () => preview, loadPreview: async () => preview };
});
const papers = [{ id: "local1", title: "Cicada: An In-Memory Transactional Database", doi: "10.1234/1" },
  { id: "local2", title: "Efficient Concurrency Control for Modern Databases", doi: "10.1234/2" }];
function Fixture() {
  const restoreFocus = useRestoreFocusTarget();
  const [open, setOpen] = useState<"images" | "graph">(); const [message, setMessage] = useState("");
  const client = useMemo(() => createCitationGraphClient(), []);
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme} style={{ minHeight: "100vh" }}>
    <Button {...restoreFocus} onClick={() => setOpen("images")}>添加图片上下文</Button><Button {...restoreFocus} onClick={() => setOpen("graph")}>打开文献引用图</Button><output>{message}</output>
    {open === "images" ? <ContextAssetBrowser suggestions={suggestions} onClose={() => setOpen(undefined)} onAddContextToken={(token) => setMessage(`添加：${token.label}`)} /> : null}
    {open === "graph" ? <CitationGraphDialog papers={papers} client={client} onClose={() => setOpen(undefined)}
      onOpenPaper={(id) => setMessage(`打开：${id}`)} onOpenRecommendation={(item) => setMessage(`发现：${item.title}`)} /> : null}
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
