/* Independent DB: installing v0.5 never upgrades/removes the v0.4 annotation DB.
 * Board CAS + recovery draft are committed atomically. Service-worker restarts
 * cannot turn an acknowledged write into a lost in-memory update. */
(() => {
  'use strict';
  const C=CGRCanvas;
  let connection;
  function db() {
    if(!connection)connection=new Promise((resolve,reject)=>{
      const r=indexedDB.open('cgr-reading-whiteboards',1);
      r.onupgradeneeded=()=>{const d=r.result;const h=d.createObjectStore('headers',{keyPath:'id'});h.createIndex('updated',['updatedAt','id']);d.createObjectStore('boards',{keyPath:'id'});d.createObjectStore('drafts',{keyPath:'id'});};
      r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();connection=null;};resolve(r.result);};
      r.onerror=()=>{connection=null;reject(r.error);};r.onblocked=()=>{connection=null;reject(new Error('白板数据库被其他页面占用，请关闭旧管理页后重试'));};
    });
    return connection.catch(e=>{connection=null;throw e;});
  }
  async function transaction(stores,mode,work) {
    const d=await db();
    return new Promise((resolve,reject)=>{
      let tx;try{tx=d.transaction(stores,mode,mode==='readwrite'?{durability:'strict'}:undefined);}catch{tx=d.transaction(stores,mode);}
      let out,error;tx.oncomplete=()=>resolve(out);tx.onerror=()=>{};tx.onabort=()=>reject(error||tx.error||new Error('白板事务失败'));
      try{work(tx,r=>out=r);}catch(e){error=e;tx.abort();}
    });
  }
  async function get(id) {
    if(!C.ID.test(id||''))throw new Error('无效的白板标识');
    return transaction(['boards'],'readonly',(tx,done)=>{const r=tx.objectStore('boards').get(id);r.onsuccess=()=>done({board:r.result?C.board(r.result):null});});
  }
  async function save(m) {
    const b=C.board(m.board), expected=String(m.expectedRevision||'');
    if(!C.ID.test(m.op||'')||!C.ID.test(m.draftId||''))throw new Error('无效的保存操作');
    return transaction(['boards','headers','drafts'],'readwrite',(tx,done)=>{
      const bs=tx.objectStore('boards'),hs=tx.objectStore('headers'),ds=tx.objectStore('drafts'),r=bs.get(b.id);
      r.onsuccess=()=>{
        const old=r.result;
        if(old?.lastOp===m.op){done({board:C.board(old),replay:true});return;}
        if((old?.revision||'')!==expected){ds.put({id:m.draftId,board:b,updatedAt:Date.now()});done({conflict:true,current:old?C.board(old):null,draftId:m.draftId});return;}
        const now=Math.max(Date.now(),(old?.updatedAt||0)+1),out={...b,createdAt:old?.createdAt||now,updatedAt:now,revision:`${now}:${m.op}`};
        bs.put({...out,lastOp:m.op});hs.put(C.header(out));ds.delete(m.draftId);done({board:out});
      };
    });
  }
  async function list(m={}) {
    const limit=Math.max(1,Math.min(50,Number(m.limit)||50));
    return transaction(['headers'],'readonly',(tx,done)=>{
      const out={items:[],cursor:null};done(out);
      const cursor=m.cursor;
      const valid=Array.isArray(cursor)&&cursor.length===2&&Number.isSafeInteger(cursor[0])&&typeof cursor[1]==='string';
      const r=tx.objectStore('headers').index('updated').openCursor(valid?IDBKeyRange.upperBound(cursor,true):null,'prev');
      r.onsuccess=()=>{const c=r.result;if(!c)return;const h=c.value;if(m.includeDeleted||!!h.deleted===!!m.trash){if(out.items.length===limit){const last=out.items.at(-1);out.cursor=[last.updatedAt,last.id];return;}out.items.push(h);}c.continue();};
    });
  }
  async function drafts(m={}) {
    return transaction(['drafts'],'readonly',(tx,done)=>{
      const out={items:[]};done(out);const r=tx.objectStore('drafts').openCursor();
      r.onsuccess=()=>{const c=r.result;if(!c)return;if(!m.boardId||c.value.board.id===m.boardId)out.items.push(m.includeBodies?c.value:{id:c.value.id,updatedAt:c.value.updatedAt,title:c.value.board.title,boardId:c.value.board.id});c.continue();};
    });
  }
  async function getDraft(id) {return transaction(['drafts'],'readonly',(tx,done)=>{const r=tx.objectStore('drafts').get(id);r.onsuccess=()=>done({draft:r.result||null});});}
  async function discard(id) {return transaction(['drafts'],'readwrite',(tx,done)=>{tx.objectStore('drafts').delete(id);done({removed:true});});}
  globalThis.CGRWhiteboardDB={get,save,list,drafts,getDraft,discard};
})();
