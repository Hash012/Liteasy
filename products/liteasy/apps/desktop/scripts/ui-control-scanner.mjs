// AST/template inventory adapted from Liteasy UI review v2 (c707d34) taskpack.
/** Read-only inventory. Uses the checkout's TypeScript; never installs packages or edits source. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import { blobHash } from './ui-control-source.mjs';
export function loadTypeScript(root, override) {
  const req=createRequire(path.join(root,'products/liteasy/apps/desktop/package.json'));
  try { return override ? createRequire(import.meta.url)(path.resolve(override)) : req('typescript'); }
  catch { throw new Error('TypeScript unavailable. Use the checkout’s existing npm ci environment, or --typescript /absolute/path/to/typescript.js. No package was installed.'); }
}
export function productOf(file) {
  if(file.startsWith('products/liteasy/apps/desktop/')) return 'desktop';
  if(file.startsWith('products/liteasy/apps/mobile/')) return 'mobile';
  if(file.startsWith('products/liteasy/apps/admin/')) return 'admin';
  if(file.startsWith('products/liteasy-connector/')) return 'connector';
  if(file.startsWith('products/intuecho/')) return 'intuecho';
  if(file.startsWith('products/marketing/')) return 'marketing';
  if(file.startsWith('development/')) return 'development';
  return 'other';
}
export function classification(file) {
  if(/(^|\/)(node_modules|dist|build|target|coverage|\.git|vendor|archive|docs|test-results|playwright-report|__snapshots__)(\/|$)/.test(file)) return 'excluded-non-runtime';
  if(/(^|\/)(tests?|fixtures?|test-data|__tests__)(\/|$)|\.(test|spec|node-test|stories|story)\./.test(file)) return 'excluded-test-fixture';
  if(!/\.(tsx?|jsx?|mjs|cjs|html|css|vue|svelte|astro)$/.test(file)) return 'excluded-extension';
  if(!/^(products|development|platform)\//.test(file)) return 'excluded-scope';
  if(/MarkdownContent\.tsx$|document-export\/.+(Template|template|Renderer|renderer)\./.test(file)) return 'content-renderer-review-not-blanket-replace';
  return productOf(file)==='development' ? 'development-review-separately' : 'runtime-ui-candidate';
}
function fingerprint(file,rule,symbol,anchor) {return crypto.createHash('sha256').update(JSON.stringify([file,rule,symbol,anchor])).digest('hex').slice(0,24);}
export function scanText(ts,file,text) {
  const findings=[], seen=new Set(), identities=new Map(), sourceHash=blobHash(Buffer.from(text));
  const kind=/\.tsx$/.test(file)?ts.ScriptKind.TSX:/\.jsx$/.test(file)?ts.ScriptKind.JSX:/\.(js|mjs|cjs)$/.test(file)?ts.ScriptKind.JS:ts.ScriptKind.TS;
  const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,kind);
  function report(rule,pos,end,symbol,anchor,confidence='ast') {
    const line=text.slice(0,pos).split('\n').length, endLine=line+(text.slice(pos,end).match(/\n/g)||[]).length;
    const key=[rule,pos].join(':');if(seen.has(key))return;seen.add(key);
    const identity=JSON.stringify([file,rule,symbol,anchor]); const occurrence=(identities.get(identity)??0)+1; identities.set(identity,occurrence);
    findings.push({fingerprint:fingerprint(file,rule,symbol+'#'+occurrence,anchor),occurrence,file,product:productOf(file),classification:classification(file),rule,line,endLine,symbol,anchor:anchor.slice(0,320),confidence,git_blob_sha1:sourceHash});
  }
  if(/\.(html|vue|svelte|astro|css)$/.test(file)) {
    const rx=/\.css$/.test(file)? /summary\s*(?:::marker|::?-webkit-details-marker)|content\s*:\s*["'][▶▼►▸▾]/g : /<(details|summary|select)\b/gi;
    for(const m of text.matchAll(rx)) report(file.endsWith('.css')?'marker-style-review':`template-${m[1].toLowerCase()}`,m.index,m.index+m[0].length,'<template>',m[0],'heuristic');
    return {findings,parseErrors:[]};
  }
  const imported=new Map(), namespaces=new Map();
  for(const st of sf.statements)if(ts.isImportDeclaration(st)&&ts.isStringLiteral(st.moduleSpecifier)) {
    const module=st.moduleSpecifier.text,b=st.importClause?.namedBindings;
    if(b&&ts.isNamedImports(b))for(const x of b.elements)imported.set(x.name.text,{name:x.propertyName?.text??x.name.text,module});
    if(b&&ts.isNamespaceImport(b))namespaces.set(b.name.text,module);
  }
  function visit(node,owner='<module>') {
    if(ts.isFunctionDeclaration(node)&&node.name)owner=node.name.text;
    if((ts.isArrowFunction(node)||ts.isFunctionExpression(node))&&node.parent&&ts.isVariableDeclaration(node.parent))owner=node.parent.name.getText(sf);
    if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)) {
      const tag=node.tagName.getText(sf),[ns,member]=tag.split('.');
      const info=member?{name:member,module:namespaces.get(ns)}:imported.get(tag);
      let rule;
      if(['details','summary','select'].includes(tag))rule=`native-${tag}`;
      else if(info?.name==='Select'&&info.module==='@fluentui/react-components')rule='fluent-select';
      else if(info?.name==='SourceDisclosure'&&info.module?.includes('productPrimitives'))rule='source-disclosure-wrapper';
      else if(['Select','SourceDisclosure'].includes(tag))rule='custom-control-review';
      if(rule){
        const label=node.attributes.properties.find(a=>ts.isJsxAttribute(a)&&['aria-label','label','summary'].includes(a.name.getText(sf)));
        // A tag-name anchor remains stable under whitespace edits; a literal label narrows repeated controls.
        const anchor=label?.initializer&&ts.isStringLiteral(label.initializer)?label.initializer.text:node.getText(sf).slice(0,220);
        report(rule,node.getStart(sf),node.end,owner,anchor);
      }
    }
    if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)) {
      const raw=node.getText(sf);
      for(const m of raw.matchAll(/<(details|summary|select)\b/gi))report(`embedded-${m[1].toLowerCase()}`,node.getStart(sf)+m.index,node.getStart(sf)+m.index+m[0].length,owner,m[0],'heuristic-string');
      if(/[▶▼►▸▾]/.test(raw))report('literal-triangle-review',node.getStart(sf),node.end,owner,raw.slice(0,200),'heuristic-string');
    }
    if(ts.isJsxText(node)&&/[▶▼►▸▾]/.test(node.getText(sf)))report('literal-triangle-review',node.getStart(sf),node.end,owner,node.getText(sf).trim(),'jsx-text');
    ts.forEachChild(node,n=>visit(n,owner));
  }
  visit(sf);
  return {findings,parseErrors:(sf.parseDiagnostics??[]).map(d=>({line:sf.getLineAndCharacterOfPosition(d.start??0).line+1,message:ts.flattenDiagnosticMessageText(d.messageText,' ')}))};
}
export function inventoryPaths(root,allowWalk=false,trackedOnly=false) {
  const args=['-C',root,'ls-files','-z','--cached',...(trackedOnly?[]:['--others','--exclude-standard'])];
  const run=spawnSync('git',args,{encoding:'utf8',timeout:15000,maxBuffer:16*1024*1024,windowsHide:true,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
  if(run.status===0)return {mode:trackedOnly?'git-tracked':'git-tracked-and-untracked',paths:[...new Set(run.stdout.split('\0').filter(Boolean))].sort()};
  if(!allowWalk)throw new Error('Not a Git checkout / git failed. Use --allow-walk explicitly for an exported source tree.');
  const all=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,e.name),rel=path.relative(root,full).split(path.sep).join('/');
    if(e.isSymbolicLink())continue;
    if(e.isDirectory()){if(!/(^|\/)(node_modules|\.git|dist|target|build|coverage|archive|docs|test-results|playwright-report)$/.test(rel))walk(full);}
    else if(e.isFile())all.push(rel);
  }}
  for(const p of ['products','development','platform'])if(fs.existsSync(path.join(root,p)))walk(path.join(root,p));
  return {mode:'explicit-export-tree-walk',paths:all.sort()};
}
