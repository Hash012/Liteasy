#!/usr/bin/env node
import {
  parseCliArgs,
  renderMarkdownFileToPdf
} from "./md-to-pdf-lib.mjs";

function printHelp() {
  console.log(`Usage:
  node development/scripts/md-to-pdf.mjs <input.md> [--output <output.pdf>]

Examples:
  node development/scripts/md-to-pdf.mjs docs/engineering/agent-architecture-audit.md
  node development/scripts/md-to-pdf.mjs docs/audit.md -o out/audit.pdf

Mermaid diagrams are rendered to SVG before PDF export.
Required one-time setup:
  npm install --prefix development/tools/md-to-pdf --registry=https://registry.npmjs.org`);
}
try {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const outputPath = await renderMarkdownFileToPdf(args);
  console.log(`PDF written: ${outputPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
