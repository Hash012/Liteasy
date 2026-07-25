import { createToken, Lexer } from "chevrotain";

const WhiteSpace = createToken({ name: "WhiteSpace", pattern: /[ \t\r\n]+/, group: Lexer.SKIPPED });
const Comment = createToken({ name: "Comment", pattern: /\/\/[^\n]*/, group: Lexer.SKIPPED });
export const Graph = createToken({ name: "Graph", pattern: /Graph/ });
export const Node = createToken({ name: "Node", pattern: /Node/ });
export const To = createToken({ name: "To", pattern: /to/ });
export const BooleanLiteral = createToken({ name: "BooleanLiteral", pattern: /(?:true|false)/ });
export const NumberLiteral = createToken({ name: "NumberLiteral", pattern: /(?:0|[1-9]\d*)(?:\.\d+)?/ });
export const StringLiteral = createToken({ name: "StringLiteral", pattern: /"(?:\\["\\/bfnrt]|\\u[0-9a-fA-F]{4}|[^"\\\n])*"/ });
export const Identifier = createToken({ name: "Identifier", pattern: /[A-Za-z][A-Za-z0-9_-]*/ });
export const LCurly = createToken({ name: "LCurly", pattern: /\{/ });
export const RCurly = createToken({ name: "RCurly", pattern: /\}/ });
export const LSquare = createToken({ name: "LSquare", pattern: /\[/ });
export const RSquare = createToken({ name: "RSquare", pattern: /\]/ });
export const LParen = createToken({ name: "LParen", pattern: /\(/ });
export const RParen = createToken({ name: "RParen", pattern: /\)/ });
export const Comma = createToken({ name: "Comma", pattern: /,/ });
export const Equal = createToken({ name: "Equal", pattern: /=/ });
export const Colon = createToken({ name: "Colon", pattern: /:/ });

export const cglTokens = [
  WhiteSpace, Comment, Graph, Node, To, BooleanLiteral, NumberLiteral, StringLiteral, Identifier,
  LCurly, RCurly, LSquare, RSquare, LParen, RParen, Comma, Equal, Colon
];

export const cglLexer = new Lexer(cglTokens);

export type CglLexError = { line: number; column: number; message: string };

export function lexCgl(input: string): { tokens: ReturnType<typeof cglLexer.tokenize>["tokens"]; errors: CglLexError[] } {
  const result = cglLexer.tokenize(input);
  return {
    tokens: result.tokens,
    errors: result.errors.map((error) => ({
      column: error.column ?? 1,
      line: error.line ?? 1,
      message: error.message
    }))
  };
}
