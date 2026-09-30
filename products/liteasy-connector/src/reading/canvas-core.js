/* JSON Canvas 1.0 model, independent of browser/DOM. Export contains only spec fields.
 * https://jsoncanvas.org/spec/1.0/ — no executable HTML or arbitrary node properties. */
(() => {
  'use strict';
  const LIMIT = Object.freeze({nodes:1000, edges:3000, text:262144, bytes:5*1024*1024, coordinate:10000000});
  const ID=/^[a-zA-Z0-9_-]{1,128}$/;
  const SIDES=new Set(['top','right','bottom','left']);
  const TYPES=new Set(['text','link','file','group']);
  const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  function str(v, max, label, empty=true) {
    if(typeof v!=='string'||v.length>max||(!empty&&!v))throw new Error(`${label}格式或长度不正确`);
    return v;
  }
  function identifier(v) { if(typeof v!=='string'||!ID.test(v))throw new Error('无效的卡片、连线或白板标识');return v; }
  function integer(v,positive=false) {
    if(!Number.isSafeInteger(v)||Math.abs(v)>LIMIT.coordinate||(positive&&v<=0))throw new Error('Canvas 坐标、宽高必须是有效整数');return v;
  }
  function color(v) {
    if(typeof v!=='string'||!/^([1-6]|#[a-f0-9]{6})$/i.test(v))throw new Error('Canvas 颜色必须为 1–6 或 #RRGGBB');return v;
  }
  function safeURL(v) {
    try {const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}
  }
  function node(v) {
    if(!v||typeof v!=='object'||Array.isArray(v)||!TYPES.has(v.type))throw new Error('不支持的 Canvas 卡片类型');
    const n={id:identifier(v.id),type:v.type,x:integer(v.x),y:integer(v.y),width:integer(v.width,true),height:integer(v.height,true)};
    if(has(v,'color'))n.color=color(v.color);
    if(v.type==='text')n.text=str(v.text,LIMIT.text,'卡片正文');
    if(v.type==='link') {n.url=str(v.url,8192,'链接',false); if(!safeURL(n.url))throw new Error('网页卡片只接受不含凭据的 HTTP / HTTPS 链接');}
    if(v.type==='file') {n.file=str(v.file,4096,'文件路径',false);if(has(v,'subpath')){n.subpath=str(v.subpath,4096,'文件子路径');if(!n.subpath.startsWith('#'))throw new Error('文件子路径必须以 # 开头');}}
    if(v.type==='group') {
      if(has(v,'label'))n.label=str(v.label,1000,'分组标题');
      if(has(v,'background'))n.background=str(v.background,4096,'背景路径');
      if(has(v,'backgroundStyle')){if(!['cover','ratio','repeat'].includes(v.backgroundStyle))throw new Error('无效的分组背景样式');n.backgroundStyle=v.backgroundStyle;}
    }
    return n;
  }
  function edge(v,ids) {
    if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('连线格式不正确');
    const e={id:identifier(v.id),fromNode:identifier(v.fromNode),toNode:identifier(v.toNode)};
    if(!ids.has(e.fromNode)||!ids.has(e.toNode))throw new Error('连线引用了不存在的卡片');
    for(const k of ['fromSide','toSide'])if(has(v,k)){if(!SIDES.has(v[k]))throw new Error('无效的连线方向');e[k]=v[k];}
    for(const k of ['fromEnd','toEnd'])if(has(v,k)){if(!['none','arrow'].includes(v[k]))throw new Error('无效的箭头类型');e[k]=v[k];}
    if(has(v,'color'))e.color=color(v.color);
    if(has(v,'label'))e.label=str(v.label,2000,'连线标签');
    return e;
  }
  function canvas(v) {
    if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('不是有效的 JSON Canvas 对象');
    const nodes=v.nodes===undefined?[]:v.nodes, edges=v.edges===undefined?[]:v.edges;
    if(!Array.isArray(nodes)||!Array.isArray(edges)||nodes.length>LIMIT.nodes||edges.length>LIMIT.edges)throw new Error(`单块白板上限 ${LIMIT.nodes} 张卡片 / ${LIMIT.edges} 条连线`);
    const out={nodes:nodes.map(node),edges:[]},ids=new Set(out.nodes.map(n=>n.id));
    if(ids.size!==out.nodes.length)throw new Error('Canvas 中有重复卡片 ID');
    out.edges=edges.map(e=>edge(e,ids));
    if(new Set(out.edges.map(e=>e.id)).size!==out.edges.length)throw new Error('Canvas 中有重复连线 ID');
    if(new TextEncoder().encode(JSON.stringify(out)).length>LIMIT.bytes)throw new Error('单块白板内容超过 5 MiB，请拆成多个白板');
    return out;
  }
  function source(raw) {
    if(!raw)return null;
    if(typeof CGRNotes!=='undefined')return CGRNotes.source(raw);
    return {url:safeURL(raw.url||''),heading:String(raw.heading||'').slice(0,600),title:String(raw.title||'').slice(0,300)};
  }
  function board(raw) {
    if(!raw||typeof raw!=='object')throw new Error('白板数据不正确');
    const c=canvas(raw.canvas), refs=Object.create(null);
    for(const n of c.nodes)if(raw.sources?.[n.id])refs[n.id]=source(raw.sources[n.id]);
    const scope=typeof raw.scope==='string'&&/^(general|[dcs]-[0-9a-f]{16})$/.test(raw.scope)?raw.scope:'general';
    return {id:identifier(raw.id),title:str(raw.title||'未命名白板',300,'白板名称'),scope,canvas:c,sources:refs,
      revision:typeof raw.revision==='string'?raw.revision.slice(0,200):'',createdAt:Number.isSafeInteger(raw.createdAt)?raw.createdAt:0,
      updatedAt:Number.isSafeInteger(raw.updatedAt)?raw.updatedAt:0,deleted:!!raw.deleted};
  }
  function header(b) {const {canvas,sources,...h}=b;return {...h,nodes:canvas.nodes.length,edges:canvas.edges.length};}
  function uuid(){return crypto.randomUUID().replace(/-/g,'');}
  function textCard(text,x=0,y=0) {return node({id:uuid(),type:'text',text,x:Math.round(x),y:Math.round(y),width:320,height:240});}
  function point(n,side) {
    switch(side){case'top':return{x:n.x+n.width/2,y:n.y};case'bottom':return{x:n.x+n.width/2,y:n.y+n.height};case'left':return{x:n.x,y:n.y+n.height/2};default:return{x:n.x+n.width,y:n.y+n.height/2};}
  }
  function autoSides(a,b) {
    const dx=b.x+b.width/2-a.x-a.width/2,dy=b.y+b.height/2-a.y-a.height/2;
    return Math.abs(dx)>=Math.abs(dy)?[dx>=0?'right':'left',dx>=0?'left':'right']:[dy>=0?'bottom':'top',dy>=0?'top':'bottom'];
  }
  function curve(a,b,from,to) {
    const p=point(a,from),q=point(b,to),v={left:[-1,0],right:[1,0],top:[0,-1],bottom:[0,1]},d=Math.max(50,Math.min(220,Math.hypot(q.x-p.x,q.y-p.y)*.45));
    const c={x:p.x+v[from][0]*d,y:p.y+v[from][1]*d},e={x:q.x+v[to][0]*d,y:q.y+v[to][1]*d};
    return {d:`M ${p.x} ${p.y} C ${c.x} ${c.y}, ${e.x} ${e.y}, ${q.x} ${q.y}`,x:(p.x+3*c.x+3*e.x+q.x)/8,y:(p.y+3*c.y+3*e.y+q.y)/8};
  }
  function intersects(n,view,pad=0) {return n.x+n.width>=view.x-pad&&n.x<=view.x+view.width+pad&&n.y+n.height>=view.y-pad&&n.y<=view.y+view.height+pad;}
  function sourceMarkdown(s) {
    const url=safeURL(s?.url||'');return url?`\n\n---\n[来源：${String(s.heading||s.title||'ChatGPT').replace(/[\[\]\\\n]/g,' ').slice(0,300)}](<${url.replace(/[<>]/g,encodeURIComponent)}>)`:'';
  }
  globalThis.CGRCanvas={LIMIT,ID,SIDES,canvas,node,edge,board,header,uuid,textCard,point,autoSides,curve,intersects,source,safeURL,sourceMarkdown};
  if(typeof module!=='undefined')module.exports=globalThis.CGRCanvas;
})();
