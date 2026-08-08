import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, expect, test } from "vitest";

const style = document.createElement("style");
style.textContent = readFileSync(resolve(process.cwd(), "src/app/styles/app.css"), "utf8");
document.head.append(style);

afterAll(() => style.remove());

function allRules(rules: CSSRuleList): CSSRule[] {
  return Array.from(rules).flatMap((rule) => {
    const nested = (rule as CSSGroupingRule).cssRules;
    return nested ? [rule, ...allRules(nested)] : [rule];
  });
}

function styleRule(selector: string) {
  const sheet = style.sheet;
  if (!sheet) throw new Error("Association graph stylesheet was not parsed");
  return allRules(sheet.cssRules).find((rule): rule is CSSStyleRule =>
    "selectorText" in rule && rule.selectorText.split(",").map((part) => part.trim()).includes(selector));
}

test("limits pointer capture to interactive exact hit paths", () => {
  expect(styleRule(".association-layer__edges")?.style.getPropertyValue("pointer-events")).toBe("none");
  expect(styleRule(".association-edge.is-hit")?.style.getPropertyValue("pointer-events")).toBe("stroke");
});

test("uses graphite rather than author green for canonical registry nodes", () => {
  const canonical = styleRule('.association-node[data-basis="canonical_registry"]');
  const author = styleRule('.association-node[data-basis="author_citation"]');

  expect(canonical?.style.getPropertyValue("box-shadow")).toContain("98, 102, 106");
  expect(canonical?.style.getPropertyValue("box-shadow"))
    .not.toBe(author?.style.getPropertyValue("box-shadow"));
});

test("keeps collapsed canonical registry nodes graphite instead of generic blue", () => {
  const semanticDot = styleRule(".association-node.is-dot.is-semantic-retrieval");
  const authorDot = styleRule(".association-node.is-dot.is-author-citation");

  expect(semanticDot).toBeDefined();
  expect(authorDot).toBeDefined();
  expect(semanticDot!.style.getPropertyValue("background")).toContain("98, 102, 106");
  expect(semanticDot!.style.getPropertyValue("background"))
    .not.toBe(authorDot!.style.getPropertyValue("background"));
});

test("disables all recommendation graph transitions when reduced motion is requested", () => {
  const sheet = style.sheet;
  if (!sheet) throw new Error("Association graph stylesheet was not parsed");
  const reducedMotion = Array.from(sheet.cssRules).find((rule): rule is CSSMediaRule =>
    "conditionText" in rule && rule.conditionText === "(prefers-reduced-motion: reduce)");
  const reducedRules = reducedMotion ? allRules(reducedMotion.cssRules) : [];
  const transitionlessSelectors = reducedRules.flatMap((rule) =>
    "selectorText" in rule && rule.style.getPropertyValue("transition") === "none"
      ? rule.selectorText.split(",").map((part) => part.trim())
      : []);

  expect(transitionlessSelectors).toEqual(expect.arrayContaining([
    ".association-edge",
    ".association-anchor__mark",
    ".association-anchor__chip",
    ".association-node",
    ".association-node.is-dot > *"
  ]));
});
