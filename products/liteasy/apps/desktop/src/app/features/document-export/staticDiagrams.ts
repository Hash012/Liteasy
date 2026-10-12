import { stageDataUrl } from "../objects/objectAssets";
import { walkDocument, type ExportDocument, type DocumentNode } from "./documentExport.types";
/** Only a local, bounded diagram is rasterized; the report body remains semantic text. */
export async function compileStaticDiagrams(document: ExportDocument, signal?: AbortSignal) {
  const candidates: DocumentNode[] = [];
  walkDocument(document.nodes, node => { if (node.tag === "pre" && node.children?.some(child => Array.isArray(child.properties?.className) && child.properties.className.includes("language-mermaid"))) candidates.push(node); });
  for (const node of candidates) {
    signal?.throwIfAborted();
    const code = (node.children?.[0]?.children ?? []).map(child => child.value ?? "").join("");
    let phase = "input";
    try {
      if (code.length > 20000 || /%%\{|(?:https?:|file:|data:|url\s*\(|<|@\{|\bclick\b|\bclassDef\b|\blinkStyle\b)/i.test(code)) throw new Error("图表含未批准的样式或外部资源");
      if (typeof Image.prototype.decode !== "function") throw new Error("此宿主不支持静态图像解码");
      phase = "worker_loading";
      const token = crypto.randomUUID();
      const frame = globalThis.document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true"); frame.tabIndex = -1;
      frame.style.cssText = "position:absolute;left:-100000px;width:900px;height:600px;border:0";
      frame.sandbox.add("allow-scripts", "allow-same-origin");
      let svgSource: string;
      try {
        svgSource = await new Promise<string>((resolve, reject) => {
          const cleanup = () => { clearTimeout(timeout); window.removeEventListener("message", receive); signal?.removeEventListener("abort", abort); };
          const abort = () => { cleanup(); reject(signal?.reason ?? new Error("导出已取消")); };
          const receive = (event: MessageEvent) => {
            if (event.source !== frame.contentWindow || /^https?:/.test(location.origin) && event.origin !== location.origin || event.data?.token !== token) return;
            cleanup(); if (typeof event.data.svg === "string") resolve(event.data.svg); else reject(new Error("图表静态化失败"));
          };
          const timeout = setTimeout(() => { cleanup(); reject(new Error("图表静态化超时")); }, 15000);
          window.addEventListener("message", receive); signal?.addEventListener("abort", abort, { once: true });
          frame.onload = () => { frame.contentWindow?.postMessage({ token, code }, "*"); };
          frame.src = new URL(`document-export-diagram.html#${token}`, location.href).href;
          globalThis.document.body.append(frame);
        });
      } finally { frame.remove(); }
      phase = "svg_sanitization";
      const svg = new DOMParser().parseFromString(svgSource, "image/svg+xml").documentElement;
      if (svg.tagName !== "svg" || svg.querySelector("script,foreignObject,image,iframe,object")) throw new Error("图表包含非静态内容");
      for (const element of [svg, ...svg.querySelectorAll("*")]) for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name) || /href$/i.test(attribute.name) && attribute.value && !attribute.value.startsWith("#") || /(?:@import|url\s*\(\s*[^#])/i.test(attribute.value)) throw new Error("图表含外部引用");
      }
      for (const style of svg.querySelectorAll("style")) if (/@import|url\s*\(\s*[^#]/i.test(style.textContent ?? "")) throw new Error("图表含外部样式");
      const box = svg.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
      const width = Math.ceil(box?.[2] ?? 800), height = Math.ceil(box?.[3] ?? 600);
      if (!width || !height || width * height > 4_000_000) throw new Error("图表超过静态像素预算");
      svg.setAttribute("width", String(width)); svg.setAttribute("height", String(height));
      const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      phase = "image_decode";
      const image = new Image(); image.src = url;
      try {
        await image.decode(); signal?.throwIfAborted();
        phase = "rasterization";
        const canvas = globalThis.document.createElement("canvas"); canvas.width = width * 2; canvas.height = height * 2;
        const context = canvas.getContext("2d"); if (!context) throw new Error("无法生成静态图表");
        context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const staged = await stageDataUrl(canvas.toDataURL("image/png"));
        const bytes = Uint8Array.from(atob(staged.base64), char => char.charCodeAt(0)), path = `assets/${staged.sha256}.png`;
        if (!document.assets.some(asset => asset.path === path)) document.assets.push({ id: staged.sha256, sha256: staged.sha256, mediaType: "image/png", path, bytes, origin: "generated" });
        node.tag = "img"; node.children = []; node.properties = { src: path, alt: "Mermaid 图表（静态图；原始代码保留在来源）" };
      } finally { URL.revokeObjectURL(url); }
    } catch (error) {
      signal?.throwIfAborted();
      document.diagnostics.push({ code: "diagram_source_fallback", severity: "warning", nodeId: node.id, detailCode: phase, message: "图表无法安全静态化，保留完整图形源码；可用原生格式继续阅读。" });
    }
  }
}
