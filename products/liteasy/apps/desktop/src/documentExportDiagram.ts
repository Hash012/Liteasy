import mermaid from "mermaid";
const token = location.hash.slice(1);
mermaid.initialize({ securityLevel: "strict", startOnLoad: false, maxTextSize: 20000, maxEdges: 500,
  fontFamily: '"Noto Sans CJK SC", "Microsoft YaHei", Arial, sans-serif',
  htmlLabels: false, flowchart: { htmlLabels: false }, theme: "neutral" });
let busy = false;
window.addEventListener("message", async event => {
  if (event.source !== parent || event.data?.token !== token || busy) return;
  const code = event.data?.code;
  if (typeof code !== "string" || code.length > 20000 || /%%\{|(?:https?:|file:|data:|url\s*\(|<|@\{|\bclick\b|\bclassDef\b|\blinkStyle\b)/i.test(code)) { parent.postMessage({ token, error: "图表输入超出静态安全范围" }, "*"); return; }
  busy = true;
  try {
    const result = await mermaid.render(`diagram-${crypto.randomUUID()}`, code);
    await document.fonts.ready;
    parent.postMessage({ token, svg: result.svg }, "*");
  } catch { parent.postMessage({ token, error: "图表无法安全静态化" }, "*"); }
  finally { busy = false; }
});
