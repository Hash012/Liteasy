import type { BoundedExpressionResult, ExpressionAstV1 } from "./expressionAst";

type EvaluationOptions = {
  precision?: "double" | "single";
};

export function evaluateBoundedExpression(
  ast: ExpressionAstV1,
  variables: Readonly<Record<string, number>>,
  options: EvaluationOptions = {}
): BoundedExpressionResult {
  try {
    const value = evaluate(ast, variables);
    if (!Number.isFinite(value)) return { status: "non_finite", diagnosticCode: "expression_non_finite" };
    return { status: "ok", value: options.precision === "single" ? Math.fround(value) : value };
  } catch {
    return { status: "non_finite", diagnosticCode: "expression_domain_invalid" };
  }
}

function evaluate(ast: ExpressionAstV1, variables: Readonly<Record<string, number>>): number {
  if (ast.kind === "literal") return ast.value;
  if (ast.kind === "variable") {
    const value = variables[ast.name];
    if (!Number.isFinite(value)) throw new Error("expression_domain_invalid");
    return value;
  }
  if (ast.kind === "unary") {
    const value = evaluate(ast.argument, variables);
    return ast.operator === "-" ? -value : value;
  }
  if (ast.kind === "function") {
    const value = evaluate(ast.args[0], variables);
    if (ast.name === "sin") return Math.sin(value);
    if (ast.name === "cos") return Math.cos(value);
    if (ast.name === "tan") return Math.tan(value);
    if (ast.name === "exp") return Math.exp(value);
    if (ast.name === "log") return value > 0 ? Math.log(value) : Number.NaN;
    if (ast.name === "sqrt") return value >= 0 ? Math.sqrt(value) : Number.NaN;
    return Math.abs(value);
  }

  const left = evaluate(ast.left, variables);
  const right = evaluate(ast.right, variables);
  if (ast.operator === "+") return left + right;
  if (ast.operator === "-") return left - right;
  if (ast.operator === "*") return left * right;
  if (ast.operator === "/") return left / right;
  if (ast.operator === "^") return Math.pow(left, right);
  if (ast.operator === "<") return left < right ? 1 : 0;
  if (ast.operator === "<=") return left <= right ? 1 : 0;
  if (ast.operator === ">") return left > right ? 1 : 0;
  if (ast.operator === ">=") return left >= right ? 1 : 0;
  if (ast.operator === "==") return left === right ? 1 : 0;
  return left !== right ? 1 : 0;
}
