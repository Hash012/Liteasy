import type { BoundedExpressionParseOptions, ExpressionAstV1, ExpressionFunctionName } from "./expressionAst";

type Token =
  | { kind: "number"; value: number }
  | { kind: "identifier"; value: string }
  | { kind: "operator"; value: "+" | "-" | "*" | "/" | "^" | "<" | "<=" | ">" | ">=" | "==" | "!=" }
  | { kind: "paren"; value: "(" | ")" }
  | { kind: "comma"; value: "," }
  | { kind: "end"; value: "" };

const allowedFunctions = new Set<ExpressionFunctionName>(["sin", "cos", "tan", "exp", "log", "sqrt", "abs"]);
const defaultLimits = {
  maxDepth: 32,
  maxLength: 256,
  maxNodes: 128
};

export function parseBoundedExpression(source: string, options: BoundedExpressionParseOptions = {}): ExpressionAstV1 {
  const limits = { ...defaultLimits, ...options };
  if (source.length > limits.maxLength) throw new Error("expression_limit_exceeded");

  const parser = new Parser(tokenize(source), options.variables ? new Set(options.variables) : null);
  const ast = parser.parse();
  enforceLimits(ast, limits.maxNodes, limits.maxDepth);
  return ast;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const start = index;
      if (char === "." && !/[0-9]/.test(source[index + 1] ?? "")) throw new Error("expression_token_forbidden");
      index += 1;
      while (/[0-9_]/.test(source[index] ?? "")) index += 1;
      if (source[index] === ".") {
        index += 1;
        while (/[0-9_]/.test(source[index] ?? "")) index += 1;
      }
      if ((source[index] ?? "").toLowerCase() === "e") {
        index += 1;
        if (source[index] === "+" || source[index] === "-") index += 1;
        if (!/[0-9]/.test(source[index] ?? "")) throw new Error("expression_token_forbidden");
        while (/[0-9_]/.test(source[index] ?? "")) index += 1;
      }
      const raw = source.slice(start, index).replaceAll("_", "");
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error("expression_token_forbidden");
      tokens.push({ kind: "number", value });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9_]/.test(source[index] ?? "")) index += 1;
      tokens.push({ kind: "identifier", value: source.slice(start, index) });
      continue;
    }

    const twoChar = source.slice(index, index + 2);
    if (twoChar === "<=" || twoChar === ">=" || twoChar === "==" || twoChar === "!=") {
      tokens.push({ kind: "operator", value: twoChar });
      index += 2;
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/" || char === "^" || char === "<" || char === ">") {
      tokens.push({ kind: "operator", value: char });
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ kind: "paren", value: char });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ kind: "comma", value: "," });
      index += 1;
      continue;
    }

    throw new Error("expression_token_forbidden");
  }

  tokens.push({ kind: "end", value: "" });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly variables: ReadonlySet<string> | null
  ) {}

  parse(): ExpressionAstV1 {
    const ast = this.parseComparison();
    if (this.peek().kind !== "end") throw new Error("expression_token_forbidden");
    return ast;
  }

  private parseComparison(): ExpressionAstV1 {
    let left = this.parseAdditive();
    while (this.isOperator("<", "<=", ">", ">=", "==", "!=")) {
      const operator = this.consume().value as "<" | "<=" | ">" | ">=" | "==" | "!=";
      left = { kind: "binary", operator, left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): ExpressionAstV1 {
    let left = this.parseMultiplicative();
    while (this.isOperator("+", "-")) {
      const operator = this.consume().value as "+" | "-";
      left = { kind: "binary", operator, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): ExpressionAstV1 {
    let left = this.parsePower();
    while (this.isOperator("*", "/")) {
      const operator = this.consume().value as "*" | "/";
      left = { kind: "binary", operator, left, right: this.parsePower() };
    }
    return left;
  }

  private parsePower(): ExpressionAstV1 {
    const left = this.parseUnary();
    if (!this.isOperator("^")) return left;
    this.consume();
    return { kind: "binary", operator: "^", left, right: this.parsePower() };
  }

  private parseUnary(): ExpressionAstV1 {
    if (this.isOperator("+", "-")) {
      const operator = this.consume().value as "+" | "-";
      return { kind: "unary", operator, argument: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionAstV1 {
    const token = this.consume();
    if (token.kind === "number") return { kind: "literal", value: token.value };

    if (token.kind === "identifier") {
      if (this.peek().kind === "paren" && this.peek().value === "(") return this.parseFunction(token.value);
      if (this.variables && !this.variables.has(token.value)) throw new Error("expression_variable_forbidden");
      return { kind: "variable", name: token.value };
    }

    if (token.kind === "paren" && token.value === "(") {
      const expression = this.parseComparison();
      const close = this.consume();
      if (close.kind !== "paren" || close.value !== ")") throw new Error("expression_token_forbidden");
      return expression;
    }

    throw new Error("expression_token_forbidden");
  }

  private parseFunction(name: string): ExpressionAstV1 {
    if (!isAllowedFunction(name)) throw new Error("expression_function_forbidden");
    this.consumeExpectedParen("(");
    const args: ExpressionAstV1[] = [];
    if (!(this.peek().kind === "paren" && this.peek().value === ")")) {
      args.push(this.parseComparison());
      while (this.peek().kind === "comma") {
        this.consume();
        args.push(this.parseComparison());
      }
    }
    this.consumeExpectedParen(")");
    if (args.length !== 1) throw new Error("expression_function_forbidden");
    return { kind: "function", name, args };
  }

  private consumeExpectedParen(value: "(" | ")"): void {
    const token = this.consume();
    if (token.kind !== "paren" || token.value !== value) throw new Error("expression_token_forbidden");
  }

  private isOperator(...values: Array<Extract<Token, { kind: "operator" }>["value"]>): boolean {
    const token = this.peek();
    return token.kind === "operator" && values.includes(token.value);
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { kind: "end", value: "" };
  }

  private consume(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }
}

function isAllowedFunction(name: string): name is ExpressionFunctionName {
  return allowedFunctions.has(name as ExpressionFunctionName);
}

function enforceLimits(ast: ExpressionAstV1, maxNodes: number, maxDepth: number): void {
  const walk = (node: ExpressionAstV1, depth: number): number => {
    if (depth > maxDepth) throw new Error("expression_limit_exceeded");
    if (node.kind === "literal" || node.kind === "variable") return 1;
    if (node.kind === "unary") return 1 + walk(node.argument, depth + 1);
    if (node.kind === "binary") return 1 + walk(node.left, depth + 1) + walk(node.right, depth + 1);
    return 1 + node.args.reduce((total, child) => total + walk(child, depth + 1), 0);
  };

  if (walk(ast, 1) > maxNodes) throw new Error("expression_limit_exceeded");
}
