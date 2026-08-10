export type ExpressionFunctionName = "sin" | "cos" | "tan" | "exp" | "log" | "sqrt" | "abs";

export type ExpressionAstV1 =
  | { kind: "literal"; value: number }
  | { kind: "variable"; name: string }
  | { kind: "unary"; operator: "+" | "-"; argument: ExpressionAstV1 }
  | { kind: "binary"; operator: "+" | "-" | "*" | "/" | "^" | "<" | "<=" | ">" | ">=" | "==" | "!="; left: ExpressionAstV1; right: ExpressionAstV1 }
  | { kind: "function"; name: ExpressionFunctionName; args: ExpressionAstV1[] };

export type BoundedExpressionDiagnosticCode =
  | "expression_non_finite"
  | "expression_domain_invalid";

export type BoundedExpressionResult =
  | { status: "ok"; value: number }
  | { status: "non_finite"; diagnosticCode: BoundedExpressionDiagnosticCode };

export type BoundedExpressionParseOptions = {
  variables?: readonly string[];
  maxLength?: number;
  maxNodes?: number;
  maxDepth?: number;
};
