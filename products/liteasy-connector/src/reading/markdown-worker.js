/* Loaded only by the side panel on first preview. No DOM, fetch, eval, or CDN.
 * Main thread terminates this worker if a render exceeds its time budget. */
'use strict';
importScripts('vendor/marked.js', 'vendor/prism.js');
const escapeHTML = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let footnotes, references, referenceCounts, mathCount, headingCount;
function math(tex, display) {
  if (++mathCount > 100 || tex.length > 4096) return `<code>${escapeHTML(tex)}</code>`;
  if (!self.katex) importScripts('vendor/katex.js');
  try {
    // Native MathML: no downloaded fonts, no HTML styles, no trusted TeX URLs.
    return katex.renderToString(tex, {displayMode:display, output:'mathml', trust:false,
      throwOnError:false, strict:'ignore', maxExpand:200, maxSize:10, macros:{}});
  } catch { return `<code>${escapeHTML(tex)}</code>`; }
}
marked.use({extensions:[
  {name:'noteDefinition', level:'block', start:s=>s.match(/^ {0,3}\[\^[^\]\n]+\]:/m)?.index,
    tokenizer(s) {
      const m=/^ {0,3}\[\^([^\]\n]+)\]:[ \t]*([^\n]*(?:\n(?:(?: {4}|\t)[^\n]*|(?=\n(?: {4}|\t))))*)\n*/.exec(s);
      if(!m)return;
      const key=m[1].trim(); if(!footnotes.has(key))footnotes.set(key,m[2].replace(/\n(?: {4}|\t)/g,'\n'));
      return {type:'noteDefinition',raw:m[0]};
    },renderer:()=>''},
  {name:'noteReference',level:'inline',start:s=>s.indexOf('[^'),
    tokenizer(s){const m=/^\[\^([^\]\n]+)\]/.exec(s);if(m)return{type:'noteReference',raw:m[0],key:m[1]};},
    renderer(t){
      if(!footnotes.has(t.key))return escapeHTML(t.raw);
      if(!references.includes(t.key))references.push(t.key);
      const index=references.indexOf(t.key)+1, occurrence=(referenceCounts.get(t.key)||0)+1;
      referenceCounts.set(t.key,occurrence);
      return `<sup id="fnref-${index}-${occurrence}"><a href="#fn-${index}" title="脚注 ${index}">${index}</a></sup>`;
    }},
  {name:'mathBlock',level:'block',start:s=>s.search(/^(?:\$\$|\\\[)/m),
    tokenizer(s){let m=/^\$\$[ \t]*\n?([\s\S]+?)\n?\$\$(?:[ \t]*(?:\n|$))/.exec(s);if(!m)m=/^\\\[\s*([\s\S]+?)\s*\\\](?:[ \t]*(?:\n|$))/.exec(s);if(m)return{type:'mathBlock',raw:m[0],text:m[1]};},
    renderer:t=>`<div class="math-block">${math(t.text,true)}</div>`},
  {name:'mathInline',level:'inline',start:s=>{const m=s.match(/\$(?!\s|\$)|\\\(/);return m?.index;},
    tokenizer(s){let m=/^\\\(([^\n]+?)\\\)/.exec(s);if(!m)m=/^\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/.exec(s);if(m)return{type:'mathInline',raw:m[0],text:m[1]};},
    renderer:t=>math(t.text,false)},
  {name:'definitionList',level:'block',start:s=>s.match(/^[^\n]+\n: /m)?.index,
    tokenizer(s){const m=/^([^\n]+)\n((?::[ \t]+[^\n]+(?:\n(?: {2,}|\t)[^\n]+)*\n?)+)(?:\n|$)/.exec(s);if(!m)return;return{type:'definitionList',raw:m[0],term:m[1],definitions:m[2].trimEnd().split(/\n(?=: )/).map(d=>d.replace(/^:[ \t]+/,'').replace(/\n {2,}/g,'\n'))};},
    renderer(t){return `<dl><dt>${marked.parseInline(t.term)}</dt>${t.definitions.map(d=>`<dd>${marked.parse(d)}</dd>`).join('')}</dl>`;}},
  ...[['highlight','==','mark'],['insert','++','ins']].map(([name,delim,tag])=>({name,level:'inline',start:s=>s.indexOf(delim),
    tokenizer(s){if(!s.startsWith(delim))return;const end=s.indexOf(delim,2);if(end<=2||s.slice(2,end).includes('\n'))return;return{type:name,raw:s.slice(0,end+2),text:s.slice(2,end)};},
    renderer:t=>`<${tag}>${marked.parseInline(t.text)}</${tag}>`}))
],renderer:{
  heading(text,level){return `<h${level} id="heading-${++headingCount}">${text}</h${level}>\n`;},
  code(code,language){
    const name=String(language||'').trim().split(/\s+/)[0].toLowerCase();
    let output=escapeHTML(code);
    if(Prism.languages[name] && code.length<50000){try{output=Prism.highlight(code,Prism.languages[name],name);}catch{}}
    return `<pre><code class="language-${escapeHTML(name.replace(/[^a-z0-9_-]/g,''))}">${output}</code></pre>\n`;
  }
}});
self.onmessage = ({data}) => {
  const {id,markdown} = data;
  if(typeof markdown!=='string' || markdown.length>262144){postMessage({id,error:'批注过长，预览上限为 262,144 字符。'});return;}
  footnotes=new Map(); references=[];referenceCounts=new Map();mathCount=0;headingCount=0;
  try {
    let html=marked.parse(markdown,{gfm:true,breaks:false,headerIds:false,mangle:false});
    if(references.length){
      html+='<hr><section class="footnotes"><h4>脚注</h4><ol>';
      for(let i=0;i<references.length && i<200;i++){
        const key=references[i];
        html+=`<li id="fn-${i+1}">${marked.parse(footnotes.get(key)||'')} <a href="#fnref-${i+1}-1" title="返回正文">↩</a></li>`;
      }
      html+='</ol></section>';
    }
    if(html.length>4000000)throw new Error('渲染结果过大，请将批注拆分为几篇。');
    postMessage({id,html});
  } catch(error) {postMessage({id,error:String(error.message||error)});}
};
