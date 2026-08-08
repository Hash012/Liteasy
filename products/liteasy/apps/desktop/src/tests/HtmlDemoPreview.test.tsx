import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  buildSandboxedHtmlDocument,
  HtmlDemoPreview
} from "../app/features/visualization/HtmlDemoPreview";

describe("HtmlDemoPreview", () => {
  test("buildSandboxedHtmlDocument injects a strict CSP and wraps raw html", () => {
    const documentHtml = buildSandboxedHtmlDocument("<main><h1>Demo</h1></main>");

    expect(documentHtml).toContain("<!DOCTYPE html>");
    expect(documentHtml).toContain("Content-Security-Policy");
    expect(documentHtml).toContain("default-src 'none'; style-src 'unsafe-inline'; script-src 'none'");
    expect(documentHtml).toContain("connect-src 'none'; media-src data:; frame-src 'none'; worker-src 'none'");
    expect(documentHtml).toContain("object-src 'none'; navigate-to 'none'; base-uri 'none'; form-action 'none'");
    expect(documentHtml).toContain("<main><h1>Demo</h1></main>");
  });

  test("keeps CSS animation markup but removes executable and navigable content", () => {
    const markup = [
      "<style>.step{animation:pulse 1s infinite}</style>",
      "<script>document.body.dataset.ready='yes'</script>",
      "<button onclick='this.textContent=\"next\"'>步骤</button>",
      "<a href='https://attacker.example/leak'>外部链接</a>",
      "<img src='https://attacker.example/pixel.png'>",
      "<img srcset='https://attacker.example/large.png 2x'>",
      "<form action='https://attacker.example'><input name='secret'></form>",
      "<template shadowrootmode='open'><a href='https://attacker.example/shadow'>影子链接</a></template>"
    ].join("");
    const documentHtml = buildSandboxedHtmlDocument(markup);

    expect(documentHtml).toContain("animation:pulse 1s infinite");
    expect(documentHtml).not.toContain("<script");
    expect(documentHtml).not.toContain("onclick");
    expect(documentHtml).not.toContain("attacker.example");
    expect(documentHtml).not.toContain("<form");
    expect(documentHtml).toContain("connect-src 'none'");
    expect(documentHtml).toContain("navigate-to 'none'");
  });

  test("injects the preview head into a complete generated HTML document without nesting html elements", () => {
    const documentHtml = buildSandboxedHtmlDocument(
      "<!doctype html><html><head><title>Demo</title></head><body><main>动画</main></body></html>"
    );

    expect(documentHtml.match(/<html/gi)).toHaveLength(1);
    expect(documentHtml).toContain("<head><meta charset=\"utf-8\"");
    expect(documentHtml).toContain("<title>Demo</title>");
    expect(documentHtml).toContain("<main>动画</main>");
  });

  test("renders iframe previews with sandbox and optional open action", () => {
    const onOpenInTab = vi.fn();

    render(
      <HtmlDemoPreview
        description="把算法步骤做成可交互动画。"
        html="<div id='demo'>hello</div>"
        onOpenInTab={onOpenInTab}
        title="算法动画 Demo"
      />
    );

    expect(screen.getByText("把算法步骤做成可交互动画。")).toBeInTheDocument();
    const iframe = screen.getByTitle("算法动画 Demo");
    expect(iframe).toHaveAttribute("sandbox", "");
    expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(iframe).toHaveAttribute("loading", "lazy");
    expect(iframe).toHaveAttribute("srcdoc", expect.stringContaining('<div id="demo">hello</div>'));
    expect(iframe).toHaveAttribute("srcdoc", expect.stringContaining("default-src 'none'"));

    fireEvent.click(screen.getByRole("button", { name: "在独立标签页打开 HTML Demo：算法动画 Demo" }));
    expect(onOpenInTab).toHaveBeenCalledTimes(1);
  });

  test("omits the open button when no callback is provided", () => {
    render(<HtmlDemoPreview html="<section>demo</section>" title="结构示意" />);

    expect(screen.queryByRole("button", { name: "在独立标签页打开 HTML Demo：结构示意" })).not.toBeInTheDocument();
    expect(screen.getByText("Agent 生成的动态示意会在隔离沙箱内预览。")).toBeInTheDocument();
  });

  test("replaces oversized generated documents before parsing", () => {
    const documentHtml = buildSandboxedHtmlDocument(`<main>${"x".repeat(512 * 1024)}</main>`);

    expect(documentHtml).toContain("HTML 预览内容过大，无法安全显示。");
    expect(documentHtml).not.toContain("x".repeat(1024));
  });
});
