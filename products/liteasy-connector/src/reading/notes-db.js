/* Lazy IndexedDB repository. Transactions, not worker RAM, are authoritative.
 * Metadata and Markdown bodies are separate: ordinary paginated lists never
 * hydrate full notes. Only an explicit full-text search reads candidate bodies. */
(() => {
  'use strict';
  const N = CGRNotes;
  let connection;
  function db() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('cgr-reading-annotations', 1);
      request.onupgradeneeded = () => {
        const d = request.result;
        const notes = d.createObjectStore('notes', {keyPath: 'id'});
        notes.createIndex('updated', ['updatedAt','id']);
        notes.createIndex('scopeUpdated', ['scope','updatedAt','id']);
        notes.createIndex('messageKey', 'messageKey');
        d.createObjectStore('bodies', {keyPath: 'id'});
        d.createObjectStore('drafts', {keyPath: 'id'}).createIndex('updated', ['updatedAt','id']);
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); connection = undefined; };
        resolve(request.result);
      };
      request.onerror = () => { connection = undefined; reject(request.error); };
      request.onblocked = () => { connection = undefined; reject(new Error('批注数据库正在升级，请关闭其他扩展管理页面后重试')); };
    });
    return connection.catch(error => { connection = undefined; throw error; });
  }
  async function transaction(stores, mode, work) {
    const d = await db();
    return new Promise((resolve, reject) => {
      // Acknowledge transaction completion. strict is a durability hint; the
      // browser/OS and device still govern physical persistence guarantees.
      let tx;
      try { tx = d.transaction(stores, mode, mode === 'readwrite' ? {durability:'strict'} : undefined); }
      catch { tx = d.transaction(stores, mode); }
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => {};
      tx.onabort = () => reject(failure || tx.error || new Error('批注事务未完成'));
      try { work(tx, value => { result = value; }, error => { failure = error; tx.abort(); }); }
      catch (error) { failure = error; tx.abort(); }
    });
  }
  function compose(h, b) {
    if (!h) return null;
    const {preview, chars, scope, messageKey, lastOp, ...n} = h;
    return {...n, markdown: b?.markdown || ''};
  }
  async function get(id) {
    if (!N.ID.test(id || '')) throw new Error('批注标识不正确');
    return transaction(['notes','bodies'], 'readonly', (tx, done) => {
      const a = tx.objectStore('notes').get(id), b = tx.objectStore('bodies').get(id);
      b.onsuccess = () => done({note: compose(a.result, b.result)});
    });
  }
  async function save(message) {
    const input = N.note(message.note), expected = String(message.expectedRevision || '');
    if (!N.ID.test(message.op || '')) throw new Error('保存操作标识不正确');
    return transaction(['notes','bodies','drafts'], 'readwrite', (tx, done) => {
      const hs = tx.objectStore('notes'), bs = tx.objectStore('bodies'), ds = tx.objectStore('drafts');
      const request = hs.get(input.id);
      request.onsuccess = () => {
        const old = request.result;
        if (old?.lastOp === message.op) {
          const body = bs.get(input.id); body.onsuccess = () => done({note: compose(old, body.result), replay: true}); return;
        }
        if ((old?.revision || '') !== expected) {
          const body = bs.get(input.id);
          body.onsuccess = () => done({conflict: true, current: compose(old, body.result)}); return;
        }
        const now = Math.max(Date.now(), (old?.updatedAt || 0) + 1);
        const n = {...input, createdAt: old?.createdAt || now, updatedAt: now, revision: `${now}:${message.op}`};
        hs.put({...N.header(n), lastOp: message.op}); bs.put({id:n.id, markdown:n.markdown});
        if (N.ID.test(message.draftId || '')) {
          const draft = ds.get(message.draftId);
          draft.onsuccess = () => { if (draft.result?.token === message.draftToken) ds.delete(message.draftId); };
        }
        done({note: n});
      };
    });
  }
  async function list(message = {}) {
    const filter = message.filter || {}, scope = filter.scope || '';
    if (scope && !N.SCOPE.test(scope)) throw new Error('会话筛选无效');
    const q = String(filter.query || '').trim().toLocaleLowerCase().slice(0, 200);
    const limit = Math.min(50, Math.max(1, Number(message.limit) || 30));
    const cursor = message.cursor;
    if (cursor && (!Number.isSafeInteger(cursor.time) || !N.ID.test(cursor.id || ''))) throw new Error('分页游标无效');
    const maxScan = 500, exporting = !!message.includeBodies;
    return transaction(['notes','bodies'], 'readonly', (tx, done) => {
      const notes = tx.objectStore('notes'), bodies = tx.objectStore('bodies');
      const index = notes.index(scope ? 'scopeUpdated' : 'updated');
      const upper = cursor ? (scope ? [scope,cursor.time,cursor.id] : [cursor.time,cursor.id]) :
        (scope ? [scope,Number.MAX_SAFE_INTEGER,'\uffff'] : [Number.MAX_SAFE_INTEGER,'\uffff']);
      const range = scope ? IDBKeyRange.bound([scope,0,''], upper, false, !!cursor) : IDBKeyRange.upperBound(upper, !!cursor);
      const result = [], req = index.openCursor(range, 'prev');
      let scanned = 0, last = null;
      const finish = next => done({items:result, cursor:next, scanned});
      req.onsuccess = () => {
        const c = req.result;
        if (!c) { finish(null); return; }
        const h = c.value; scanned++; last = {time:h.updatedAt, id:h.id};
        const next = () => { if (result.length >= limit || scanned >= maxScan) finish(last); else c.continue(); };
        if ((!filter.includeDeleted && !!h.deleted !== !!filter.trash) || (filter.pinned && !h.pinned) ||
          (filter.sectionId && h.source.sectionId !== filter.sectionId) ||
          (filter.messageKey && h.messageKey !== filter.messageKey) ||
          (filter.tag && !h.tags.includes(filter.tag))) { next(); return; }
        const metadataMatch = !q || [h.title,h.preview,h.source.title,h.source.heading,h.source.quote,...h.tags].join('\n').toLocaleLowerCase().includes(q);
        if (exporting || !metadataMatch) {
          const b = bodies.get(h.id);
          b.onsuccess = () => {
            if (metadataMatch || (b.result?.markdown || '').toLocaleLowerCase().includes(q)) result.push(exporting ? compose(h,b.result) : h);
            next();
          };
        } else { result.push(h); next(); }
      };
    });
  }
  async function counts(keys) {
    const wanted = [...new Set((keys || []).filter(k => CGRCore.KEY_RE.test(k)))].slice(0, 10);
    return transaction(['notes'], 'readonly', (tx, done) => {
      const result = {}; done({counts:result});
      for (const key of wanted) {
        const bucket = result[key] = {};
        const req = tx.objectStore('notes').index('messageKey').openCursor(IDBKeyRange.only(key));
        req.onsuccess = () => {
          const c = req.result; if (!c) return;
          if (!c.value.deleted) bucket[c.value.source.sectionId] = (bucket[c.value.source.sectionId] || 0) + 1;
          c.continue();
        };
      }
    });
  }
  async function putDraft(raw) {
    const d = N.draft(raw);
    return transaction(['drafts'], 'readwrite', (tx, done) => { tx.objectStore('drafts').put(d); done({saved:true,token:d.token}); });
  }
  async function drafts(message = {}) {
    const limit=Math.min(50,Math.max(1,Number(message.limit)||30)), after=message.cursor;
    if(after && (!Number.isSafeInteger(after.time)||!N.ID.test(after.id||'')))throw new Error('草稿游标无效');
    return transaction(['drafts'], 'readonly', (tx, done) => {
      const store=tx.objectStore('drafts'), result={drafts:[],cursor:null,total:0};done(result);
      const count=store.count();count.onsuccess=()=>{result.total=count.result;};
      const range=after?IDBKeyRange.upperBound([after.time,after.id],true):undefined;
      const req=store.index('updated').openCursor(range,'prev');
      req.onsuccess=()=>{
        const c=req.result;if(!c)return;
        if(message.metadataOnly){const {markdown,...header}=c.value;result.drafts.push({...header,chars:markdown.length});}
        else result.drafts.push(c.value);
        if(result.drafts.length>=limit)result.cursor={time:c.value.updatedAt,id:c.value.id};else c.continue();
      };
    });
  }
  async function getDraft(id) {
    if(!N.ID.test(id||''))throw new Error('草稿标识不正确');
    return transaction(['drafts'],'readonly',(tx,done)=>{const r=tx.objectStore('drafts').get(id);r.onsuccess=()=>done({draft:r.result||null});});
  }
  async function removeDraft(id) {
    if (!N.ID.test(id || '')) throw new Error('草稿标识不正确');
    return transaction(['drafts'], 'readwrite', (tx, done) => {tx.objectStore('drafts').delete(id); done({removed:true});});
  }
  async function stats() {
    return transaction(['notes','drafts'], 'readonly', (tx, done) => {
      const result = {active:0,trash:0,characters:0,drafts:0}; done(result);
      const req = tx.objectStore('notes').openCursor();
      req.onsuccess = () => { const c = req.result; if (!c) return; result[c.value.deleted?'trash':'active']++; result.characters+=c.value.chars; c.continue(); };
      const d = tx.objectStore('drafts').count(); d.onsuccess = () => { result.drafts = d.result; };
    });
  }
  async function promote(from, to, url) {
    return transaction(['notes','drafts'], 'readwrite', (tx, done) => {
      let count = 0; done({moved:0});
      const transform = s => ({...s, scope:to, progressKey:s.progressKey.replace(`m:${from}:`,`m:${to}:`), url:N.safeURL(url) || s.url});
      const r = tx.objectStore('notes').index('scopeUpdated').openCursor(IDBKeyRange.bound([from,0,''],[from,Number.MAX_SAFE_INTEGER,'\uffff']));
      r.onsuccess = () => { const c=r.result;if(!c)return;const n=c.value;n.source=transform(n.source);n.scope=to;n.messageKey=n.source.progressKey;c.update(n);count++;done({moved:count});c.continue(); };
      const d = tx.objectStore('drafts').openCursor();
      d.onsuccess = () => {const c=d.result;if(!c)return;if(c.value.source.scope===from)c.update({...c.value,source:transform(c.value.source)});c.continue();};
    });
  }
  function validateImport(data) {
    if (data?.format !== 'chatgpt-reading-annotations' || data.version !== 1 || !Array.isArray(data.notes) || data.notes.length > 50000) throw new Error('不是支持的批注 JSON 备份');
    const notes = data.notes.map(n=>N.note(n,true));
    if (new Set(notes.map(n=>n.id)).size !== notes.length) throw new Error('备份中含重复的批注 ID');
    return notes;
  }
  async function importNotes(data) {
    const incoming = validateImport(data);
    // All input is validated before any write. The entire batch is atomic.
    return transaction(['notes','bodies'], 'readwrite', (tx, done) => {
      const hs=tx.objectStore('notes'), bs=tx.objectStore('bodies');
      const result={added:0,copies:0,skipped:0,deleted:0}; done(result);
      for (const n of incoming) {
        const a=hs.get(n.id);
        a.onsuccess=()=>{
          const old=a.result;
          const write=(v)=>{hs.put(N.header(v));bs.put({id:v.id,markdown:v.markdown});};
          if(!old){write(n);result.added++;return;}
          if(old.revision===n.revision){result.skipped++;return;}
          if(old.deleted && n.updatedAt<=old.updatedAt){result.skipped++;return;}
          const b=bs.get(n.id);
          b.onsuccess=()=>{
            if(n.deleted){
              if(n.updatedAt>old.updatedAt){write({...compose(old,b.result),deleted:true,updatedAt:n.updatedAt,revision:n.revision});result.deleted++;}
              else result.skipped++;
              return;
            }
            if(!old.deleted && n.markdown===(b.result?.markdown||'') && n.title===old.title && JSON.stringify(n.tags)===JSON.stringify(old.tags)){result.skipped++;return;}
            // Import never silently replaces a different locally edited note.
            // Deterministic copy ID makes importing the same conflict idempotent.
            const id=`import-${CGRCore.hash(n.id+'|'+n.revision+'|'+n.markdown)}`;
            const other=hs.get(id);
            other.onsuccess=()=>{
              if(other.result){result.skipped++;return;}
              write({...n,id,title:(n.title+'（导入副本）').slice(0,300),deleted:false});result.copies++;
            };
          };
        };
      }
    });
  }
  async function clear() {
    return transaction(['notes','bodies','drafts'], 'readwrite', (tx,done)=>{
      for(const s of ['notes','bodies','drafts'])tx.objectStore(s).clear();done({cleared:true});
    });
  }
  globalThis.CGRNotesDB = {get,save,list,counts,putDraft,drafts,getDraft,removeDraft,stats,promote,validateImport,importNotes,clear};
})();
