/* Lightweight SVG/DOM Whiteboard. One board body in memory, viewport-only cards,
 * bounded undo, one Markdown worker, no mousemove storage or per-card observer.
 * Canvas serialization is separate from local source anchors and viewport state. */
(() => {
  'use strict';
  const C=CGRCanvas,B=CGRSidebarBridge,$=id=>document.getElementById(id);
  const rpc=B.rpc,clone=structuredClone,uuid=C.uuid;
  const COLORS={'1':'#df6464','2':'#d68a42','3':'#c5aa43','4':'#52a378','5':'#56a9b8','6':'#a37aca'};
  const MAX_DOM=160, MAX_PREVIEW=12000, MAX_HISTORY=30, HISTORY_BYTES=8*1024*1024, PREVIEW_BYTES=4*1024*1024;
  const stage=$('wb-stage'),world=$('wb-world'),nodesLayer=$('wb-nodes'),edgesLayer=$('wb-edges');
  let enabled=false,ready=false,opening=null,current=null,selected=new Set(),selectedEdge='',connectFrom=null,connectMode=false;
  let view={x:40,y:40,z:1},gesture=null,space=false,frame=0,viewTimer=0,dirty=false,saving=null,attempt=null,conflicted=false,saveError='';
  let editVersion=0,durableVersion=-1,draftId=uuid(),history=[],redo=[],historySize=0,rendered=new Map(),boardCursor=null,boards=new Map();
  let modal=null,modalPreview=new CGRMarkdown.Preview($('wb-card-preview'));
  let noteCursor=null,noteNext=null,notePages=[],noteSerial=0,noteTimer=0,contextNonce='',busyImport=false,loadGeneration=0;
  const params=new URLSearchParams(location.search),explicitBoard=params.get('board');
  const viewKey=id=>'cgr5:viewport:'+id;
  const status=(text,error=false)=>{$('wb-save-status').textContent=text;$('wb-save-status').title=text;$('wb-save-status').classList.toggle('error',error);};
  const error=e=>{status(String(e?.message||e),true);B.notice(String(e?.message||e),true);};
  const safeEvent=fn=>(...args)=>{try{Promise.resolve(fn(...args)).catch(error);}catch(e){error(e);}};
  const getNode=id=>current?.canvas.nodes.find(n=>n.id===id);
  const getEdge=id=>current?.canvas.edges.find(e=>e.id===id);
  const boardSnapshot=()=>({canvas:clone(current.canvas),sources:clone(current.sources)});
  const snapshotSize=s=>new TextEncoder().encode(JSON.stringify(s)).length;
  const editable=()=>!!current&&!current.deleted;
  const isInput=target=>!!target?.closest('textarea,input,select,[contenteditable=true]');
  function setWorkspaceUI(on) {
    document.body.dataset.workspace=on?'whiteboard':'notes';
    $('wb-workspace').hidden=!on;
    document.querySelector('main.workspace').hidden=on;
    document.querySelector('.main-actions').hidden=on;
    if(on)$('export-tools').hidden=true;
    $('app-whiteboard').setAttribute('aria-selected',String(on));$('app-notes').setAttribute('aria-selected',String(!on));
  }

  // A shared worker is reused across visible card previews; no worker per card.
  // Completed HTML is kept in a bounded LRU and re-sanitized at mount. Moving a
  // card changes only CSS coordinates, never re-parses its Markdown.
  class CardRenderer {
    constructor(){this.queue=new Map();this.cache=new Map();this.cacheBytes=0;this.worker=null;this.active=null;this.serial=0;this.timer=0;this.renders=0;}
    close(){clearTimeout(this.timer);if(this.worker)this.worker.terminate();this.worker=null;this.active=null;this.queue.clear();}
    clearCache(){this.cache.clear();this.cacheBytes=0;}
    remember(key,html){
      const size=new TextEncoder().encode(html).length;
      if(this.cache.has(key)){this.cacheBytes-=this.cache.get(key).size;this.cache.delete(key);}
      if(size>PREVIEW_BYTES)return;
      this.cache.set(key,{html,size});this.cacheBytes+=size;
      while(this.cache.size>64||this.cacheBytes>PREVIEW_BYTES){const k=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(k).size;this.cache.delete(k);}
    }
    forget(id){this.queue.delete(id);}
    request(n,body) {
      const text=n.text.slice(0,MAX_PREVIEW),key=CGRCore.hash(text);
      body.dataset.renderKey=key;
      const cached=this.cache.get(key);
      if(cached!==undefined){this.cache.delete(key);this.cache.set(key,cached);this.fill(body,cached.html,n.text.length>MAX_PREVIEW);return;}
      body.textContent=text.slice(0,1200)||'双击编辑 Markdown 卡片';body.classList.add('loading');
      this.queue.set(n.id,{key,text,body,long:n.text.length>MAX_PREVIEW});this.pump();
    }
    fill(body,html,long) {
      if(!body.isConnected)return;
      try{
        const fragment=CGRMarkdown.safeFragment(html);
        // Each card owns its footnotes/heading IDs; repeated Markdown must not
        // introduce duplicate document IDs or route footnote clicks elsewhere.
        const prefix='wb-'+body.closest('[data-node-id]').dataset.nodeId+'-';
        for(const el of fragment.querySelectorAll('[id]'))el.id=prefix+el.id;
        for(const el of fragment.querySelectorAll('a[href^="#"]'))el.setAttribute('href','#'+prefix+el.getAttribute('href').slice(1));
        body.replaceChildren(fragment);body.classList.remove('loading');
        if(long){const p=document.createElement('p');p.className='muted';p.textContent='仅预览前 12,000 字符；双击编辑 / 导出可获取完整正文。';body.append(p);}
      }catch(e){body.textContent='预览失败；正文仍可编辑和导出。'+String(e.message||e);}
    }
    pump() {
      if(!enabled||document.hidden||modal||this.active||!this.queue.size)return;
      const [id,job]=this.queue.entries().next().value;this.queue.delete(id);
      if(!job.body.isConnected||job.body.dataset.renderKey!==job.key){this.pump();return;}
      if(!this.worker){
        this.worker=new Worker(chrome.runtime.getURL('markdown-worker.js'));
        this.worker.onmessage=({data})=>{
          const a=this.active;if(!a||a.serial!==data.id)return;
          clearTimeout(this.timer);this.active=null;
          if(!data.error){this.remember(a.key,data.html);this.renders++;if(a.body.dataset.renderKey===a.key)this.fill(a.body,data.html,a.long);}
          else if(a.body.isConnected)a.body.textContent='预览失败：'+data.error+'（双击仍可编辑）';
          this.pump();
        };
        this.worker.onerror=()=>this.fail('渲染工作线程未能运行');
      }
      this.active={...job,serial:++this.serial};this.timer=setTimeout(()=>this.fail('复杂卡片预览超过 3 秒，已停止'),3000);
      this.worker.postMessage({id:this.active.serial,markdown:job.text});
    }
    fail(message){const a=this.active;if(a?.body.isConnected)a.body.textContent=message+'；双击编辑或导出原文。';clearTimeout(this.timer);this.worker?.terminate();this.worker=null;this.active=null;this.pump();}
  }
  const renderer=new CardRenderer();
  function invalidateCards(){renderer.close();renderer.clearCache();rendered.clear();renderedEdges.clear();nodesLayer.replaceChildren();edgesLayer.replaceChildren();}

  // CAS save: edits made while a request is in flight remain dirty. Retry an
  // ambiguous response with exactly the same op ID before sending newer edits.
  async function performSave() {
    if(!current||(!dirty&&!attempt))return true;
    try {
      if(!attempt)attempt={type:'CGR_BOARD_SAVE',board:clone(current),expectedRevision:current.revision||'',op:uuid(),draftId,localVersion:editVersion};
      const a=attempt;
      status(conflicted?'正在保留冲突草稿…':'正在写入白板…');
      const result=await rpc(a);
      durableVersion=a.localVersion;
      if(current?.id!==a.board.id)return false;
      if(result.conflict){attempt=null;conflicted=true;$('wb-conflict').hidden=false;status(editVersion===a.localVersion?'版本冲突 · 当前提交已保留恢复草稿':'版本冲突 · 后续修改尚未保存，请重试',true);return false;}
      attempt=null;saveError='';conflicted=false;$('wb-conflict').hidden=true;
      current.revision=result.board.revision;current.createdAt=result.board.createdAt;current.updatedAt=result.board.updatedAt;
      dirty=editVersion!==a.localVersion;
      boards.set(current.id,C.header(current));updateSelect();
      if(!dirty)status('已保存 · '+new Date(current.updatedAt).toLocaleTimeString());
      else status('正在保存后续修改…');
      return !dirty;
    } catch(e){saveError=String(e.message||e);status('未保存：'+saveError,true);return false;}
  }
  function saveNow() {
    if(saving)return saving.then(()=>dirty&&!saveError&&!conflicted?saveNow():!dirty);
    saving=performSave().finally(()=>{saving=null;});
    return saving.then(ok=>dirty&&!saveError&&!conflicted?saveNow():ok);
  }
  function trimHistory(){
    while(history.length>MAX_HISTORY)historySize-=history.shift().size;
    let redoSize=redo.reduce((n,h)=>n+h.size,0);
    while(historySize+redoSize>HISTORY_BYTES||history.length+redo.length>MAX_HISTORY){
      if(history.length>1||!redo.length){if(!history.length)break;historySize-=history.shift().size;}
      else redoSize-=redo.shift().size;
    }
  }
  function changed(before=null) {
    if(!current)return;
    if(before){
      const size=snapshotSize(before);
      history.push({state:before,size});historySize+=size;redo=[];
      trimHistory();
    }
    dirty=true;editVersion++;saveError='';
    requestRender();saveNow();
  }
  function mutate(fn) {
    if(!editable())return;
    const before=boardSnapshot();
    try {fn();current.canvas=C.canvas(current.canvas);changed(before);}catch(e){current.canvas=before.canvas;current.sources=before.sources;requestRender();throw e;}
  }
  function undo(forward=false) {
    if(!editable()||gesture||modal)return;
    const from=forward?redo:history,to=forward?history:redo;if(!from.length)return;
    const entry=from.pop(),now=boardSnapshot(),size=snapshotSize(now);
    if(forward)historySize+=size;else historySize-=entry.size;
    to.push({state:now,size});
    trimHistory();
    current.canvas=entry.state.canvas;current.sources=entry.state.sources;
    selected.clear();selectedEdge='';invalidateCards();changed();
  }
  function updateSelect() {
    const select=$('wb-board-select'),selectedId=current?.id||'';
    const frag=document.createDocumentFragment();
    for(const h of [...boards.values()].filter(h=>!h.deleted).sort((a,b)=>b.updatedAt-a.updatedAt)){
      const o=document.createElement('option');o.value=h.id;o.textContent=h.title;frag.append(o);
    }
    select.replaceChildren(frag);if(selectedId)select.value=selectedId;
  }
  async function loadBoards(more=false) {
    const r=await rpc({type:'CGR_BOARD_LIST',limit:50,cursor:more?boardCursor:null});
    if(!more)boards.clear();for(const h of r.items)boards.set(h.id,h);if(current)boards.set(current.id,C.header(current));
    boardCursor=r.cursor;$('wb-more').hidden=!boardCursor;updateSelect();return r.items;
  }
  async function leaveCurrent() {
    if(modal&&!await closeEditor())return false;
    if(gesture)finishGesture(false);
    if((dirty||attempt)&&!await saveNow()) {B.notice('白板尚未保存，请重试、另存冲突副本或先导出 .canvas。',true);return false;}
    return true;
  }
  async function loadBoard(id) {
    if(current?.id===id)return;
    if(!await leaveCurrent()){$('wb-board-select').value=current.id;return;}
    const token=++loadGeneration,r=await rpc({type:'CGR_BOARD_GET',id});
    if(token!==loadGeneration)return;if(!r.board)throw new Error('这块白板已不存在');if(r.board.deleted)throw new Error('这块白板在回收站中，请先恢复');
    current=r.board;dirty=false;attempt=null;conflicted=false;saveError='';draftId=uuid();editVersion=0;durableVersion=-1;
    history=[];redo=[];historySize=0;selected.clear();selectedEdge='';connectFrom=null;
    $('wb-conflict').hidden=true;invalidateCards();
    const saved=await chrome.storage.local.get([viewKey(id)]),v=saved[viewKey(id)];
    view=validView(v)?v:{x:40,y:40,z:1};
    boards.set(id,C.header(current));updateSelect();status('已保存 · '+new Date(current.updatedAt).toLocaleTimeString());
    chrome.storage.local.set({'cgr5:lastBoard':id}).catch(()=>{});requestRender();
  }
  function validView(v){return v&&[v.x,v.y,v.z].every(Number.isFinite)&&Math.abs(v.x)<1e8&&Math.abs(v.y)<1e8&&v.z>=.05&&v.z<=3;}
  async function newBoard(title=null,data=null,sources=null) {
    if(!await leaveCurrent())return false;
    const name=title??prompt('白板名称',B.getContext()?.title?B.getContext().title+' · 白板':'我的知识白板');if(name===null)return false;
    current=C.board({id:uuid(),title:name.trim().slice(0,300)||'未命名白板',scope:B.getContext()?.scope||'general',canvas:data||{nodes:[],edges:[]},sources:sources||{}});
    view={x:40,y:40,z:1};draftId=uuid();dirty=false;attempt=null;conflicted=false;saveError='';editVersion=0;durableVersion=-1;history=[];redo=[];historySize=0;selected.clear();selectedEdge='';connectFrom=null;
    $('wb-conflict').hidden=true;invalidateCards();boards.set(current.id,C.header(current));updateSelect();
    changed();const saved=await saveNow();chrome.storage.local.set({'cgr5:lastBoard':current.id}).catch(()=>{});if(current.canvas.nodes.length)fit();return saved;
  }
  async function initialize() {
    if(ready)return;
    const list=await loadBoards();const saved=await chrome.storage.local.get('cgr5:lastBoard');
    const candidate=explicitBoard||saved['cgr5:lastBoard']||list[0]?.id;
    if(candidate){try{await loadBoard(candidate);}catch(e){B.notice(String(e.message||e),true);if(list[0])await loadBoard(list[0].id);}}
    if(!current)await newBoard(B.getContext()?.title?B.getContext().title+' · 白板':'我的知识白板');
    ready=true;
  }
  async function activate(on=true) {
    if(on&&opening)return opening;
    if(on){
      opening=(async()=>{if(!await B.prepare())return false;B.pause();enabled=true;setWorkspaceUI(true);await initialize();requestRender();renderer.pump();stage.focus({preventScroll:true});return true;})().finally(()=>{opening=null;});
      return opening;
    }
    if(!await leaveCurrent())return false;
    enabled=false;invalidateCards();modalPreview.close();if(frame)cancelAnimationFrame(frame);frame=0;setWorkspaceUI(false);B.resume();return true;
  }

  // Render pass reads the board model and viewport only. It does not read host
  // ChatGPT DOM, fetch other board bodies or attach one observer per card.
  function requestRender(){if(!enabled||document.hidden||frame)return;frame=requestAnimationFrame(render);}
  function viewport() {return {x:-view.x/view.z,y:-view.y/view.z,width:stage.clientWidth/view.z,height:stage.clientHeight/view.z};}
  function render() {
    frame=0;if(!enabled||!current)return;
    world.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.z})`;
    $('wb-zoom-reset').textContent=Math.round(view.z*100)+'%';stage.classList.toggle('connecting',connectMode||!!connectFrom);
    $('wb-empty').hidden=!!current.canvas.nodes.length;
    const vp=viewport(),cx=vp.x+vp.width/2,cy=vp.y+vp.height/2;
    const candidates=current.canvas.nodes.filter(n=>C.intersects(n,vp,220/view.z)||selected.has(n.id)||gesture?.nodeId===n.id)
      .sort((a,b)=>Number(selected.has(b.id))-Number(selected.has(a.id))||Math.hypot(a.x+a.width/2-cx,a.y+a.height/2-cy)-Math.hypot(b.x+b.width/2-cx,b.y+b.height/2-cy));
    const visible=candidates.slice(0,MAX_DOM),wanted=new Set(visible.map(n=>n.id));
    for(const [id,r]of rendered)if(!wanted.has(id)){r.el.remove();rendered.delete(id);renderer.forget(id);}
    // Preserve JSON Canvas node order (z-index) even when the visible set is culled.
    const indices=new Map(current.canvas.nodes.map((n,i)=>[n.id,i]));
    for(const n of visible){
      let r=rendered.get(n.id);if(!r){r=mountNode(n);rendered.set(n.id,r);}
      const {el,body,label,kind}=r;
      el.style.left=n.x+'px';el.style.top=n.y+'px';el.style.width=n.width+'px';el.style.height=n.height+'px';
      el.style.zIndex=n.type==='group'?0:indices.get(n.id)+2;el.classList.toggle('selected',selected.has(n.id));el.classList.toggle('group',n.type==='group');
      el.dataset.color=n.color||'';if(n.color?.startsWith('#'))el.style.setProperty('--card-color',n.color);else el.style.removeProperty('--card-color');
      const kindText={text:'MARKDOWN',link:'LINK',file:'VAULT FILE',group:'GROUP'}[n.type];if(kind.textContent!==kindText)kind.textContent=kindText;
      const labelText=n.type==='text'?(n.text.split('\n').find(s=>s.trim())||'新卡片').replace(/^#+\s*/,'').slice(0,100):n.type==='group'?n.label||'分组':n.type==='file'?n.file:n.url;
      if(label.textContent!==labelText)label.textContent=labelText;label.title=labelText;
      if(n.type==='text') {
        if(r.text!==n.text||r.type!==n.type){r.text=n.text;r.type=n.type;renderer.request(n,body);}
      }else if(r.text!==JSON.stringify(n)||r.type!==n.type){
        r.text=JSON.stringify(n);r.type=n.type;body.replaceChildren();body.classList.remove('loading');
        const p=document.createElement('p');
        if(n.type==='link'){const a=document.createElement('a');a.href=C.safeURL(n.url);a.target='_blank';a.rel='noopener noreferrer';a.textContent=n.url;body.append(a);p.textContent='仅保存链接，不嵌入网页。';}
        else if(n.type==='file'){p.textContent=n.file+(n.subpath||'')+'\n\n仅保留 Vault 路径。导回原 Obsidian Vault 后解析附件。';p.style.whiteSpace='pre-wrap';}
        else p.textContent='';body.append(p);
      }
    }
    renderEdges(vp);
    updateSelectionTools();
    $('wb-count').textContent=`${current.canvas.nodes.length} 卡片 · ${current.canvas.edges.length} 连线`;
    $('wb-count').title=`当前挂载 ${rendered.size} 张卡片（最多 ${MAX_DOM}）；缩小查看全图时可放大以显示远处卡片。`;
    if(candidates.length>MAX_DOM)$('wb-count').textContent+=` · 显示 ${MAX_DOM}`;
    $('wb-undo').disabled=!history.length;$('wb-redo').disabled=!redo.length;
  }
  function mountNode(n) {
    const el=document.createElement('article');el.className='wb-node';el.dataset.nodeId=n.id;el.setAttribute('aria-label','白板卡片');
    const header=document.createElement('div');header.className='wb-node-header';
    const label=document.createElement('span');label.className='wb-node-label';const kind=document.createElement('span');kind.className='wb-node-kind';header.append(label,kind);
    const body=document.createElement('div');body.className='wb-node-body markdown-body';
    el.append(header,body);
    for(const side of C.SIDES){const p=document.createElement('button');p.className='wb-port';p.type='button';p.dataset.side=side;p.setAttribute('aria-label',`${side} 连接点`);p.title='拖到另一张卡片以连接';el.append(p);}
    const resize=document.createElement('button');resize.type='button';resize.className='wb-resize';resize.setAttribute('aria-label','拖动调整卡片大小');el.append(resize);nodesLayer.append(el);
    return {el,body,label,kind,text:null,type:null};
  }
  const svgEl=(tag,attrs={})=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
  const renderedEdges=new Map();
  const attr=(el,name,value)=>{if(value==null){if(el.hasAttribute(name))el.removeAttribute(name);}else if(el.getAttribute(name)!==String(value))el.setAttribute(name,String(value));};
  function renderEdges(vp) {
    if(!edgesLayer.querySelector('defs')){
      const defs=svgEl('defs');
      for(const[name,orient]of [['end','auto'],['start','auto-start-reverse']]){
        const m=svgEl('marker',{id:'wb-arrow-'+name,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient,markerUnits:'strokeWidth'});
        m.append(svgEl('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'context-stroke'}));defs.append(m);
      }edgesLayer.append(defs);
    }
    const map=new Map(current.canvas.nodes.map(n=>[n.id,n])),wanted=new Set();
    for(const e of current.canvas.edges){
      const a=map.get(e.fromNode),b=map.get(e.toNode);if(!a||!b)continue;
      const rect={x:Math.min(a.x,b.x)-220,y:Math.min(a.y,b.y)-220,width:Math.max(a.x+a.width,b.x+b.width)-Math.min(a.x,b.x)+440,height:Math.max(a.y+a.height,b.y+b.height)-Math.min(a.y,b.y)+440};
      if(!C.intersects(rect,vp,100/view.z))continue;
      if(wanted.size>=1500)break;wanted.add(e.id);
      const sides=C.autoSides(a,b),g=C.curve(a,b,e.fromSide||sides[0],e.toSide||sides[1]);
      let r=renderedEdges.get(e.id);
      if(!r){
        const group=svgEl('g',{'data-edge-id':e.id}),path=svgEl('path'),hit=svgEl('path',{class:'wb-edge-hit'}),label=svgEl('text',{class:'wb-edge-label'});
        group.append(path,hit,label);edgesLayer.append(group);r={group,path,hit,label};renderedEdges.set(e.id,r);
      }
      attr(r.path,'d',g.d);attr(r.hit,'d',g.d);attr(r.path,'class','wb-edge'+(selectedEdge===e.id?' selected':''));
      r.path.style.stroke=e.color?(COLORS[e.color]||e.color):'';
      attr(r.path,'marker-end',(e.toEnd||'arrow')==='arrow'?'url(#wb-arrow-end)':null);
      attr(r.path,'marker-start',e.fromEnd==='arrow'?'url(#wb-arrow-start)':null);
      attr(r.label,'x',g.x);attr(r.label,'y',g.y-6);
      const text=(e.label||'').slice(0,150);if(r.label.textContent!==text)r.label.textContent=text;
    }
    for(const[id,r]of renderedEdges)if(!wanted.has(id)){r.group.remove();renderedEdges.delete(id);}
    let temp=edgesLayer.querySelector('[data-temp-edge]');
    if(gesture?.type==='connect') {
      const n=map.get(gesture.nodeId);if(n){
        if(!temp){temp=svgEl('path',{'data-temp-edge':'',class:'wb-edge','stroke-dasharray':'6 4'});edgesLayer.append(temp);}
        const p=C.point(n,gesture.side),q=gesture.lastWorld||p;attr(temp,'d',`M ${p.x} ${p.y} L ${q.x} ${q.y}`);
      }
    }else temp?.remove();
  }
  function updateSelectionTools() {
    selected=new Set([...selected].filter(id=>!!getNode(id)));if(selectedEdge&&!getEdge(selectedEdge))selectedEdge='';
    const count=selected.size+(selectedEdge?1:0);$('wb-selection-tools').hidden=!count;
    $('wb-selection-count').textContent=selectedEdge?'关系连线':`${selected.size} 张卡片`;
    $('wb-edit').disabled=count!==1;$('wb-delete').disabled=!editable();
    const n=selectedEdge?getEdge(selectedEdge):getNode([...selected][0]);$('wb-color').value=n?.color||'';
    $('wb-source').disabled=selected.size!==1||!current?.sources[[...selected][0]]?.url;
  }
  function worldPoint(clientX,clientY) {const r=stage.getBoundingClientRect();return{x:(clientX-r.left-view.x)/view.z,y:(clientY-r.top-view.y)/view.z};}
  function saveView() {
    clearTimeout(viewTimer);if(!current)return;
    const id=current.id,v={...view};
    viewTimer=setTimeout(()=>chrome.storage.local.set({[viewKey(id)]:v}).catch(e=>B.notice('视图位置未保存：'+String(e.message||e),true)),400);
  }
  function zoom(factor,clientX=null,clientY=null) {
    const r=stage.getBoundingClientRect();const x=clientX??r.left+r.width/2,y=clientY??r.top+r.height/2;
    const p=worldPoint(x,y),z=Math.max(.05,Math.min(3,view.z*factor));
    view={z,x:x-r.left-p.x*z,y:y-r.top-p.y*z};requestRender();saveView();
  }
  function fit() {
    if(!current?.canvas.nodes.length){view={x:40,y:40,z:1};requestRender();saveView();return;}
    const ns=current.canvas.nodes,minX=Math.min(...ns.map(n=>n.x)),minY=Math.min(...ns.map(n=>n.y));
    const maxX=Math.max(...ns.map(n=>n.x+n.width)),maxY=Math.max(...ns.map(n=>n.y+n.height));
    const z=Math.max(.05,Math.min(1.2,(stage.clientWidth-80)/(maxX-minX||1),(stage.clientHeight-100)/(maxY-minY||1)));
    view={z,x:stage.clientWidth/2-(minX+maxX)/2*z,y:stage.clientHeight/2-(minY+maxY)/2*z};requestRender();saveView();
  }
  function focusNode(n) {view={...view,x:stage.clientWidth/2-(n.x+n.width/2)*view.z,y:stage.clientHeight/2-(n.y+n.height/2)*view.z};requestRender();saveView();}
  function addText(text,point=null,source=null) {
    if(!editable())throw new Error('请先打开可编辑白板');
    const v=viewport(),p=point||{x:v.x+Math.max(15,(v.width-320)/2),y:v.y+Math.max(15,(v.height-240)/2)};
    const full=text+C.sourceMarkdown(source);const n=C.textCard(full,p.x,p.y);
    mutate(()=>{current.canvas.nodes.push(n);if(source)current.sources[n.id]=C.source(source);});
    selected=new Set([n.id]);selectedEdge='';requestRender();return n;
  }
  function newCard(point=null) {const n=addText('',point);openEditor(n.id);}
  function connectNodes(from,to,fromSide=null,toSide=null) {
    if(!editable()||from===to)return;
    const a=getNode(from),b=getNode(to);if(!a||!b)return;
    const sides=C.autoSides(a,b);
    const e={id:uuid(),fromNode:from,fromSide:fromSide||sides[0],toNode:to,toSide:toSide||sides[1],fromEnd:'none',toEnd:'arrow'};
    mutate(()=>current.canvas.edges.push(e));selected.clear();selectedEdge=e.id;connectFrom=null;connectMode=false;$('wb-connect').setAttribute('aria-pressed','false');requestRender();
  }
  function deleteSelection() {
    if(!editable()||(!selected.size&&!selectedEdge))return;
    if(selected.size>1&&!confirm(`删除选中的 ${selected.size} 张卡片及关联连线？可用撤销恢复。`))return;
    mutate(()=>{current.canvas.nodes=current.canvas.nodes.filter(n=>!selected.has(n.id));current.canvas.edges=current.canvas.edges.filter(e=>e.id!==selectedEdge&&!selected.has(e.fromNode)&&!selected.has(e.toNode));for(const id of selected)delete current.sources[id];});
    selected.clear();selectedEdge='';requestRender();
  }
  function groupSelection() {
    if(!editable())return;const ns=[...selected].map(getNode).filter(Boolean),v=viewport();
    const x=ns.length?Math.min(...ns.map(n=>n.x))-30:v.x+40,y=ns.length?Math.min(...ns.map(n=>n.y))-55:v.y+40;
    const width=ns.length?Math.max(...ns.map(n=>n.x+n.width))-x+30:420,height=ns.length?Math.max(...ns.map(n=>n.y+n.height))-y+30:300;
    const n=C.node({id:uuid(),type:'group',x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height),label:'新分组',color:'6'});
    mutate(()=>current.canvas.nodes.unshift(n));selected=new Set([n.id]);requestRender();openEditor(n.id);
  }

  // Pointer gestures only mutate coordinates in memory. One persistent write
  // is sent on pointerup. pointercancel/Esc restores the pre-gesture snapshot.
  stage.addEventListener('pointerdown',safeEvent(e=>{
    if(!current||e.button>1)return;
    const card=e.target.closest('[data-node-id]'),edge=e.target.closest('[data-edge-id]'),port=e.target.closest('.wb-port');
    const point=worldPoint(e.clientX,e.clientY);
    if(e.button===1||space||(!card&&!edge)) {
      if(e.button===0&&!space){selected.clear();selectedEdge='';}
      gesture={type:'pan',x:e.clientX,y:e.clientY,view:{...view},moved:false};
    }else if(edge){selected.clear();selectedEdge=edge.dataset.edgeId;requestRender();e.preventDefault();stage.focus({preventScroll:true});return;}
    else if(card){
      const id=card.dataset.nodeId,n=getNode(id);if(!n)return;
      if(e.target.closest('a,.image-placeholder,input')&&!port)return;
      if(connectMode&&!port){if(!connectFrom){connectFrom={id};selected=new Set([id]);}else connectNodes(connectFrom.id,id);requestRender();e.preventDefault();return;}
      if(e.shiftKey){if(selected.has(id))selected.delete(id);else selected.add(id);}
      else if(!selected.has(id))selected=new Set([id]);selectedEdge='';
      if(port&&editable())gesture={type:'connect',nodeId:id,side:port.dataset.side,lastWorld:point,moved:false};
      else if(e.target.closest('.wb-resize')&&editable())gesture={type:'resize',nodeId:id,start:point,width:n.width,height:n.height,before:boardSnapshot(),moved:false};
      else if(e.target.closest('.wb-node-header')&&editable()){
        let ids=new Set(selected);
        for(const selectedId of [...ids]){const g=getNode(selectedId);if(g?.type==='group')for(const child of current.canvas.nodes)if(child.x>=g.x&&child.y>=g.y&&child.x+child.width<=g.x+g.width&&child.y+child.height<=g.y+g.height)ids.add(child.id);}
        gesture={type:'move',nodeId:id,start:point,origins:new Map([...ids].map(k=>{const a=getNode(k);return[k,{x:a.x,y:a.y}];})),before:boardSnapshot(),moved:false};
      }else {requestRender();return;}
    }
    if(gesture){e.preventDefault();stage.focus({preventScroll:true});gesture.pointerId=e.pointerId;}
    requestRender();
  }));
  stage.addEventListener('pointermove',safeEvent(e=>{
    if(!gesture||gesture.pointerId!==e.pointerId)return;
    const g=gesture,p=worldPoint(e.clientX,e.clientY);
    if(g.type==='pan'){const dx=e.clientX-g.x,dy=e.clientY-g.y;view={...g.view,x:g.view.x+dx,y:g.view.y+dy};if(Math.abs(dx)+Math.abs(dy)>2)g.moved=true;}
    else if(g.type==='connect'){g.lastWorld=p;g.moved=true;}
    else if(g.type==='move'){
      let dx=p.x-g.start.x,dy=p.y-g.start.y;if(e.shiftKey){if(Math.abs(dx)>Math.abs(dy))dy=0;else dx=0;}
      for(const[id,o]of g.origins){const n=getNode(id);n.x=Math.round(Math.max(-C.LIMIT.coordinate,Math.min(C.LIMIT.coordinate,o.x+dx)));n.y=Math.round(Math.max(-C.LIMIT.coordinate,Math.min(C.LIMIT.coordinate,o.y+dy)));}
      if(Math.abs(dx)+Math.abs(dy)>1)g.moved=true;
    }else if(g.type==='resize'){const n=getNode(g.nodeId);n.width=Math.round(Math.max(120,Math.min(10000,g.width+p.x-g.start.x)));n.height=Math.round(Math.max(90,Math.min(10000,g.height+p.y-g.start.y)));g.moved=true;}
    // Capture only after movement. Capturing on pointerdown retargets click /
    // dblclick to the stage and makes editing a card by double-click unreliable.
    if(g.moved&&!stage.hasPointerCapture(e.pointerId))stage.setPointerCapture(e.pointerId);
    requestRender();
  }));
  function finishGesture(cancel=false,e=null) {
    const g=gesture;if(!g)return;gesture=null;
    try{if(stage.hasPointerCapture(g.pointerId))stage.releasePointerCapture(g.pointerId);}catch{}
    if(cancel&&g.before){current.canvas=g.before.canvas;current.sources=g.before.sources;}
    else if(cancel&&g.type==='pan')view=g.view;
    else if(!cancel&&g.type==='connect'&&e){const target=document.elementFromPoint(e.clientX,e.clientY),card=target?.closest('[data-node-id]'),port=target?.closest('.wb-port');if(card)connectNodes(g.nodeId,card.dataset.nodeId,g.side,port?.dataset.side);}
    else if(!cancel&&g.moved&&g.before)changed(g.before);
    if(g.type==='pan')saveView();requestRender();
  }
  stage.addEventListener('pointerup',safeEvent(e=>finishGesture(false,e)));
  stage.addEventListener('pointercancel',()=>finishGesture(true));
  window.addEventListener('blur',()=>{space=false;if(gesture)finishGesture(true);});
  stage.addEventListener('dblclick',safeEvent(e=>{
    if(e.target.closest('a,button,input'))return;
    const card=e.target.closest('[data-node-id]'),edge=e.target.closest('[data-edge-id]');
    if(card)openEditor(card.dataset.nodeId);else if(edge)openEditor(edge.dataset.edgeId,true);else newCard(worldPoint(e.clientX,e.clientY));
  }));
  stage.addEventListener('wheel',e=>{
    if(!enabled)return;
    if(!e.ctrlKey&&!e.metaKey&&e.target.closest('.wb-node.selected .wb-node-body'))return;
    e.preventDefault();if(e.ctrlKey||e.metaKey)zoom(Math.exp(-e.deltaY*.004),e.clientX,e.clientY);
    else{view.x-=e.shiftKey?e.deltaY:e.deltaX;view.y-=e.shiftKey?e.deltaX:e.deltaY;requestRender();saveView();}
  },{passive:false});
  stage.addEventListener('click',e=>{const a=e.target.closest('a[href^="#"]');if(a){e.preventDefault();const target=document.getElementById(a.getAttribute('href').slice(1));if(target&&a.closest('.wb-node-body')?.contains(target))target.scrollIntoView({block:'nearest'});}});

  function openEditor(id,isEdge=false) {
    if(!editable())return;
    const item=isEdge?getEdge(id):getNode(id);if(!item)return;
    if(modal)return;
    renderer.close();modalPreview.close();
    modal={id,isEdge,original:clone(item),text:isEdge?item.label||'':item.type==='text'?item.text:item.type==='group'?item.label||'':item.type==='file'?item.file:item.url};
    $('wb-editor-title').textContent=isEdge?'编辑关系连线':item.type==='group'?'编辑分组':'编辑卡片';
    $('wb-field-label').textContent=isEdge?'关系文字':item.type==='text'?'Markdown 正文':item.type==='link'?'网页 URL':item.type==='file'?'Vault 内文件路径':'分组名称';
    $('wb-text').value=modal.text;$('wb-text').maxLength=isEdge?2000:item.type==='text'?C.LIMIT.text:item.type==='group'?1000:item.type==='file'?4096:8192;
    $('wb-edge-options').hidden=!isEdge;$('wb-from-end').value=item.fromEnd||'none';$('wb-to-end').value=item.toEnd||'arrow';
    $('wb-card-preview-button').hidden=isEdge||item.type!=='text';$('wb-card-preview').hidden=true;
    $('wb-edit-dialog').showModal();$('wb-text').focus();
  }
  function modalDirty(){return modal&&($('wb-text').value!==modal.text||(modal.isEdge&&($('wb-from-end').value!==(modal.original.fromEnd||'none')||$('wb-to-end').value!==(modal.original.toEnd||'arrow'))));}
  async function closeEditor(force=false) {
    if(!modal)return true;
    if(!force&&modalDirty()&&!confirm('卡片编辑尚未应用。放弃这些修改？点击“取消”可返回保存。'))return false;
    modal=null;modalPreview.close();$('wb-edit-dialog').close();
    // Closed worker jobs were deliberately cancelled. Requeue only still-live cards.
    for(const[id,r]of rendered){const n=getNode(id);if(n?.type==='text')renderer.request(n,r.body);}requestRender();return true;
  }
  async function saveEditor() {
    if(!modal)return;const m=modal,value=$('wb-text').value;
    mutate(()=>{const n=m.isEdge?getEdge(m.id):getNode(m.id);if(!n)throw new Error('对象已被删除');if(m.isEdge){n.label=value;n.fromEnd=$('wb-from-end').value;n.toEnd=$('wb-to-end').value;}else if(n.type==='text')n.text=value;else if(n.type==='link')n.url=value.trim();else if(n.type==='group')n.label=value;else if(n.type==='file')n.file=value;});
    await closeEditor(true);await saveNow();
  }
  $('wb-editor-close').onclick=safeEvent(()=>closeEditor());$('wb-editor-save').onclick=safeEvent(saveEditor);
  $('wb-edit-dialog').addEventListener('cancel',e=>{e.preventDefault();closeEditor();});
  $('wb-card-preview-button').onclick=safeEvent(async()=>{$('wb-card-preview').hidden=false;await modalPreview.render($('wb-text').value,{force:true});});
  $('wb-text').addEventListener('input',()=>{if(!$('wb-card-preview').hidden){modalPreview.close();$('wb-card-preview').textContent='内容已修改，点击“预览”刷新。';}});

  // Drop inputs are data, never injected HTML. Built-in note drags carry only
  // a note ID; the full private body is fetched by the manager after the drop.
  async function fromNote(id,p=null) {
    const r=await rpc({type:'CGR_NOTE_GET',id});if(!r.note)throw new Error('这条批注已经不存在');
    const n=r.note;return addText((n.title?'# '+n.title.replace(/\n/g,' ')+'\n\n':'')+n.markdown,p,n.source);
  }
  async function handleDrop(dt,p) {
    if(!editable())throw new Error('白板尚未就绪，请重试');
    const note=dt.getData('application/x-cgr-note');if(note){await fromNote(note,p);return;}
    const payload=dt.getData('application/x-cgr-card');
    if(payload){if(payload.length>2*C.LIMIT.text)throw new Error('拖入数据过大');const v=JSON.parse(payload);if(v.format!=='cgr-card'||v.version!==1||typeof v.markdown!=='string')throw new Error('不支持的拖拽内容');addText(v.markdown,p,v.source);return;}
    if(dt.files.length){
      if(dt.files.length>20)throw new Error('一次最多拖入 20 个文本文件');
      for(const[index,file]of [...dt.files].entries()){
        if(/\.canvas$/i.test(file.name)){await importFile(file);continue;}
        if(!/\.(md|markdown|txt)$/i.test(file.name))throw new Error('只接受 .canvas、.md、.markdown 或 .txt 文件；附件请在 Obsidian 中管理');
        if(file.size>C.LIMIT.text*4)throw new Error('文本文件过大');const text=await file.text();addText('# '+file.name+'\n\n'+text,{x:p.x+index*35,y:p.y+index*35});
      }return;
    }
    const plain=dt.getData('text/plain'),uri=dt.getData('text/uri-list').split('\n').find(l=>l&&!l.startsWith('#'));
    const raw=uri||plain.trim();
    if(C.safeURL(raw)&&!raw.includes('\n')&&(!plain||plain.trim()===raw||!!uri)){
      const n=C.node({id:uuid(),type:'link',url:C.safeURL(raw),x:Math.round(p.x),y:Math.round(p.y),width:320,height:180});mutate(()=>current.canvas.nodes.push(n));selected=new Set([n.id]);requestRender();
    }else if(plain)addText(plain,p);
    else throw new Error('没有可读取的文字。请拖拽选中文字、章节 ⠿，或使用批注素材的“加入”按钮。');
  }
  stage.addEventListener('dragover',e=>{if(editable()){e.preventDefault();e.dataTransfer.dropEffect='copy';stage.classList.add('drag-over');}});
  stage.addEventListener('dragleave',e=>{if(!stage.contains(e.relatedTarget))stage.classList.remove('drag-over');});
  stage.addEventListener('drop',safeEvent(async e=>{e.preventDefault();stage.classList.remove('drag-over');const p=worldPoint(e.clientX,e.clientY);await handleDrop(e.dataTransfer,p);stage.focus({preventScroll:true});}));
  stage.addEventListener('paste',safeEvent(async e=>{if(!enabled||isInput(e.target)||!editable())return;const text=e.clipboardData?.getData('text/plain');if(text){e.preventDefault();addText(text);}}));
  async function materials(reset=true) {
    const serial=++noteSerial;if(reset){noteCursor=null;notePages=[];}
    const scope=$('wb-note-scope').value==='current'?B.getContext()?.scope||'general':undefined;
    const r=await rpc({type:'CGR_NOTE_LIST',filter:{scope,query:$('wb-note-search').value.trim()},cursor:noteCursor,limit:30});if(serial!==noteSerial)return;
    noteNext=r.cursor;$('wb-note-prev').disabled=!notePages.length;$('wb-note-next').disabled=!noteNext;
    $('wb-note-page').textContent=`第 ${notePages.length+1} 页 · ${r.items.length} 条`;
    const frag=document.createDocumentFragment();
    for(const n of r.items){const el=document.createElement('div');el.className='wb-material-card';el.draggable=true;el.dataset.noteId=n.id;
      const title=document.createElement('strong');title.textContent=n.title||n.source?.heading||'独立批注';const p=document.createElement('p');p.textContent=n.preview||'';
      const add=document.createElement('button');add.textContent='＋ 加入';add.onclick=safeEvent(()=>fromNote(n.id));
      el.addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-cgr-note',n.id);e.dataTransfer.setData('text/plain',n.title||'批注');e.dataTransfer.effectAllowed='copy';});el.append(title,p,add);frag.append(el);}
    if(!r.items.length){const p=document.createElement('p');p.className='muted';p.textContent='没有匹配的批注；可改选“全部对话”，或直接从 ChatGPT 拖入正文。';frag.append(p);}
    $('wb-note-list').replaceChildren(frag);
  }

  // Portable exports contain no runtime/render cache. Sources are copied into
  // card Markdown on creation, so exported cards are useful without this plugin.
  function filename(name,ext){return (name||'Whiteboard').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,120)+ext;}
  async function exportCanvas() {
    if(!current)return;if(modal&&modalDirty())throw new Error('卡片输入框还有未应用的编辑，请先点击“保存卡片”再导出');
    const data=C.canvas(current.canvas);B.download(filename(current.title,'.canvas'),JSON.stringify(data,null,2),'application/json');
    B.notice('已导出 .canvas：包含当前卡片和连线，即使存在保存冲突也可用作备份。');
  }
  async function backup() {
    if(!await leaveCurrent())return;
    let cursor=null,all=[],bytes=0;
    do{const r=await rpc({type:'CGR_BOARD_LIST',includeDeleted:true,limit:50,cursor});for(const h of r.items){const {board}=await rpc({type:'CGR_BOARD_GET',id:h.id});if(board){bytes+=snapshotSize(board);if(bytes>30*1024*1024)throw new Error('备份超过 30 MiB，请逐块导出 .canvas');all.push(board);}}cursor=r.cursor;}while(cursor);
    const json=JSON.stringify({format:'chatgpt-reading-whiteboards',version:1,exportedAt:new Date().toISOString(),boards:all},null,2);
    if(new TextEncoder().encode(json).length>30*1024*1024)throw new Error('最终备份文件超过 30 MiB，请逐块导出 .canvas；未生成无法回导的备份。');
    B.download('whiteboards-'+new Date().toISOString().slice(0,10)+'.json',json,'application/json');B.notice(`已备份 ${all.length} 块白板（含回收站，不含恢复草稿和尚未应用的输入框编辑）。`);
  }
  async function importFile(file) {
    if(!file||busyImport)return;if(file.size>30*1024*1024)throw new Error('导入文件超过 30 MiB');
    busyImport=true;
    try{
      const data=JSON.parse(await file.text());
      if(data.format==='chatgpt-reading-whiteboards'){
        if(data.version!==1||!Array.isArray(data.boards)||data.boards.length>500)throw new Error('不支持的白板备份格式');
        const incoming=data.boards.map(C.board); // validate the whole input before writing
        if(!await leaveCurrent())return;
        let lastId=null;
        for(const old of incoming){const b={...old,id:uuid(),revision:'',title:(old.title+'（导入副本）').slice(0,300),createdAt:0,updatedAt:0};const r=await rpc({type:'CGR_BOARD_SAVE',board:b,expectedRevision:'',op:uuid(),draftId:uuid()});if(r.conflict)throw new Error('新白板标识冲突，请重试');if(!b.deleted)lastId=b.id;}
        await loadBoards();if(lastId)await loadBoard(lastId);B.notice(`已导入 ${incoming.length} 块白板为独立副本，未覆盖本地白板。`);
      }else {const c=C.canvas(data);if(await newBoard(file.name.replace(/\.(canvas|json)$/i,''),c))B.notice('已导入标准 JSON Canvas。Vault 文件和背景路径保留，但不读取本机附件。');}
    }finally{busyImport=false;}
  }
  async function recoveries(trash=false) {
    const frag=document.createDocumentFragment();
    if(trash){
      let cursor=null,count=0;
      do{const r=await rpc({type:'CGR_BOARD_LIST',trash:true,limit:50,cursor});for(const h of r.items){count++;const row=document.createElement('div');row.className='wb-recovery-row';const title=document.createElement('strong');title.textContent=h.title;const b=document.createElement('button');b.textContent='恢复白板';b.onclick=safeEvent(async()=>{const {board}=await rpc({type:'CGR_BOARD_GET',id:h.id});board.deleted=false;const res=await rpc({type:'CGR_BOARD_SAVE',board,expectedRevision:board.revision,op:uuid(),draftId:uuid()});if(res.conflict)throw new Error('另一窗口改动了白板，请刷新重试');row.remove();await loadBoards();});row.append(title,b);frag.append(row);}cursor=r.cursor;if(count>=200&&cursor){const tip=document.createElement('p');tip.textContent='仅显示前 200 块；恢复后重新打开可加载后续项目。';frag.append(tip);break;}}while(cursor);
      if(!count){const p=document.createElement('p');p.textContent='回收站为空。';frag.append(p);}
    }else {
      const r=await rpc({type:'CGR_BOARD_DRAFTS'});
      for(const d of r.items.slice(0,200)){const row=document.createElement('div');row.className='wb-recovery-row';const title=document.createElement('strong');title.textContent=d.title+' · '+new Date(d.updatedAt).toLocaleString();
        const restore=document.createElement('button');restore.textContent='恢复为新白板';restore.onclick=safeEvent(async()=>{const {draft}=await rpc({type:'CGR_BOARD_DRAFT_GET',id:d.id});if(!draft)throw new Error('恢复草稿已不存在');const b=draft.board;if(await newBoard(b.title+'（恢复副本）',b.canvas,b.sources)){await rpc({type:'CGR_BOARD_DRAFT_REMOVE',id:d.id});row.remove();$('wb-recovery-dialog').close();}});
        const remove=document.createElement('button');remove.textContent='删除草稿';remove.onclick=safeEvent(async()=>{if(confirm('永久删除这份冲突草稿？已保存的白板不受影响。')){await rpc({type:'CGR_BOARD_DRAFT_REMOVE',id:d.id});row.remove();}});row.append(title,restore,remove);frag.append(row);}
      if(!r.items.length){const p=document.createElement('p');p.textContent='没有待恢复草稿。发生版本冲突时会在这里保留当前提交。';frag.append(p);}
    }
    $('wb-recovery-list').replaceChildren(frag);$('wb-recovery-dialog').showModal();
  }
  async function copyConflict() {
    if(!current)return;
    // Keep failed/conflicting snapshots recoverable; fork local model to a new ID.
    if(dirty)await saveNow();
    const copy=clone(current);copy.id=uuid();copy.title=(copy.title+'（冲突副本）').slice(0,300);copy.revision='';copy.createdAt=0;copy.updatedAt=0;copy.deleted=false;
    current=copy;attempt=null;conflicted=false;dirty=false;saveError='';draftId=uuid();$('wb-conflict').hidden=true;changed();await saveNow();
    if(!dirty)B.notice('当前内容已另存为独立白板；原白板未被覆盖。');else B.notice('副本尚未保存，请重试或导出 .canvas。',true);
  }
  async function reloadConflict() {
    if(!current)return;if(modal&&!await closeEditor())return;
    if(dirty&&!conflicted&&!(await saveNow()))return;
    if(dirty&&conflicted){await saveNow();if(durableVersion!==editVersion){B.notice('最新修改尚未可靠保存为草稿，请重试或先导出；未替换当前白板。',true);return;}}
    const id=current.id;const r=await rpc({type:'CGR_BOARD_GET',id});if(!r.board)throw new Error('原白板不存在，请另存为副本');
    if(dirty&&!confirm('读取另一窗口的最新白板？本次已提交的冲突内容仍在恢复草稿中。'))return;
    current=null;dirty=false;attempt=null;saveError='';conflicted=false;await loadBoard(id);B.notice('已读取最新白板；冲突草稿仍可恢复。');
  }

  // UI integration and shortcuts.
  $('app-whiteboard').onclick=safeEvent(()=>activate(true));$('app-notes').onclick=safeEvent(()=>activate(false));
  $('wb-new').onclick=safeEvent(()=>newBoard());$('wb-board-select').onchange=safeEvent(e=>loadBoard(e.target.value));$('wb-more').onclick=safeEvent(()=>loadBoards(true));
  $('wb-rename').onclick=safeEvent(()=>{if(!editable())return;const title=prompt('白板名称',current.title);if(title!==null){current.title=title.trim().slice(0,300)||'未命名白板';changed();}});
  $('wb-wide').onclick=safeEvent(async()=>{if(!await leaveCurrent())return;const p=new URLSearchParams({mode:'whiteboard',board:current.id});if(B.getTabId()!=null)p.set('tabId',String(B.getTabId()));await chrome.tabs.create({url:chrome.runtime.getURL('sidebar.html')+'?'+p});});
  $('wb-add').onclick=safeEvent(()=>newCard());$('wb-group').onclick=safeEvent(groupSelection);
  $('wb-connect').onclick=()=>{connectMode=!connectMode;connectFrom=null;$('wb-connect').setAttribute('aria-pressed',String(connectMode));B.notice(connectMode?'依次点击两张卡片，或拖动卡片边缘圆点以连接。':'已退出连线模式。');requestRender();};
  $('wb-materials-toggle').onclick=safeEvent(async()=>{$('wb-materials').hidden=!$('wb-materials').hidden;if(!$('wb-materials').hidden)await materials();requestRender();});
  $('wb-files-toggle').onclick=()=>{$('wb-files').hidden=!$('wb-files').hidden;requestRender();};
  $('wb-help').onclick=()=>$('wb-help-dialog').showModal();
  document.querySelectorAll('#wb-help-dialog [data-close],#wb-recovery-dialog [data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('wb-save').onclick=safeEvent(()=>{saveError='';return saveNow();});
  $('wb-edit').onclick=()=>{if(selectedEdge)openEditor(selectedEdge,true);else if(selected.size===1)openEditor([...selected][0]);};
  $('wb-delete').onclick=safeEvent(deleteSelection);
  $('wb-color').onchange=safeEvent(e=>mutate(()=>{for(const id of selected){const n=getNode(id);if(n){if(e.target.value)n.color=e.target.value;else delete n.color;}}if(selectedEdge){const edge=getEdge(selectedEdge);if(e.target.value)edge.color=e.target.value;else delete edge.color;}}));
  $('wb-source').onclick=safeEvent(async()=>{const s=current.sources[[...selected][0]];if(s){const r=await rpc({type:'CGR_NOTE_LOCATE',source:s,tabId:B.getTabId()});B.notice(r.message||'已打开原文');}});
  $('wb-undo').onclick=()=>undo();$('wb-redo').onclick=()=>undo(true);$('wb-zoom-in').onclick=()=>zoom(1.2);$('wb-zoom-out').onclick=()=>zoom(1/1.2);$('wb-zoom-reset').onclick=()=>zoom(1/view.z);$('wb-fit').onclick=fit;
  $('wb-export').onclick=safeEvent(exportCanvas);$('wb-backup').onclick=safeEvent(backup);$('wb-import').onchange=safeEvent(e=>{const f=e.target.files[0];e.target.value='';return importFile(f);});
  $('wb-recovery').onclick=safeEvent(()=>recoveries());$('wb-show-trash').onclick=safeEvent(()=>recoveries(true));
  $('wb-trash').onclick=safeEvent(async()=>{if(!current||!confirm('将当前白板移入回收站？卡片与连线会保留，可从回收站恢复。'))return;if(!await leaveCurrent())return;current.deleted=true;changed();if(!await saveNow())return;current=null;await loadBoards();const next=[...boards.values()].find(b=>!b.deleted);if(next)await loadBoard(next.id);else await newBoard('我的知识白板');});
  $('wb-conflict-copy').onclick=safeEvent(copyConflict);$('wb-conflict-reload').onclick=safeEvent(reloadConflict);
  $('wb-note-refresh').onclick=safeEvent(()=>materials());$('wb-note-scope').onchange=safeEvent(()=>materials());$('wb-note-search').oninput=()=>{clearTimeout(noteTimer);noteTimer=setTimeout(()=>materials().catch(error),250);};
  $('wb-note-next').onclick=safeEvent(()=>{if(noteNext){notePages.push(noteCursor);noteCursor=noteNext;return materials(false);}});$('wb-note-prev').onclick=safeEvent(()=>{if(notePages.length){noteCursor=notePages.pop();return materials(false);}});
  document.addEventListener('keydown',safeEvent(async e=>{
    if(!enabled||e.isComposing)return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(modal)await saveEditor();else{saveError='';await saveNow();}return;}
    if(modal||document.querySelector('dialog[open]')||isInput(e.target))return;
    if(e.code==='Space'){e.preventDefault();space=true;return;}
    if(e.key==='Escape'){if(gesture)finishGesture(true);connectMode=false;connectFrom=null;selected.clear();selectedEdge='';$('wb-connect').setAttribute('aria-pressed','false');requestRender();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();selected=new Set(current.canvas.nodes.map(n=>n.id));selectedEdge='';requestRender();return;}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelection();}
  }));
  document.addEventListener('keyup',e=>{if(e.code==='Space')space=false;});
  new ResizeObserver(()=>requestRender()).observe(stage);
  window.addEventListener('cgr-whiteboard-note',safeEvent(async({detail:n})=>{if(await activate())addText((n.title?'# '+n.title+'\n\n':'')+n.markdown,null,n.source);}));
  window.addEventListener('cgr-context',safeEvent(async({detail:c})=>{
    if(c?.mode!=='whiteboard'){if(c?.source&&enabled)await activate(false);return;}
    if(c.nonce===contextNonce)return;contextNonce=c.nonce;
    // A stored open request is a one-shot command. Its nonce survives a sidebar
    // reload so the same click cannot create duplicate cards on every reopen.
    const key='cgr5:consumed:tab:'+(B.getTabId()??'manager'),saved=await chrome.storage.session.get(key);
    if(!await activate())return;
    if(c.card&&saved[key]!==c.nonce){
      addText(c.card.markdown,null,c.card.source);if(await saveNow())await chrome.storage.session.set({[key]:c.nonce});
    }
  }));
  chrome.runtime.onMessage.addListener(m=>{
    if(m?.type==='CGR_NOTES_CHANGED'&&enabled&&!$('wb-materials').hidden)materials().catch(error);
    if(m?.type==='CGR_BOARDS_CHANGED'&&m.id===current?.id&&m.revision!==current.revision&&!dirty&&!saving&&!gesture&&!modal){
      // Never hot-replace an active gesture/editor. Clean instances can follow
      // committed edits by another window without manufacturing a new write.
      const id=current.id;rpc({type:'CGR_BOARD_GET',id}).then(r=>{if(r.board&&current?.id===id&&!dirty&&!saving&&!gesture&&!modal){current=r.board;boards.set(id,C.header(current));updateSelect();invalidateCards();requestRender();status(r.board.deleted?'此白板已在另一窗口移入回收站':'已同步另一窗口的保存');}}).catch(error);
    }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){renderer.close();modalPreview.close();if(gesture)finishGesture(true);if(dirty)saveNow();}else if(enabled){for(const[id,r]of rendered){const n=getNode(id);if(n?.type==='text')renderer.request(n,r.body);}requestRender();}});
  window.addEventListener('pagehide',()=>{renderer.close();modalPreview.close();if(dirty)saveNow();if(current)chrome.storage.local.set({[viewKey(current.id)]:view}).catch(()=>{});});
  window.addEventListener('beforeunload',e=>{if(dirty||attempt||modalDirty()){e.preventDefault();e.returnValue='';}});
  // User-invoked diagnostics for tests/debugging; never exposes content to the
  // host webpage (this file runs only in the isolated extension sidebar page).
  globalThis.CGRWhiteboardDiagnostics=()=>({enabled,boardId:current?.id||'',revision:current?.revision||'',nodes:current?.canvas.nodes.length||0,edges:current?.canvas.edges.length||0,mounted:rendered.size,worker:renderer.worker?1:0,previewCache:renderer.cache.size,previewBytes:renderer.cacheBytes,mountedEdges:renderedEdges.size,history:history.length,historyBytes:historySize+redo.reduce((n,h)=>n+h.size,0),dirty,conflicted,view:{...view}});
  if(params.get('mode')==='whiteboard')activate().catch(error);
  else {const c=B.getContext();if(c?.mode==='whiteboard')window.dispatchEvent(new CustomEvent('cgr-context',{detail:c}));}
})();
