import { Button, Tooltip } from "@fluentui/react-components";
import { OpenRegular } from "@fluentui/react-icons";
type HtmlDemoPreviewProps = {
  description?: string;
  html: string;
  onOpenInTab?: () => void;
  title: string;
};

const maxPreviewBytes = 512 * 1024;
const blockedElements = [
  "base",
  "embed",
  "form",
  "iframe",
  "link",
  "object",
  "portal",
  "script",
  "template"
].join(",");

const sandboxedDocumentCsp = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'none'",
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
  "media-src data:",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "navigate-to 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

function sanitizeGeneratedDocument(source: string) {
  const inert = document.createElement("template");
  inert.innerHTML = source;
  inert.content.querySelectorAll(blockedElements).forEach((element) => element.remove());
  inert.content.querySelectorAll("meta").forEach((element) => element.remove());
  inert.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        new Set(["action", "formaction", "ping", "srcdoc", "target"]).has(name)
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "href" || name === "xlink:href") {
        if (element.tagName.toLowerCase() === "a" || !attribute.value.trim().startsWith("#")) {
          element.removeAttribute(attribute.name);
        }
        continue;
      }
      if (
        new Set(["poster", "src", "srcset"]).has(name) &&
        !attribute.value.trim().toLowerCase().startsWith("data:")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  const head = [...inert.content.querySelectorAll("style, title")]
    .map((element) => {
      const serialized = element.outerHTML;
      element.remove();
      return serialized;
    })
    .join("");
  return { body: inert.innerHTML, head };
}

export function buildSandboxedHtmlDocument(html: string) {
  const source = html.trim();
  const oversized = new TextEncoder().encode(source).byteLength > maxPreviewBytes;
  const sanitized = sanitizeGeneratedDocument(oversized
    ? "<main><p>HTML 预览内容过大，无法安全显示。</p></main>"
    : source);
  const injectedHead = [
    "<meta charset=\"utf-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `<meta http-equiv="Content-Security-Policy" content="${sandboxedDocumentCsp}" />`,
    "<style>",
    ":root { color-scheme: light; font-family: \"Segoe UI\", \"PingFang SC\", sans-serif; }",
    "body { margin: 0; background: #ffffff; color: #172b3a; }",
    "</style>"
  ].join("");
  return `<!DOCTYPE html><html lang="zh-CN"><head>${injectedHead}${sanitized.head}</head><body>${sanitized.body}</body></html>`;
}

export function HtmlDemoPreview({
  description,
  html,
  onOpenInTab,
  title
}: HtmlDemoPreviewProps) {
  return (
    <section className="html-demo-preview" aria-label={`HTML Demo：${title}`}>
      <div className="html-demo-preview__toolbar">
        <div className="html-demo-preview__meta">
          <strong>{title}</strong>
          <span>{description ?? "Agent 生成的动态示意会在隔离沙箱内预览。"}</span>
        </div>
        {onOpenInTab ? (
          <Tooltip content="在独立标签页打开 HTML Demo" relationship="label">
            <Button
              appearance="subtle"
              aria-label={`在独立标签页打开 HTML Demo：${title}`}
              icon={<OpenRegular />}
              onClick={onOpenInTab}
            />
          </Tooltip>
        ) : null}
      </div>
      <iframe
        className="html-demo-preview__frame"
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox=""
        srcDoc={buildSandboxedHtmlDocument(html)}
        title={title}
      />
    </section>
  );
}
