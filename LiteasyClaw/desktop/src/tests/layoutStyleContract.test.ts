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
  test("uses the same Chinese serif font stack as the course HTML reference", () => {
    const rootBlock = extractBlock(":root");

    expect(rootBlock).toContain(
      'font-family: "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", Georgia, serif;'
    );
    expect(css).toMatch(/button,\s*\ninput,\s*\ntextarea,\s*\nselect\s*\{[\s\S]*font:\s*inherit;/);
  });

  test("keeps the Windows workbench in a multi-column layout at the old responsive breakpoint", () => {
    const responsiveBlock = extractBlock("@media (max-width: 1080px)");

    expect(responsiveBlock).not.toMatch(/\.app-shell\s*\{[^}]*grid-template-columns:\s*1fr\s*;/);
    expect(responsiveBlock).not.toMatch(/\.pane\.left[\s\S]*grid-column:\s*1\s*;/);
  });
});
