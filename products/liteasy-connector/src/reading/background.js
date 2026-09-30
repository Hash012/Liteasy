/* MV3 single writer: acknowledge only after chrome.storage.local.set resolves.
 * No keep-alive timer, no deferred write-behind cache, no network requests. */
importScripts("shared.js", "notes-core.js", "notes-db.js", "canvas-core.js", "whiteboard-db.js");
(() => {
  "use strict";
  const C = CGRCore;
  let tail = Promise.resolve();
  let legacyReady;
  const counters = {reads: 0, writes: 0, failures: 0};
  const get = async (keys) => { counters.reads++; return chrome.storage.local.get(keys); };
  const set = async (items) => { await chrome.storage.local.set(items); counters.writes++; };

  async function allKeys() {
    // getKeys is newer than our minimum browser version. The full read fallback
    // runs ONLY for user-requested maintenance/export or one draft promotion.
    return chrome.storage.local.getKeys ? chrome.storage.local.getKeys() : Object.keys(await get(null));
  }
  function assertKey(key) {
    if (typeof key !== "string" || !C.KEY_RE.test(key)) throw new Error("无效的进度键");
  }
  async function resolveKey(key) {
    assertKey(key);
    const parts = key.split(":");
    if (parts[2].startsWith("d-")) {
      const aliasKey = `${C.PREFIX}alias:${parts[2]}`;
      const target = (await get(aliasKey))[aliasKey];
      if (typeof target === "string" && /^[cs]-[0-9a-f]{16}$/.test(target)) {
        parts[2] = target;
        return parts.join(":");
      }
    }
    return key;
  }
  async function ensureLegacyIndex() {
    if (!legacyReady) {
      legacyReady = (async () => {
        const flag = `${C.PREFIX}legacyReady`;
        if ((await get(flag))[flag]) return;
        const legacy = (await get(C.LEGACY))[C.LEGACY];
        let chunk = Object.create(null), size = 0;
        if (legacy && typeof legacy === "object") {
          for (const [id, entry] of Object.entries(legacy)) {
            if (!/^section:[a-z0-9]+$/.test(id) || typeof entry?.checked !== "boolean") continue;
            chunk[`${C.PREFIX}l:${id}`] = {
              checked: entry.checked,
              t: Number.isSafeInteger(entry.updatedAt) && entry.updatedAt >= 0 ? entry.updatedAt : 0,
              op: "legacy"
            };
            if (++size >= 200) { await set(chunk); chunk = Object.create(null); size = 0; }
          }
        }
        if (size) await set(chunk);
        // Old V1 data is deliberately kept intact for rollback. A failed partial
        // index build can safely restart: writes are deterministic/idempotent.
        await set({[flag]: true});
      })().catch((error) => { legacyReady = undefined; throw error; });
    }
    return legacyReady;
  }
  function validatePatches(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("无效的进度补丁");
    const entries = Object.entries(raw);
    if (entries.length > 10000 || entries.some(([id, e]) => !C.SECTION_RE.test(id) || !C.validEntry(e))) {
      throw new Error("补丁格式或大小不合法");
    }
    return raw;
  }
  async function load(message) {
    const key = await resolveKey(message.key);
    await ensureLegacyIndex();
    const original = (await get(key))[key];
    let record = C.sanitizeRecord(original);
    const requests = Array.isArray(message.legacy) ? message.legacy.slice(0, 10000) : [];
    const missing = requests.filter((r) => C.SECTION_RE.test(r?.id || "") && !record.sections[r.id]);
    const legacyKeys = [...new Set(missing.flatMap((r) =>
      (Array.isArray(r.keys) ? r.keys.slice(0, 6) : []).filter((k) => /^section:[a-z0-9]+$/.test(k)).map((k) => `${C.PREFIX}l:${k}`)))];
    if (legacyKeys.length) {
      const old = await get(legacyKeys);
      const patches = Object.create(null);
      for (const request of missing) {
        for (const k of (Array.isArray(request.keys) ? request.keys.slice(0, 6) : [])) {
          const entry = old[`${C.PREFIX}l:${k}`];
          if (C.validEntry(entry) && C.compare(entry, patches[request.id]) > 0) patches[request.id] = entry;
        }
      }
      if (Object.keys(patches).length) { record = C.merge(record, patches); await set({[key]: record}); }
    }
    return {key, record};
  }
  async function patch(message) {
    const key = await resolveKey(message.key);
    const patches = validatePatches(message.patches);
    const before = (await get(key))[key];
    const record = C.merge(before, patches);
    if (JSON.stringify(before) !== JSON.stringify(record)) await set({[key]: record});
    return {key, record};
  }
  async function promote(message) {
    const {from, to} = message;
    if (!/^d-[0-9a-f]{16}$/.test(from || "") || !/^[cs]-[0-9a-f]{16}$/.test(to || "")) throw new Error("无效的会话迁移");
    const oldKeys = (await allKeys()).filter((k) => k.startsWith(`${C.PREFIX}m:${from}:`));
    const newKeys = oldKeys.map((k) => k.replace(`m:${from}:`, `m:${to}:`));
    const data = await get([...oldKeys, ...newKeys]);
    const updates = {[`${C.PREFIX}alias:${from}`]: to, [`${C.PREFIX}aliasUrl:${from}`]: CGRNotes.safeURL(message.url || "")};
    oldKeys.forEach((k, i) => { updates[newKeys[i]] = C.merge(data[newKeys[i]], C.sanitizeRecord(data[k]).sections); });
    await set(updates);
    if (oldKeys.length) await chrome.storage.local.remove(oldKeys);
    await CGRNotesDB.promote(from, to, message.url || "");
    return {moved: oldKeys.length};
  }
  async function exportData() {
    const data = await get(null);
    const records = Object.fromEntries(Object.entries(data).filter(([k]) => C.KEY_RE.test(k)));
    return {format: "chatgpt-reading-progress", version: 3, exportedAt: new Date().toISOString(), records, legacy: data[C.LEGACY] || {}};
  }
  async function importData(message) {
    const data = message.data;
    if (data?.format !== "chatgpt-reading-progress" || data.version !== 3 || !data.records || typeof data.records !== "object") {
      throw new Error("不是支持的 v3 阅读进度备份文件");
    }
    const input = Object.entries(data.records);
    if (input.length > 50000) throw new Error("备份中的消息数量异常");
    // Validate everything before writing anything; never interpret backup data as code/HTML.
    for (const [key, record] of input) {
      assertKey(key);
      if (record?.v !== 3) throw new Error("备份记录版本错误");
      validatePatches(record.sections);
    }
    const existing = await get(null);
    const updates = Object.create(null);
    for (const [key, record] of input) updates[key] = C.merge(existing[key], record.sections);
    if (data.legacy && typeof data.legacy === "object") {
      const legacy = {...(existing[C.LEGACY] || {})};
      for (const [id, e] of Object.entries(data.legacy)) {
        if (/^section:[a-z0-9]+$/.test(id) && typeof e?.checked === "boolean" && Number.isSafeInteger(e.updatedAt) && e.updatedAt >= 0) {
          if (!legacy[id] || e.updatedAt > legacy[id].updatedAt) {
            legacy[id] = {checked: e.checked, updatedAt: e.updatedAt, heading: String(e.heading || "").slice(0, 240)};
            // Immediately update the sharded legacy lookup as well.
            updates[`${C.PREFIX}l:${id}`] = {checked: e.checked, t: e.updatedAt, op: "legacy"};
          }
        }
      }
      if (Object.keys(legacy).length) updates[C.LEGACY] = legacy;
    }
    const merged = {...existing, ...updates};
    // Conservative UTF-8 estimate; the actual storage API remains authoritative.
    const estimate = new TextEncoder().encode(JSON.stringify(merged)).length;
    if (estimate > chrome.storage.local.QUOTA_BYTES * 0.98) throw new Error("合并后可能超过本地存储配额；未执行导入。请先导出并清理不需要的记录。");
    if (Object.keys(updates).length) await set(updates);
    return {messages: input.length};
  }
  async function stats() {
    const data = await get(null);
    let messages = 0, read = 0, marks = 0;
    for (const [key, value] of Object.entries(data)) {
      if (!C.KEY_RE.test(key)) continue;
      messages++;
      for (const e of Object.values(C.sanitizeRecord(value).sections)) { marks++; if (e.checked) read++; }
    }
    return {messages, marks, read, bytes: await chrome.storage.local.getBytesInUse(null), quota: chrome.storage.local.QUOTA_BYTES,
      legacy: Object.keys(data[C.LEGACY] || {}).length, worker: {...counters}};
  }
  async function clearData() {
    const keys = (await allKeys()).filter((k) => k.startsWith(C.PREFIX) || k === C.LEGACY);
    if (keys.length) await chrome.storage.local.remove(keys);
    legacyReady = undefined;
    return {removed: keys.length};
  }
  function trusted(sender) {
    return sender.id === chrome.runtime.id;
  }
  function optionsOnly(sender) {
    if (!sender.url?.startsWith(chrome.runtime.getURL("options.html"))) throw new Error("请在扩展的备份与存储管理页面执行此操作");
  }
  async function dispatch(message, sender) {
    switch (message.type) {
      case "CGR_LOAD": return load(message);
      case "CGR_PATCH": return patch(message);
      case "CGR_PROMOTE": return promote(message);
      case "CGR_OPTIONS": await chrome.runtime.openOptionsPage(); return {};
      case "CGR_EXPORT": optionsOnly(sender); return exportData();
      case "CGR_IMPORT": optionsOnly(sender); return importData(message);
      case "CGR_STATS": optionsOnly(sender); return stats();
      case "CGR_CLEAR": optionsOnly(sender); return clearData();
      default: throw new Error("未知请求");
    }
  }

  // Annotation management is restricted to our extension pages. ChatGPT gets
  // only the context/open/count APIs; no raw annotation body is injected there.
  function panelOnly(sender) {
    const base=chrome.runtime.getURL('');
    if (!sender.url?.startsWith(base) || !/^(sidebar|options)\.html(?:[?#]|$)/.test(sender.url.slice(base.length))) {
      throw new Error('请在扩展批注侧栏执行此操作');
    }
  }
  function chatSender(sender) {
    if (!sender.tab?.id || !CGRNotes.safeURL(sender.url)) throw new Error('仅限 ChatGPT 页面');
  }
  async function resolveSource(raw) {
    let s=CGRNotes.source(raw);
    if(s.scope.startsWith('d-')) {
      const k=`${C.PREFIX}alias:${s.scope}`, to=(await get(k))[k];
      if(typeof to==='string' && /^[cs]-[0-9a-f]{16}$/.test(to)) {
        s={...s,scope:to,progressKey:s.progressKey.replace(`m:${s.scope}:`,`m:${to}:`)};
        const u=(await get(`${C.PREFIX}aliasUrl:${raw.scope}`))[`${C.PREFIX}aliasUrl:${raw.scope}`];
        if(CGRNotes.safeURL(u))s.url=CGRNotes.safeURL(u);
      }
    }
    return s;
  }
  async function setContext(message,sender) {
    chatSender(sender);
    const context={tabId:sender.tab.id, scope:String(message.context?.scope || ''),
      title:String(message.context?.title || '').slice(0,300), url:CGRNotes.safeURL(sender.url),
      source:message.context?.source ? CGRNotes.source(message.context.source) : null,
      nonce:String(message.context?.nonce || crypto.randomUUID()).slice(0,100)};
    if(message.context?.mode==='whiteboard') {
      context.mode='whiteboard';
      if(message.context?.card){const card=message.context.card;
        if(typeof card.markdown!=='string'||card.markdown.length>CGRCanvas.LIMIT.text)throw new Error('白板片段过长');
        context.card={format:'cgr-card',version:1,markdown:card.markdown,source:CGRNotes.source(card.source||{})};
      }
    }
    if(!CGRNotes.SCOPE.test(context.scope))throw new Error('会话标识不正确');
    if(context.source && context.source.scope!==context.scope)throw new Error('批注会话不匹配');
    await chrome.storage.session.set({[`cgr4:context:${sender.tab.id}`]:context});
    return {context};
  }
  function announce(note) {
    chrome.runtime.sendMessage({type:'CGR_NOTES_CHANGED',scope:note?.source?.scope || '', id:note?.id || ''}).catch(()=>{});
    chrome.tabs?.query({url:'https://chatgpt.com/*'}).then(tabs=>{
      for(const tab of tabs)chrome.tabs.sendMessage(tab.id,{type:'CGR_NOTES_CHANGED',scope:note?.source?.scope || ''}).catch(()=>{});
    }).catch(()=>{});
  }
  async function locate(message) {
    const s=CGRNotes.source(message.source);
    if(!s.url)throw new Error('这条独立批注没有可打开的原会话');
    let tab;
    if(Number.isSafeInteger(message.tabId)) {
      try {const t=await chrome.tabs.get(message.tabId);if(CGRNotes.safeURL(t.url)===s.url)tab=t;}catch{}
    }
    if(!tab)tab=(await chrome.tabs.query({url:s.url+'*'})).find(t=>CGRNotes.safeURL(t.url)===s.url);
    if(!tab) {await chrome.tabs.create({url:s.url});return {opened:true,message:'已打开原会话。页面加载后再次点击“回到原文”定位章节。'};}
    await chrome.tabs.update(tab.id,{active:true});
    try {return await chrome.tabs.sendMessage(tab.id,{type:'CGR_LOCATE_SECTION',source:s});}
    catch {throw new Error('原会话已打开，但插件脚本未就绪；刷新该页面后再次定位。');}
  }
  async function noteDispatch(m,sender) {
    if(m.type==='CGR_CONTEXT_SET')return setContext(m,sender);
    if(m.type==='CGR_NOTE_COUNTS') {chatSender(sender);return CGRNotesDB.counts(m.keys);}
    panelOnly(sender);
    switch(m.type) {
      case 'CGR_CONTEXT_GET': {
        const id=m.tabId;
        if(!Number.isSafeInteger(id))return {context:null};
        const key=`cgr4:context:${id}`, stored=(await chrome.storage.session.get(key))[key];
        if(stored)return {context:stored};
        try {return {context:await chrome.tabs.sendMessage(id,{type:'CGR_CONTEXT_REQUEST'})};}catch{return {context:null};}
      }
      case 'CGR_NOTE_GET': return CGRNotesDB.get(m.id);
      case 'CGR_NOTE_LIST': return CGRNotesDB.list(m);
      case 'CGR_NOTE_SAVE': {
        const result=await CGRNotesDB.save({...m,note:{...m.note,source:await resolveSource(m.note?.source)}});
        if(result.note)announce(result.note);return result;
      }
      case 'CGR_DRAFT_PUT': return CGRNotesDB.putDraft({...m.draft,source:await resolveSource(m.draft?.source)});
      case 'CGR_DRAFT_LIST': return CGRNotesDB.drafts(m);
      case 'CGR_DRAFT_GET': return CGRNotesDB.getDraft(m.id);
      case 'CGR_DRAFT_REMOVE': return CGRNotesDB.removeDraft(m.id);
      case 'CGR_NOTE_IMPORT': {const result=await CGRNotesDB.importNotes(m.data);announce();return result;}
      case 'CGR_NOTE_STATS': return CGRNotesDB.stats();
      case 'CGR_NOTE_CLEAR': {const result=await CGRNotesDB.clear();announce();return result;}
      case 'CGR_NOTE_LOCATE': return locate(m);
      default:throw new Error('未知批注请求');
    }
  }
  const NOTE_TYPES=new Set(['CGR_CONTEXT_SET','CGR_CONTEXT_GET','CGR_NOTE_COUNTS','CGR_NOTE_GET','CGR_NOTE_LIST','CGR_NOTE_SAVE',
    'CGR_DRAFT_PUT','CGR_DRAFT_LIST','CGR_DRAFT_GET','CGR_DRAFT_REMOVE','CGR_NOTE_IMPORT','CGR_NOTE_STATS','CGR_NOTE_CLEAR','CGR_NOTE_LOCATE']);
  chrome.runtime.onMessage.addListener((m,sender,respond)=>{
    if(!trusted(sender) || !m)return;
    if(m.type==='CGR_OPEN_NOTES') {
      try {
        chatSender(sender);
        // Invoke open synchronously during the click message, BEFORE any await
        // or storage queue: otherwise the transient user activation can expire.
        const opened=chrome.sidePanel?.open ? chrome.sidePanel.open({tabId:sender.tab.id}) : Promise.reject(new Error('sidePanel unavailable'));
        const context=setContext(m,sender);
        Promise.all([context,opened.catch(async()=>{
          await chrome.tabs.create({url:chrome.runtime.getURL('sidebar.html')+'?tabId='+sender.tab.id});return {fallback:true};
        })]).then(([c,p])=>respond({ok:true,...c,fallback:!!p?.fallback}),e=>respond({ok:false,error:String(e.message||e)}));
      } catch(e) {respond({ok:false,error:String(e.message||e)});}
      return true;
    }
    if(!NOTE_TYPES.has(m.type))return;
    // IndexedDB serializes overlapping write transactions itself. Do not put
    // full-text search or preview tasks in the reading-progress write queue.
    noteDispatch(m,sender).then(r=>respond({ok:true,...r}),e=>respond({ok:false,error:String(e.message||e)}));
    return true;
  });
  chrome.runtime.onMessage.addListener((m,sender,respond)=>{
    if(!trusted(sender)||!m||!/^CGR_BOARD_(LIST|GET|SAVE|DRAFTS|DRAFT_GET|DRAFT_REMOVE)$/.test(m.type))return;
    (async()=>{
      panelOnly(sender);
      switch(m.type){
        case 'CGR_BOARD_LIST':return CGRWhiteboardDB.list(m);
        case 'CGR_BOARD_GET':return CGRWhiteboardDB.get(m.id);
        case 'CGR_BOARD_DRAFTS':return CGRWhiteboardDB.drafts(m);
        case 'CGR_BOARD_DRAFT_GET':return CGRWhiteboardDB.getDraft(m.id);
        case 'CGR_BOARD_DRAFT_REMOVE':return CGRWhiteboardDB.discard(m.id);
        case 'CGR_BOARD_SAVE':{
          const r=await CGRWhiteboardDB.save(m);
          if(r.board)chrome.runtime.sendMessage({type:'CGR_BOARDS_CHANGED',id:r.board.id,revision:r.board.revision}).catch(()=>{});
          return r;
        }
      }
    })().then(r=>respond({ok:true,...r}),e=>respond({ok:false,error:String(e.message||e)}));return true;
  });
  chrome.tabs?.onRemoved?.addListener(tabId=>chrome.storage.session.remove(`cgr4:context:${tabId}`).catch(()=>{}));
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!trusted(sender) || !message || !/^CGR_(LOAD|PATCH|PROMOTE|OPTIONS|EXPORT|IMPORT|STATS|CLEAR)$/.test(message.type)) return;
    // All reads/merges/writes share one queue. Two tabs cannot overwrite each
    // other's edits to different sections of the same message bucket.
    tail = tail.catch(() => {}).then(() => dispatch(message, sender));
    tail.then((result) => respond({ok: true, ...result}), (error) => {
      counters.failures++;
      console.warn("[CGR]", error);
      respond({ok: false, error: String(error.message || error)});
    });
    return true;
  });
  chrome.sidePanel?.setPanelBehavior({openPanelOnActionClick:true}).catch(() => {});
  chrome.action.onClicked.addListener((tab) => {
    if (!chrome.sidePanel?.open) chrome.tabs.create({url:chrome.runtime.getURL('sidebar.html') + '?tabId=' + tab.id});
  });
})();
