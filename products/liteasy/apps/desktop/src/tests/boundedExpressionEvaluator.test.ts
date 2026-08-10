import { describe, expect, test } from "vitest";
import { evaluateBoundedExpression } from "../app/features/visualization/math/boundedEvaluator";
import { parseBoundedExpression } from "../app/features/visualization/math/expressionParser";

describe("bounded expression parser and evaluator", () => {
  test("accepts allowlisted arithmetic and rejects executable syntax", () => {
    expect(parseBoundedExpression("sin(x) + x^2").kind).toBe("binary");
    expect(() => parseBoundedExpression("globalThis.alert(1)")).toThrow("expression_token_forbidden");
    expect(() => parseBoundedExpression("x".repeat(300))).toThrow("expression_limit_exceeded");
  });

  test("returns a bounded non-finite diagnostic at a pole", () => {
    const ast = parseBoundedExpression("1 / x");

    expect(evaluateBoundedExpression(ast, { x: 0 })).toMatchObject({ status: "non_finite" });
  });

  test("rejects unknown variables and excessive function arity", () => {
    expect(() => parseBoundedExpression("sin(y)", { variables: ["x"] })).toThrow("expression_variable_forbidden");
    expect(() => parseBoundedExpression("max(1, 2, 3)")).toThrow("expression_function_forbidden");
  });
});
