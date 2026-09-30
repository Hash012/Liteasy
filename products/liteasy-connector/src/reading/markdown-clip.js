/* On-demand DOM-to-Markdown clipboard adapter. Runs ONLY on an explicit drag /
 * add-to-whiteboard action. No host DOM rewrites or clipboard permission. */
(() => {
  'use strict';
  const MAX=262144;
  function escape(s){return s.replace(/([\\`*_[\]])/g,'\\$1');}
  function safeLink(raw){try{const u=new URL(raw,location.href);return ['https:','http:','mailto:'].includes(u.protocol)?u.href:'';}catch{return '';}}
  function markdown(fragment) {
    let count=0, chars=0;
    function visit(n,depth=0) {
      if(++count>25000||depth>80)throw new Error('内容太大，请选取较小片段拖入白板');
      if(n.nodeType===Node.TEXT_NODE){chars+=n.data.length;if(chars>MAX)throw new Error('拖入内容超过 262,144 字符，请拆分');return escape(n.data.replace(/\s+/g,' '));}
      if(n.nodeType!==Node.ELEMENT_NODE&&n.nodeType!==Node.DOCUMENT_FRAGMENT_NODE)return '';
      if(n.nodeType===Node.ELEMENT_NODE&&(n.matches('[data-cgr-owned],script,style,button,svg,iframe,input,nav')||n.getAttribute('aria-hidden')==='true'))return '';
      const tag=n.localName||'',children=()=>[...n.childNodes].map(c=>visit(c,depth+1)).join('');
      if(tag==='pre') {const raw=n.textContent;if(raw.length>MAX)throw new Error('代码块过长，请拆分');chars+=raw.length;if(chars>MAX)throw new Error('内容过长');const lang=(n.querySelector('code')?.className||'').match(/language-([\w+-]+)/)?.[1]||'';const fence='`'.repeat(Math.max(3,...(raw.match(/`+/g)||[]).map(x=>x.length+1)));return `\n\n${fence}${lang}\n${raw.replace(/\n$/,'')}\n${fence}\n\n`;}
      if(tag==='code'){const t=n.textContent,wrap='`'.repeat(Math.max(1,...(t.match(/`+/g)||[]).map(x=>x.length+1)));return `${wrap} ${t} ${wrap}`;}
      if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+children().trim()+'\n\n';
      if(['strong','b'].includes(tag))return '**'+children()+'**';
      if(['em','i'].includes(tag))return '*'+children()+'*';
      if(['s','del'].includes(tag))return '~~'+children()+'~~';
      if(tag==='br')return '  \n';if(tag==='hr')return '\n\n---\n\n';
      if(tag==='a'){const url=safeLink(n.getAttribute('href'));return url?'['+children().trim()+'](<'+url.replace(/>/g,'%3E')+'>)':children();}
      if(tag==='img'){const url=safeLink(n.getAttribute('src'));return url?'!['+escape(n.getAttribute('alt')||'图片')+'](<'+url.replace(/>/g,'%3E')+'>)':'';}
      if(tag==='blockquote')return '\n\n'+children().trim().split('\n').map(l=>'> '+l).join('\n')+'\n\n';
      if(tag==='ul'||tag==='ol')return '\n'+[...n.children].filter(c=>c.tagName==='LI').map((li,i)=>{const value=visit(li,depth+1).trim();return (tag==='ol'?((Number(n.getAttribute('start'))||1)+i)+'. ':'- ')+value.replace(/\n/g,'\n    ');}).join('\n')+'\n';
      if(tag==='table') {const rows=[...n.querySelectorAll('tr')].map(row=>[...row.children].filter(c=>['TD','TH'].includes(c.tagName)).map(c=>visit(c,depth+1).trim().replace(/\|/g,'\\|').replace(/\n/g,'<br>'))).filter(r=>r.length);if(!rows.length)return '';const width=Math.max(...rows.map(r=>r.length));const out=rows.map(r=>'| '+Array.from({length:width},(_,i)=>r[i]||'').join(' | ')+' |');out.splice(1,0,'| '+Array(width).fill('---').join(' | ')+' |');return '\n\n'+out.join('\n')+'\n\n';}
      if(tag==='math'){const tex=n.querySelector('annotation[encoding="application/x-tex"]')?.textContent;return tex?(n.getAttribute('display')==='block'?'\n$$\n'+tex+'\n$$\n':'$'+tex+'$'):n.textContent;}
      const value=children();return ['p','div','section','article','figure','details'].includes(tag)?'\n\n'+value.trim()+'\n\n':value;
    }
    const out=visit(fragment).replace(/\n{3,}/g,'\n\n').trim();if(out.length>MAX)throw new Error('拖入内容过长，请拆分');return out;
  }
  globalThis.CGRClip={markdown};
})();
