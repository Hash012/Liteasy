/* Positive-allowlist DOM reconstruction. Parser HTML never enters live DOM.
 * An inert <template> parses it; each allowed node/attribute is created afresh.
 * No SVG, script, iframe, style, forms, event handlers, srcset, custom elements,
 * arbitrary CSS, or active raw HTML. Raw HTML is formatting only, not code. */
(() => {
  'use strict';
  const HTML=new Set('p br hr h1 h2 h3 h4 h5 h6 strong b em i s del ins u mark sub sup blockquote ul ol li pre code table thead tbody tfoot tr th td caption a img span div section dl dt dd details summary kbd samp var small abbr input'.split(' '));
  const MATH=new Set('math semantics annotation mi mn mo mrow mfrac msqrt mroot msub msup msubsup munder mover munderover mtable mtr mtd mtext mspace mstyle mpadded mphantom menclose mfenced mmultiscripts mprescripts none'.split(' '));
  const DROP=new Set('script style iframe object embed link meta base form button textarea select option template svg foreignobject annotation-xml audio video source canvas'.split(' '));
  function linkURL(raw) {
    if(!raw)return '';
    if(raw.startsWith('#'))return '#cgr-md-'+raw.slice(1).replace(/[^\w:.-]/g,'_');
    try {const u=new URL(raw);return ['https:','http:','mailto:'].includes(u.protocol)?u.href:'';}catch{return '';}
  }
  function imageURL(raw) {
    if(/^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(raw) && raw.length<400000)return raw;
    try{const u=new URL(raw);return u.protocol==='https:' && !u.username && !u.password ? u.href : '';}catch{return '';}
  }
  function safeFragment(html) {
    const inert=document.createElement('template'); inert.innerHTML=html;
    const result=document.createDocumentFragment(); let count=0;
    function add(node,parent,depth) {
      if(++count>50000 || depth>100)throw new Error('预览结构过大或嵌套过深；请拆分批注。');
      if(node.nodeType===Node.TEXT_NODE){parent.append(document.createTextNode(node.data));return;}
      if(node.nodeType!==Node.ELEMENT_NODE)return;
      const tag=node.localName.toLowerCase();if(DROP.has(tag))return;
      if(!HTML.has(tag)&&!MATH.has(tag)){for(const child of node.childNodes)add(child,parent,depth+1);return;}
      if(tag==='img'){
        const raw=node.getAttribute('src')||'', url=imageURL(raw),alt=node.getAttribute('alt')||'图片';
        if(!url){const warning=document.createElement('span');warning.className='image-placeholder';warning.textContent=`[图片：${alt}；仅支持 HTTPS 或内嵌位图]`;parent.append(warning);return;}
        const load=()=>{const image=document.createElement('img');image.alt=alt;image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';image.src=url;return image;};
        if(url.startsWith('data:')){parent.append(load());return;}
        const button=document.createElement('button');button.type='button';button.className='image-placeholder';
        button.textContent=`加载外部图片：${alt}`;button.title=new URL(url).host+'（点击后才会联网）';
        button.onclick=()=>button.replaceWith(load());parent.append(button);return;
      }
      let out;
      if(MATH.has(tag))out=document.createElementNS('http://www.w3.org/1998/Math/MathML',tag);else out=document.createElement(tag);
      if(tag==='input'){
        if(node.getAttribute('type')!=='checkbox')return;
        out.type='checkbox';out.disabled=true;out.checked=node.hasAttribute('checked');out.setAttribute('aria-label','Markdown 任务状态');
      }
      if(node.hasAttribute('id'))out.id='cgr-md-'+node.id.slice(0,120).replace(/[^\w:.-]/g,'_');
      const classes=(node.getAttribute('class')||'').split(/\s+/).filter(c=>/^(token|language-[a-z0-9_-]+|math-block|footnotes|task-list-item|contains-task-list|hljs[a-z-]*|comment|keyword|string|number|operator|punctuation|function|class-name|boolean|property|tag|attr-name|attr-value|builtin|constant|inserted|deleted|symbol|regex|important|namespace)$/.test(c));
      if(classes.length)out.className=classes.join(' ');
      if(node.hasAttribute('title'))out.setAttribute('title',node.getAttribute('title').slice(0,1000));
      if(tag==='a'){
        const href=linkURL(node.getAttribute('href'));if(href){out.setAttribute('href',href);if(!href.startsWith('#')){out.target='_blank';out.rel='noopener noreferrer';}}
      }
      for(const attr of ['start','colspan','rowspan'])if(node.hasAttribute(attr)&&/^-?\d{1,4}$/.test(node.getAttribute(attr)))out.setAttribute(attr,node.getAttribute(attr));
      if(node.hasAttribute('align')&&/^(left|center|right)$/.test(node.getAttribute('align')))out.setAttribute('align',node.getAttribute('align'));
      if(tag==='details'&&node.hasAttribute('open'))out.setAttribute('open','');
      if(MATH.has(tag))for(const attr of ['display','displaystyle','mathvariant','stretchy','fence','separator','symmetric','largeop','movablelimits','accent','accentunder','columnalign','rowalign','columnspacing','rowspacing','columnlines','rowlines','scriptlevel','width','height','depth','lspace','rspace','linethickness','voffset','notation','encoding']) {
        const value=node.getAttribute(attr);if(value!=null&&/^[a-zA-Z0-9 .,+%\-]{0,120}$/.test(value))out.setAttribute(attr,value);
      }
      parent.append(out);for(const child of node.childNodes)add(child,out,depth+1);
    }
    for(const node of inert.content.childNodes)add(node,result,0);
    return result;
  }
  class Preview {
    constructor(target){this.target=target;this.worker=null;this.serial=0;this.timer=0;this.pending=null;this.renders=0;}
    close(){clearTimeout(this.timer);if(this.worker)this.worker.terminate();this.worker=null;if(this.pending)this.pending.resolve(false);this.pending=null;}
    async render(markdown,{force=false}={}) {
      if(markdown.length>40000&&!force){this.close();this.target.textContent='这篇批注超过 40,000 字符。为避免频繁重排，请点击“刷新预览”手动渲染；正文仍会正常保存。';return false;}
      this.close();
      const id=++this.serial;
      if(!markdown.trim()){this.target.textContent='在上方写下你的理解、疑问或例子。这里会显示 Markdown 预览。';return true;}
      const worker=this.worker=new Worker(chrome.runtime.getURL('markdown-worker.js'));
      return new Promise((resolve,reject)=>{
        this.pending={resolve,reject};
        const fail=message=>{if(this.serial!==id)return;this.pending=null;this.close();this.target.textContent='预览未完成：'+message;reject(new Error(message));};
        this.timer=setTimeout(()=>fail('渲染超过 3 秒已停止。请缩短复杂公式或拆分批注。'),3000);
        worker.onerror=()=>fail('Markdown 工作线程未能启动。');
        worker.onmessage=({data})=>{
          if(data.id!==id)return;
          clearTimeout(this.timer);
          if(data.error){fail(data.error);return;}
          try{const fragment=safeFragment(data.html);this.target.replaceChildren(fragment);this.renders++;this.pending=null;worker.terminate();this.worker=null;resolve(true);}
          catch(e){fail(String(e.message||e));}
        };
        worker.postMessage({id,markdown});
      });
    }
  }
  globalThis.CGRMarkdown={Preview,safeFragment,linkURL,imageURL};
})();
