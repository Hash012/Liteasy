#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src/app/features/help/manual');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const ids = new Set();
const topics = new Set(manifest.topics.map(t => t.id));
if (topics.size !== manifest.topics.length) throw new Error('Duplicate topic IDs');
for (const entry of manifest.articles) {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(entry.id) || ids.has(entry.id)) throw new Error(`Invalid/duplicate article: ${entry.id}`);
  ids.add(entry.id);
  if (!topics.has(entry.topicId)) throw new Error(`Unknown topic: ${entry.id}`);
  if (entry.file !== `content/${entry.id}.md`) throw new Error(`Unsafe or noncanonical path: ${entry.file}`);
  if (!fs.existsSync(path.join(dir, entry.file))) throw new Error(`Missing Markdown: ${entry.file}`);
}
for (const entry of manifest.articles) if (entry.related.some(id => !ids.has(id))) throw new Error(`Broken related link: ${entry.id}`);
const out = [
  '// Generated from manifest.json + content/*.md. Run: node scripts/generate-manual-catalog.mjs',
  'import type { ManualRecord } from "./manualProvider";',
  'import type { HelpTopic } from "../help.types";',
  ...manifest.articles.map((entry, i) => `import body${i} from ${JSON.stringify('./' + entry.file + '?raw')};`),
  '',
  `export const manualContentVersion = ${JSON.stringify(manifest.contentVersion)};`,
  `export const manualBaseline = ${JSON.stringify(manifest.baseline)};`,
  `export const manualTopics = ${JSON.stringify(manifest.topics, null, 2)} as const satisfies readonly HelpTopic[];`,
  'export const manualArticles = [',
  ...manifest.articles.map((entry, i) => {
    const record = Object.fromEntries(['id', 'topicId', 'title', 'summary', 'keywords', 'condition', 'order', 'related', 'sourceIds', 'kind'].map(k => [k, entry[k]]));
    return `  { ...${JSON.stringify(record)}, body: body${i} },`;
  }),
  '] as const satisfies readonly ManualRecord[];', ''
].join('\n');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(path.join(dir, 'manualCatalog.ts'), 'utf8') !== out) throw new Error('Manual catalog drift: run node scripts/generate-manual-catalog.mjs');
} else fs.writeFileSync(path.join(dir, 'manualCatalog.ts'), out);
console.log(`Generated ${manifest.articles.length} Markdown imports and ${manifest.topics.length} topics.`);
