import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/styles/app.css"), "utf8");

function extractBlock(startToken: string) {
  const start = css.indexOf(startToken);
  if (start === -1) {
    return "";
  }

  const openingBrace = css.indexOf("{", start);
  if (openingBrace === -1) {
    return "";
  }

  let depth = 0;
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    }

    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(start, index + 1);
      }
    }
  }

  return css.slice(start);
}

describe("layout style contract", () => {
  test("uses the Fluent-style Windows font stack", () => {
    const rootBlock = extractBlock(":root");

    expect(rootBlock).toContain(
      'font-family: "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;'
    );
    expect(css).toMatch(/button,\s*\ninput,\s*\ntextarea,\s*\nselect\s*\{[\s\S]*font:\s*inherit;/);
  });

  test("keeps the Windows workbench in a multi-column layout at the old responsive breakpoint", () => {
    const responsiveBlock = extractBlock("@media (max-width: 1080px)");

    expect(responsiveBlock).not.toMatch(/\.app-shell\s*\{[^}]*grid-template-columns:\s*1fr\s*;/);
    expect(responsiveBlock).not.toMatch(/\.pane\.left[\s\S]*grid-column:\s*1\s*;/);
  });

  test("keeps the PDF.js text layer aligned with the rendered canvas scale", () => {
    const textLayerBlock = extractBlock(".pdf-text-layer");

    expect(textLayerBlock).toContain("--text-scale-factor:");
    expect(css).toMatch(
      /\.pdf-text-layer\s+>\s+:not\(\.markedContent\)[\s\S]*font-size:\s*calc\(var\(--text-scale-factor\)\s*\*\s*var\(--font-height\)\)/
    );
    expect(css).toContain("scaleX(var(--scale-x, 1))");
  });

  test("stacks PDF annotation cards from the top without stretching available height", () => {
    const annotationListBlocks = css.match(/\.pdf-annotation-list\s*\{[^}]*\}/g) ?? [];

    expect(
      annotationListBlocks.some(
        (block) =>
          block.includes("align-content: start;") &&
          block.includes("grid-auto-rows: max-content;")
      )
    ).toBe(true);
  });

  test("renders generated themes through scoped CSS variables", () => {
    expect(css).toContain('--paper-0: var(--generated-paper-0);');
    expect(css).toContain('.app-frame.theme-generated[data-theme-scope~="reader"] .pane.center');
    expect(css).toContain('.app-frame.theme-generated[data-theme-scope~="tabs"] .dock-region-tab-row');

    const generatedButtonBlock = extractBlock(
      '.app-frame.theme-generated[data-theme-scope~="buttons"] button'
    );
    expect(generatedButtonBlock).toContain('background: var(--button-background);');
    expect(generatedButtonBlock).toContain('color: var(--button-color);');
    expect(generatedButtonBlock).toContain('font-weight: var(--button-font-weight);');
  });
});
