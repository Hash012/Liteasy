import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
export function blobHash(bytes) { return crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"); }
export function readControlSource(root, relative) {
  const file = fs.realpathSync(path.resolve(root, relative));
  if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw new Error(`Unsafe source: ${relative}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length > 5 * 1024 * 1024) throw new Error(`Source exceeds audit budget: ${relative}`);
  // A NUL inside a JavaScript string is valid source (workRepository separator).
  // Fatal UTF-8 decoding rejects binary files without dropping that real source file.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
