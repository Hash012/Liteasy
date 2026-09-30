import { readFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { root, upstream, translators, dist } from "./paths.mjs";

const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const artifacts = join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
// Zip through Python's standard library, including the complete pinned source tree.
const script = `
import pathlib,sys,zipfile,json,hashlib
root,upstream,translators,dist,artifacts,version=map(str,sys.argv[1:])
excluded={'.git','node_modules','.cache','artifacts','test-results','playwright-report','__pycache__'}
def add_tree(z,source,prefix,source_package=False):
 source=pathlib.Path(source)
 for p in sorted(source.rglob('*')):
  rel=p.relative_to(source)
  if '_metadata' in rel.parts:continue
  if source_package and any(part in excluded for part in rel.parts):continue
  if source_package and rel.parts[0] in {'build','dist'}:continue
  if source_package and (p.name in {'build.log','config.sh','.DS_Store'} or p.name.startswith('.env')):continue
  if p.is_dir() and not p.is_symlink() and not any(p.iterdir()):z.writestr(str(pathlib.Path(prefix)/rel)+'/',b'')
  if p.is_file() and not p.is_symlink():z.write(p,str(pathlib.Path(prefix)/rel))
with zipfile.ZipFile(pathlib.Path(artifacts)/('liteasy-connector-'+version+'-chromium.zip'),'w',zipfile.ZIP_DEFLATED) as z:
 add_tree(z,dist,'')
with zipfile.ZipFile(pathlib.Path(artifacts)/('liteasy-connector-'+version+'-source.zip'),'w',zipfile.ZIP_DEFLATED) as z:
 add_tree(z,root,'liteasy-connector',True)
 add_tree(z,upstream,'zotero-connectors',True)
 add_tree(z,translators,'zotero-translators',True)
 hashes={n.removeprefix('zotero-connectors/'):hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('zotero-connectors/') and not n.endswith('/')}
 lock=json.loads((pathlib.Path(root)/'upstream.lock.json').read_text())
 z.writestr('zotero-connectors/upstream-source.json',json.dumps({'commit':lock['commit'],'files':hashes},indent=2)+'\\n')
 hashes={n.removeprefix('zotero-translators/'):hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('zotero-translators/') and not n.endswith('/')}
 z.writestr('zotero-translators/upstream-source.json',json.dumps({'commit':lock['translators']['commit'],'files':hashes},indent=2)+'\\n')
`;
execFileSync("python3", ["-c", script, root, upstream, translators, dist, artifacts, version], { stdio: "inherit" });
for (const name of await readdir(artifacts)) console.log(join(artifacts, name));
