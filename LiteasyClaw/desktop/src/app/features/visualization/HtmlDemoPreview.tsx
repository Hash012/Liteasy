import { Button, Tooltip } from "@fluentui/react-components";
import { OpenRegular } from "@fluentui/react-icons";
type HtmlDemoPreviewProps = {
  description?: string;
  html: string;
  onOpenInTab?: () => void;
  title: string;
};

const sandboxedDocumentCsp = [
  "default-src data: blob: https: http:",
  "style-src 'unsafe-inline' data: https: http:",
  "script-src 'unsafe-inline' 'unsafe-eval' data: blob: https: http:",
  "img-src data: blob: https: http:",
  "font-src data: https: http:",
  "connect-src https: http:",
  "media-src data: blob: https: http:",
  "frame-src https: http:",
  "worker-src data: blob: https: http:",
  "object-src 'none'",
  "navigate-to 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

export function buildSandboxedHtmlDocument(html: string) {
  // TODO(security): before production release, restore a reviewed HTML policy and
  // resource/time limits. During product testing we keep scripts and resources so
  // animation failures are observable. The unique-origin iframe still cannot read
  // the host page, submit forms, open popups or navigate the top-level application.
  const injectedHead = [
    "<meta charset=\"utf-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `<meta http-equiv="Content-Security-Policy" content="${sandboxedDocumentCsp}" />`,
    "<style>",
    ":root { color-scheme: light; font-family: \"Segoe UI\", \"PingFang SC\", sans-serif; }",
    "body { margin: 0; background: #ffffff; color: #172b3a; }",
    "</style>"
  ].join("");
  const source = html.trim();
  if (/<html(?:\s|>)/i.test(source)) {
    const withHead = /<head(?:\s[^>]*)?>/i.test(source)
      ? source.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${injectedHead}`)
      : source.replace(/<html(?:\s[^>]*)?>/i, (root) => `${root}<head>${injectedHead}</head>`);
    return /^\s*<!doctype/i.test(withHead) ? withHead : `<!DOCTYPE html>${withHead}`;
  }
  return `<!DOCTYPE html><html lang="zh-CN"><head>${injectedHead}</head><body>${source}</body></html>`;
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
          <span>{description ?? "Agent 生成的交互式示意会在隔离沙箱内预览。"}</span>
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
        sandbox="allow-scripts"
        srcDoc={buildSandboxedHtmlDocument(html)}
        title={title}
      />
    </section>
  );
}
