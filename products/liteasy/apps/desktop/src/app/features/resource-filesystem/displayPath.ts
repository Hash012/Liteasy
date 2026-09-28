/** Presentation/comparison only: retain original native paths when addressing existing files. */
export function displayPath(path: string): string {
  const forward = path.replace(/\\/g, "/");
  if (/^\/\/\?\/UNC\//i.test(forward)) {
    return path.includes("\\") ? `\\\\${path.slice(8)}` : `//${path.slice(8)}`;
  }
  if (/^\/\/\?\/[a-z]:\//i.test(forward)) return path.slice(4);
  return path;
}
