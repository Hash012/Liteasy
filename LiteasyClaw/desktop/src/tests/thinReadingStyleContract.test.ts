import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "src/app/features/thin-reading/thinReading.css"),
  "utf8"
);

function block(selector: string) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("thin-reading style contract", () => {
  test("keeps evidence markers as compact superscripts rather than body-sized controls", () => {
    const superscript = block(".thin-reading__summary-sentence > sup");
    const marker = block(".thin-reading__summary-marker");

    expect(superscript).toMatch(/font-size:\s*\.52em;/);
    expect(superscript).toMatch(/top:\s*-\.48em;/);
    expect(superscript).toMatch(/line-height:\s*0;/);
    expect(marker).toMatch(/font-size:\s*inherit;/);
    expect(marker).toMatch(/padding:\s*0 1px;/);
    expect(marker).toMatch(/background:\s*transparent;/);
  });

  test("keeps prose readable and allows long technical terms to wrap", () => {
    const summary = block(".thin-reading__summary");

    expect(summary).toMatch(/font-size:\s*19px;/);
    expect(summary).toMatch(/line-height:\s*1\.92;/);
    expect(summary).toMatch(/overflow-wrap:\s*anywhere;/);
    expect(summary).toMatch(/user-select:\s*text;/);
  });
});
