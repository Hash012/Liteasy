/* ChatGPT Reading Progress v0.5 — event-driven, two-level viewport rendering. */
(() => {
  "use strict";
  if (globalThis.__CGR3_STARTED__) return;
  globalThis.__CGR3_STARTED__ = true;
  const C = CGRCore;
  const ROLE = '[data-message-author-role="assistant"], [data-role="assistant"], [data-author="assistant"]';
  const HEAD = 'h1,h2,h3,h4,h5,h6';
  const TURN = '[data-testid^="conversation-turn-"], [data-testid="conversation-turn"], [data-turn-id]';
  const OWN = '[data-cgr-owned]';
  const LIMIT = Object.freeze({activeTurns: 24, mountedControls: 240, cachedMessages: 64, sliceMs: 6,
    parseThrottleMs: 350, turnMarginPx: 2400, headingMarginPx: 1600, retainMarginPx: 3200, styledBlocks: 256});
  const client = crypto.randomUUID();
  let draft = crypto.randomUUID(), scope = C.scope(location.pathname, draft), path = location.pathname;
  let generation = 0, uid = 0, opSequence = 0, logicalTime = 0, stopped = false;
  let routeQueued = false, suspended = document.hidden, scrollRoot = null;
  let pageObserver, turnObserver, headingObserver, idleHandle = 0, scrollTimer = 0;
  let taskSerial = 0, storageEpoch = 0;
  const turns = new Map(), active = new Set(), nearTurns = new Set(), mounted = new Set();
  const headingOwners = new WeakMap(), inputs = new WeakMap(), blocked = new WeakMap();
  const tasks = new Map(), parseTimers = new Map(), cache = new Map(), loads = new Map(), pending = new Map();
  const touchedDraftScopes = new Set();
  const stats = {fullDiscoveries: 0, subtreeDiscoveries: 0, parsedTurns: 0, headingReconciliations: 0,
    schedulerSlices: 0, maxSliceMs: 0, mutationBatches: 0, ignoredOwnMutations: 0, storageLoads: 0,
    saveRequests: 0, saveFailures: 0, controlsCreated: 0, controlsRemoved: 0};
  let summary, summaryText, saveText, detail, detailPre, lastError = "";

  const elementOf = (node) => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const text = (node) => {
    if (!node) return '';
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement?.closest(OWN) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let value = '', n;
    while ((n = walker.nextNode())) value += n.data;
    return C.normalize(value);
  };
  const isOwnedNode = (node) => node?.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-cgr-owned');
  function ownMutation(m) {
    if (elementOf(m.target)?.closest(OWN)) return true;
    return m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length) &&
      [...m.addedNodes, ...m.removedNodes].every(isOwnedNode);
  }
  function rpc(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error || !response?.ok) reject(new Error(error?.message || response?.error || '扩展后台未响应'));
          else resolve(response);
        });
      } catch (error) { reject(error); }
    });
  }
  function report(error) {
    lastError = String(error?.message || error);
    console.warn('[CGR]', lastError);
    if (/context invalidated|Extension context|extension has been/i.test(lastError)) {
      lastError = '扩展已更新，请刷新本页';
      stopped = true;
      suspendWork();
    }
    queueSummary();
  }

  // ---- Cooperative work queue: no idle polling, no whole-page periodic scan. ----
  function enqueue(key, work) {
    if (stopped || suspended || tasks.has(key)) return;
    tasks.set(key, work);
    scheduleSlice();
  }
  function scheduleSlice() {
    if (idleHandle || stopped || suspended || !tasks.size) return;
    idleHandle = window.requestIdleCallback ? requestIdleCallback(runSlice, {timeout: 200}) :
      setTimeout(() => runSlice({timeRemaining: () => LIMIT.sliceMs}), 24);
  }
  function runSlice(deadline) {
    idleHandle = 0;
    if (stopped || suspended) return;
    const start = performance.now();
    let steps = 0;
    while (tasks.size && (steps === 0 || (performance.now() - start < LIMIT.sliceMs && deadline.timeRemaining() > 1))) {
      const [key, work] = tasks.entries().next().value;
      try {
        if (typeof work === 'function') { tasks.delete(key); work(); }
        else { const step = work.next(); if (step.done && tasks.get(key) === work) tasks.delete(key); }
      } catch (error) { tasks.delete(key); report(error); }
      steps++;
    }
    stats.schedulerSlices++;
    stats.maxSliceMs = Math.max(stats.maxSliceMs, performance.now() - start);
    scheduleSlice();
  }
  function cancelIdle() {
    if (idleHandle) {
      if (window.cancelIdleCallback) cancelIdleCallback(idleHandle); else clearTimeout(idleHandle);
    }
    idleHandle = 0;
    tasks.clear();
  }

  // ---- Bounded data cache. Only nearby messages are loaded from storage. ----
  function cacheGet(key) {
    const value = cache.get(key);
    if (value) { cache.delete(key); cache.set(key, value); }
    return value;
  }
  function cachePut(key, record, ids, replace = false) {
    const old = cache.get(key);
    const value = {record: replace ? C.sanitizeRecord(record) : C.merge(old?.record, record?.sections),
      legacyIds: new Set([...(old?.legacyIds || []), ...(ids || [])])};
    cache.delete(key); cache.set(key, value);
    while (cache.size > LIMIT.cachedMessages) cache.delete(cache.keys().next().value);
    return value;
  }
  function currentEntry(rec, section) {
    const saved = rec.record?.sections[section.id];
    const unsaved = pending.get(`${rec.key}/${section.id}`)?.entry;
    return C.compare(unsaved, saved) > 0 ? unsaved : saved;
  }
  function refreshKey(key) {
    const value = cache.get(key);
    for (const rec of active) {
      if (rec.key !== key) continue;
      if (value) rec.record = value.record;
      for (const section of rec.sections.values()) if (section.control) paint(section);
    }
    queueSummary();
  }
  async function hydrate(rec) {
    if (!rec.active || !rec.key || rec.loading) return;
    const key = rec.key, token = generation, epoch = storageEpoch;
    const cached = cacheGet(key);
    const missing = [...rec.sections.values()].filter((s) => !cached?.legacyIds.has(s.id));
    if (cached && !missing.length) {
      rec.record = cached.record; rec.loaded = true; refreshKey(key); return;
    }
    rec.loading = true;
    let success = false;
    try {
      let load = loads.get(key);
      if (!load) {
        stats.storageLoads++;
        const legacy = missing.map((s) => ({id: s.id, keys: s.legacy}));
        load = rpc({type: 'CGR_LOAD', key, legacy}).then((result) => {
          if (token === generation && epoch === storageEpoch) cachePut(key, result.record, missing.map((s) => s.id));
          return result;
        });
        loads.set(key, load);
        load.finally(() => { if (loads.get(key) === load) loads.delete(key); }).catch(() => {});
      }
      await load; success = true;
      if (token !== generation || epoch !== storageEpoch || !rec.active || rec.key !== key) return;
      rec.record = cache.get(key)?.record || C.emptyRecord();
      rec.loaded = true;
      refreshKey(key);
    } catch (error) {
      if (token === generation) { rec.loaded = false; report(error); }
    } finally {
      rec.loading = false;
      if (success && token === generation && rec.active && [...rec.sections.values()].some((s) => !cache.get(rec.key)?.legacyIds.has(s.id))) {
        enqueue(`hydrate-${rec.uid}`, () => hydrate(rec));
      }
    }
  }
  function newEntry(checked, previous) {
    logicalTime = Math.max(Date.now(), logicalTime + 1, (previous?.t || 0) + 1);
    return {checked, t: logicalTime, op: `${client}:${String(++opSequence).padStart(10, '0')}`};
  }
  function persist(key, patches, retry = 0) {
    const epoch = storageEpoch;
    const batch = Object.entries(patches);
    for (const [id, entry] of batch) {
      const pendingKey = `${key}/${id}`, old = pending.get(pendingKey);
      if (!old || C.compare(entry, old.entry) >= 0) {
        if (old?.timer) clearTimeout(old.timer);
        pending.set(pendingKey, {key, id, entry, failed: false, retry, timer: 0});
      }
    }
    if (key.includes(':m:d-')) touchedDraftScopes.add(key.split(':')[2]);
    stats.saveRequests++;
    queueSummary();
    // Send immediately; do not wait for a debounce timer or unload event.
    rpc({type: 'CGR_PATCH', key, patches}).then((result) => {
      for (const [id, entry] of batch) {
        const pendingKey = `${key}/${id}`;
        if (C.compare(pending.get(pendingKey)?.entry, entry) === 0) pending.delete(pendingKey);
      }
      if (epoch === storageEpoch && result.key.startsWith(`${C.PREFIX}m:${scope}:`)) {
        cachePut(result.key, result.record);
        refreshKey(result.key);
      }
      if (![...pending.values()].some((p) => p.failed)) lastError = '';
      queueSummary();
    }).catch((error) => {
      stats.saveFailures++;
      for (const [id, entry] of batch) {
        const item = pending.get(`${key}/${id}`);
        if (!item || C.compare(item.entry, entry) !== 0) continue;
        item.failed = true;
        if (retry < 3 && !stopped && !/quota|配额|context invalidated/i.test(String(error))) {
          item.timer = setTimeout(() => {
            item.timer = 0;
            if (pending.get(`${key}/${id}`) === item) persist(key, {[id]: entry}, retry + 1);
          }, [1000, 3000, 10000][retry]);
        }
      }
      report(error);
    });
  }
  function retryFailed() {
    lastError = '';
    const batches = new Map();
    for (const p of pending.values()) if (p.failed) {
      if (!batches.has(p.key)) batches.set(p.key, {});
      batches.get(p.key)[p.id] = p.entry;
    }
    for (const [key, patches] of batches) persist(key, patches);
    for (const rec of active) if (!rec.loaded) hydrate(rec);
    queueSummary();
  }

  // ---- Stable identities and compatibility with v0.1 / v0.2 saved sections. ----
  function boundedPrefix(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest(`${OWN},script,style`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let value = '', node;
    while (value.length < 240 && (node = walker.nextNode())) value += node.data.slice(0, 240 - value.length) + ' ';
    return C.normalize(value).slice(0, 180);
  }
  function messageIdentity(root) {
    const ownId = root.getAttribute('data-message-id');
    if (ownId) return {value: `message:${ownId}`, stable: true};
    const ancestor = root.closest('[data-message-id]');
    if (ancestor) return {value: `message:${ancestor.getAttribute('data-message-id')}`, stable: true};
    const turn = root.closest(TURN);
    const turnId = turn?.getAttribute('data-turn-id');
    if (turnId) return {value: `turn:${turnId}`, stable: true};
    const tag = turn?.getAttribute('data-testid') || 'no-turn';
    return {value: `fallback:${tag}:${C.hash(boundedPrefix(root))}`, stable: false};
  }
  function legacyTurns(rec) {
    const closest = rec.root.closest('article[data-testid], [data-testid^="conversation-turn-"], [data-turn-id], [data-message-id]');
    const turn = rec.root.closest(TURN);
    const derive = (node) => node?.getAttribute('data-turn-id') || node?.getAttribute('data-message-id') || node?.getAttribute('data-testid');
    return [...new Set([derive(closest), derive(turn), rec.root.getAttribute('data-message-id'),
      `assistant-${rec.order}-${C.fnv(boundedPrefix(rec.root)).toString(36)}`].filter(Boolean))];
  }
  function legacyKeys(rec, groupIndex, headingIndex, stack, headingText) {
    const headingPath = stack.map((s, i) => s.text.slice(0, i === stack.length - 1 ? 140 : 100));
    return rec.legacyTurns.map((turnKey) => 'section:' + C.fnv(JSON.stringify({
      pageKey: `${location.origin}${path}`, turnKey, contentGroupIndex: groupIndex,
      headingIndex, headingPath, headingText: headingText.slice(0, 240)
    })).toString(36));
  }
  function contentRoot(heading, root) {
    const markdown = heading.closest('.markdown, .prose, [data-message-content]');
    return markdown && root.contains(markdown) ? markdown : root;
  }

  // ---- Discover ONLY new subtrees; turn/heading observers do viewport selection. ----
  function findScrollRoot(root) {
    for (let node = root.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1 &&
          /(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) return node;
    }
    return null;
  }
  function initIntersection(root) {
    if (turnObserver) return;
    scrollRoot = findScrollRoot(root);
    turnObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const rec = turns.get(e.target);
        if (!rec) continue;
        if (e.isIntersecting) nearTurns.add(rec); else nearTurns.delete(rec);
      }
      enqueue('balance-turns', balanceTurns);
    }, {root: scrollRoot, rootMargin: `${LIMIT.turnMarginPx}px 0px`, threshold: 0});
    headingObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const section = headingOwners.get(e.target);
        if (section && section.rec.active) section.near = e.isIntersecting;
      }
      enqueue('balance-headings', balanceHeadings);
    }, {root: scrollRoot, rootMargin: `${LIMIT.headingMarginPx}px 0px`, threshold: 0});
  }
  function register(root) {
    if (!root.isConnected || turns.has(root) || root.closest(OWN) || !root.closest('main')) return;
    const old = blocked.get(root);
    if (old && old === messageIdentity(root).value) return;
    blocked.delete(root);
    initIntersection(root);
    const rec = {root, uid: ++uid, order: turns.size, active: false, sections: new Map(),
      revision: 0, lastParsed: 0, parsed: false, key: '', stable: true, loaded: false, loading: false, record: null};
    turns.set(root, rec);
    turnObserver.observe(root);
  }
  function* discover(node, full = false) {
    if (!node?.isConnected) return;
    if (full) stats.fullDiscoveries++; else stats.subtreeDiscoveries++;
    if (node.nodeType === Node.ELEMENT_NODE && node.matches(ROLE)) register(node);
    let count = 0;
    for (const root of node.querySelectorAll(ROLE)) { register(root); if (++count % 12 === 0) yield; }
  }
  function enqueueDiscovery(node, full = false) {
    if (!node?.querySelectorAll || node.closest?.(OWN)) return;
    enqueue(full ? 'discover-full' : `discover-${++taskSerial}`, discover(node, full));
  }
  function rangeDistance(rect, bounds) {
    if (rect.bottom < bounds.top) return bounds.top - rect.bottom;
    if (rect.top > bounds.bottom) return rect.top - bounds.bottom;
    return 0;
  }
  function viewportBounds() {
    return scrollRoot?.isConnected ? scrollRoot.getBoundingClientRect() : {top: 0, bottom: innerHeight};
  }
  function balanceTurns() {
    const bounds = viewportBounds();
    // Soft limits: never evict an actually visible/focused reply. Add active
    // replies to avoid a stale IntersectionObserver delivery causing a flash.
    const candidates = [...new Set([...nearTurns, ...active])].filter(r=>r.root.isConnected).map(rec=>{
      const rect=rec.root.getBoundingClientRect(), distance=rangeDistance(rect,bounds);
      return {rec,distance,top:rect.top,pinned:distance===0||rec.root.contains(document.activeElement)};
    }).filter(c=>c.pinned||c.distance<=(c.rec.active?LIMIT.retainMarginPx:LIMIT.turnMarginPx))
      .sort((a,b)=>Number(b.pinned)-Number(a.pinned)||a.distance-b.distance||Math.abs(a.top-bounds.top)-Math.abs(b.top-bounds.top));
    const selected=new Set(candidates.filter(c=>c.pinned).map(c=>c.rec));
    for(const c of candidates)if(selected.size<LIMIT.activeTurns)selected.add(c.rec);
    for(const rec of active)if(!selected.has(rec))deactivate(rec);
    for(const rec of selected)if(!rec.active){rec.active=true;active.add(rec);requestParse(rec,true);}
    queueSummary();
  }
  function requestParse(rec, immediate = false) {
    rec.revision++;
    if (!rec.active || !rec.root.isConnected || parseTimers.has(rec)) return;
    const delay = immediate ? 0 : Math.max(0, LIMIT.parseThrottleMs - (performance.now() - rec.lastParsed));
    if (!delay) enqueue(`parse-${rec.uid}`, parseTurn(rec));
    else parseTimers.set(rec, setTimeout(() => {
      parseTimers.delete(rec);
      if (rec.active) enqueue(`parse-${rec.uid}`, parseTurn(rec));
    }, delay));
  }
  function* parseTurn(rec) {
    if (!rec.active || !rec.root.isConnected) return;
    const revision = rec.revision;
    const identity = messageIdentity(rec.root);
    const key = C.key(scope, identity.value);
    if (!rec.parsed || (rec.key && rec.key !== key)) {
      // Remove copied enhancement attributes from a fresh host subtree. They
      // are not persisted state and may belong to another route/old render.
      for (const node of rec.root.querySelectorAll('[data-cgr3-read],.cgr3-preview,[data-cgr-owned="control"]')) {
        if (node.closest(ROLE) !== rec.root) continue;
        if (node.matches('[data-cgr-owned="control"]')) node.remove();
        else { node.removeAttribute('data-cgr3-read'); node.classList.remove('cgr3-preview'); }
      }
    }
    if (rec.key && rec.key !== key) {
      for (const section of rec.sections.values()) disposeSection(section);
      rec.sections.clear(); rec.loaded = false; rec.record = null;
    }
    rec.key = key; rec.stable = identity.stable; rec.legacyTurns = legacyTurns(rec);
    const groups = new Map();
    let count = 0;
    // Own each heading by its nearest role marker, not by a global outermost
    // assistant wrapper. Later/nested replies cannot be swallowed by the first.
    for (const heading of rec.root.querySelectorAll(HEAD)) {
      if (heading.closest(ROLE) !== rec.root || heading.closest('pre,code,svg')) continue;
      const group = contentRoot(heading, rec.root);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(heading);
      if (++count % 32 === 0) yield;
    }
    if (!rec.active) return;
    const found = new Set();
    let groupIndex = 0;
    for (const [root, headings] of groups) {
      const stack = [], duplicatePaths = new Map();
      for (let index = 0; index < headings.length; index++) {
        if (!rec.active) return;
        const heading = headings[index], level = Number(heading.tagName.slice(1)), headingText = text(heading);
        if (!headingText) continue;
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        stack.push({level, text: headingText});
        const pathKey = JSON.stringify([groupIndex, stack.map((p) => [p.level, p.text])]);
        const occurrence = duplicatePaths.get(pathKey) || 0;
        duplicatePaths.set(pathKey, occurrence + 1);
        const id = C.hash(`${pathKey}:${occurrence}`);
        let section = rec.sections.get(heading);
        if (section && section.id !== id) { disposeSection(section); section = null; }
        if (!section) {
          section = {rec, heading, id, root, next: null, near: false, control: null, blocks: null, preview: false};
          rec.sections.set(heading, section);
          headingOwners.set(heading, section);
          headingObserver.observe(heading);
        }
        const next = headings[index + 1] || null;
        if (section.next !== next || section.root !== root) { clearBlocks(section); section.next = next; section.root = root; }
        section.headingIndex = index; section.headingText = headingText;
        section.legacy = legacyKeys(rec, groupIndex, index, stack, headingText);
        found.add(heading);
        if (section.control) paint(section);
        stats.headingReconciliations++;
        if (index % 8 === 7) yield;
      }
      groupIndex++;
    }
    for (const [heading, section] of rec.sections) if (!found.has(heading)) {
      disposeSection(section); rec.sections.delete(heading);
    }
    rec.parsed = true; rec.lastParsed = performance.now(); stats.parsedTurns++;
    hydrate(rec);
    enqueue('note-counts', loadNoteCounts);
    enqueue('balance-headings', balanceHeadings);
    queueSummary();
    if (revision !== rec.revision) {
      // The current generator still occupies its queue key. Schedule the next
      // pass as a separate task, avoiding a lost invalidation during streaming.
      enqueue(`reparse-${rec.uid}`, () => requestParse(rec));
    }
  }
  function balanceHeadings() {
    const bounds=viewportBounds(), candidates=[], rects=new Map();
    const rect=node=>{if(!rects.has(node))rects.set(node,node.getBoundingClientRect());return rects.get(node);};
    // A section ends at the next heading, NOT at its own heading's bottom.
    // Reading a long code block/table must not clear its already-read style.
    for(const rec of active)for(const section of rec.sections.values()) {
      if(!section.heading.isConnected)continue;
      const h=rect(section.heading),end=section.next?.isConnected?rect(section.next).top:rect(section.root).bottom;
      const distance=rangeDistance({top:h.top,bottom:Math.max(h.bottom,end)},bounds);
      const pinned=distance===0||!!section.control?.contains(document.activeElement);
      if(pinned||distance<=(section.control?LIMIT.retainMarginPx:LIMIT.headingMarginPx))
        candidates.push({section,distance,top:h.top,pinned});
    }
    candidates.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||a.distance-b.distance||Math.abs(a.top-bounds.top)-Math.abs(b.top-bounds.top));
    const chosen=new Set(candidates.filter(c=>c.pinned).map(c=>c.section));
    for(const c of candidates)if(chosen.size<LIMIT.mountedControls)chosen.add(c.section);
    // Read geometry above; write DOM below. Avoid interleaved layout thrashing.
    for(const s of mounted)if(!chosen.has(s))unmount(s,true);
    for(const s of chosen)if(!s.control)mount(s);
    queueSummary();
  }
  function deactivate(rec) {
    if (!rec.active) return;
    rec.active = false; active.delete(rec);
    tasks.delete(`parse-${rec.uid}`); tasks.delete(`reparse-${rec.uid}`); tasks.delete(`body-${rec.uid}`);
    if (parseTimers.has(rec)) { clearTimeout(parseTimers.get(rec)); parseTimers.delete(rec); }
    for (const s of rec.sections.values()) disposeSection(s,true);
    rec.sections.clear(); rec.record = null; rec.loaded = false; rec.noteCounts = null; rec.countsLoaded = false;
  }
  function sweepDisconnected() {
    for (const [root, rec] of turns) if (!root.isConnected) {
      deactivate(rec); turnObserver?.unobserve(root); nearTurns.delete(rec); turns.delete(root);
    }
    if (scrollRoot && !scrollRoot.isConnected) {
      resetObservers(); enqueueDiscovery(document, true);
    }
  }

  // ---- Minimal light-DOM controls; no response wrapper/innerHTML rewrites. ----
  function clearBlocks(s) {
    if (s.blocks) for (const block of s.blocks) {
      block.removeAttribute('data-cgr3-read'); block.classList.remove('cgr3-preview');
    }
    s.blocks = null;
  }
  function blocksFor(s) {
    const directChild = (node) => {
      let current = node;
      while (current?.parentElement && current.parentElement !== s.root) current = current.parentElement;
      return current?.parentElement === s.root ? current : node;
    };
    const start = directChild(s.heading), end = s.next ? directChild(s.next) : null;
    if (start === end) return []; // Never fade a wrapper containing the next section.
    const blocks = [];
    for (let node = start; node && node !== end; node = node.nextElementSibling) {
      if (blocks.length >= LIMIT.styledBlocks) return []; // Huge section: style only its heading.
      if (node !== s.heading && !node.contains(s.heading) && !node.matches(OWN)) blocks.push(node);
    }
    return blocks;
  }
  function paint(s) {
    if (!s.control) return;
    const wasRead = s.heading.hasAttribute('data-cgr3-read');
    const checked = s.rec.loaded ? !!currentEntry(s.rec, s)?.checked : s.heading.hasAttribute('data-cgr3-read');
    const input = s.control.firstElementChild;
    input.checked = checked; input.indeterminate = !s.rec.loaded; input.disabled = !s.rec.loaded || stopped;
    s.control.title = !s.rec.loaded ? '正在读取本地进度；读取成功后才能勾选' : checked ? '取消本节已读标记' : '标记本节为已读';
    const note = s.control.querySelector('.cgr4-note-button');
    if (note) {
      const count = s.rec.noteCounts?.[s.id] || 0;
      note.dataset.count = count ? String(count) : '';
      note.classList.toggle('has-notes', count > 0);
      note.title = count ? `本节已有 ${count} 条批注；点击打开侧栏` : '为这一节写 Markdown 批注（先选中文字可带入摘录）';
    }
    s.heading.toggleAttribute('data-cgr3-read', checked);
    if (checked || s.preview) {
      if (!s.blocks) s.blocks = blocksFor(s);
      for (const b of s.blocks) { b.toggleAttribute('data-cgr3-read', checked); b.classList.toggle('cgr3-preview', s.preview); }
    } else {
      // Restored sections may carry the last visible style but no cached block
      // references. A remote uncheck must clear that retained style on hydrate.
      if(!s.blocks && wasRead)s.blocks=blocksFor(s);
      clearBlocks(s);
    }
  }
  function mount(s) {
    if (!s.heading.isConnected || s.control) return;
    // React/DOM cloning can copy a stale injected label without its WeakMap
    // metadata. Never mistake that copied node for a live, managed control.
    s.heading.querySelectorAll(':scope > [data-cgr-owned="control"]').forEach((node) => node.remove());
    const label = document.createElement('span');
    label.className = 'cgr3-control'; label.dataset.cgrOwned = 'control';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.className = 'cgr3-checkbox';
    checkbox.setAttribute('aria-label', `本节已读：${text(s.heading).slice(0, 180)}`);
    const note = document.createElement('button');
    note.type = 'button'; note.className = 'cgr4-note-button';
    note.setAttribute('aria-label', `批注本节：${text(s.heading).slice(0, 180)}`);
    note.title = '为这一节写 Markdown 批注（先选中文字可带入摘录）';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox','0 0 24 24'); icon.setAttribute('width','16'); icon.setAttribute('height','16');
    icon.setAttribute('aria-hidden','true');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d','M4 4h11v3M4 4v16h16V9M9 16l1-4 9-9 3 3-9 9-4 1z');
    line.setAttribute('fill','none'); line.setAttribute('stroke','currentColor'); line.setAttribute('stroke-width','1.6');
    icon.append(line); note.append(icon); label.append(checkbox,note); s.control = label; inputs.set(checkbox, s);
    s.heading.classList.add('cgr3-heading'); s.heading.append(label);
    addWhiteboardHandle(s,label);
    mounted.add(s); stats.controlsCreated++; paint(s);
  }
  function unmount(s, preserveRead = true) {
    if(preserveRead) {
      // Reading styles are cheap DOM attributes, not mounted controls or strong
      // JS references. Keep them during virtualization; release cached blocks.
      for(const block of s.blocks||[])block.classList.remove('cgr3-preview');
      s.blocks=null;
    } else {clearBlocks(s);s.heading.removeAttribute('data-cgr3-read');}
    s.preview=false;
    if(!preserveRead)s.heading.classList.remove('cgr3-heading');
    if(s.control){inputs.delete(s.control.firstElementChild);s.control.remove();s.control=null;stats.controlsRemoved++;}
    mounted.delete(s);
  }
  function disposeSection(s,preserveRead=false) {
    unmount(s,preserveRead);headingObserver?.unobserve(s.heading);headingOwners.delete(s.heading);
  }
  document.addEventListener('click', (event) => {
    const control = elementOf(event.target)?.closest('[data-cgr-owned="control"]');
    if (control) {
      event.stopPropagation();
      if(elementOf(event.target)?.closest('.cgr5-board-button')) {
        event.preventDefault();const section=inputs.get(control.firstElementChild);
        if(section&&!checkRoute()&&!stopped)sendToWhiteboard(section);
      } else if (elementOf(event.target)?.closest('.cgr4-note-button')) {
        event.preventDefault();
        const section = inputs.get(control.firstElementChild);
        if (section && !checkRoute() && !stopped) openNotes(section);
      }
    }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (elementOf(event.target)?.closest('.cgr4-note-button,.cgr5-board-button') && !getSelection()?.isCollapsed) event.preventDefault();
  }, true);
  document.addEventListener('change', (event) => {
    const s = inputs.get(event.target);
    if (!s) return;
    event.stopPropagation();
    if (!s.rec.loaded || checkRoute() || stopped) { paint(s); return; }
    const entry = newEntry(event.target.checked, currentEntry(s.rec, s));
    persist(s.rec.key, {[s.id]: entry}); paint(s); queueSummary();
  }, true);
  for (const type of ['pointerover', 'pointerout']) document.addEventListener(type, (event) => {
    const control = elementOf(event.target)?.closest('[data-cgr-owned="control"]');
    if (!control || control.contains(event.relatedTarget)) return;
    const s = inputs.get(control.firstElementChild);
    if (s) { s.preview = type === 'pointerover'; paint(s); }
  }, true);

  // ---- Notes: lightweight anchors only; editor/parser live in the side panel. ----
  let countsLoading = false, countsAgain = false;
  async function loadNoteCounts(force = false) {
    if (countsLoading) { countsAgain = true; return; }
    const records = [...active].filter(r => r.key && (force || !r.countsLoaded));
    if (!records.length) return;
    countsLoading = true;
    const token = generation;
    try {
      const result = await rpc({type:'CGR_NOTE_COUNTS', keys:records.map(r=>r.key)});
      if (token === generation) for (const rec of records) if (rec.active) {
        rec.noteCounts = result.counts[rec.key] || {}; rec.countsLoaded = true;
        for (const section of rec.sections.values()) if (section.control) paint(section);
      }
    } catch (e) { console.warn('[CGR notes]', String(e.message || e)); }
    finally { countsLoading = false; if (countsAgain) { countsAgain = false; enqueue('note-counts', () => loadNoteCounts(true)); } }
  }
  function baseContext() {
    return {scope, url:location.origin + path, title:document.title.slice(0,300), nonce:crypto.randomUUID()};
  }
  function excerpt(s) {
    try {
      const range = document.createRange(); range.setStartAfter(s.heading);
      if (s.next) range.setEndBefore(s.next); else range.setEnd(s.root, s.root.childNodes.length);
      const selection = getSelection();
      if (selection?.rangeCount && !selection.isCollapsed) {
        const r = selection.getRangeAt(0);
        if (range.compareBoundaryPoints(Range.START_TO_START,r) <= 0 && range.compareBoundaryPoints(Range.END_TO_END,r) >= 0) return selection.toString().slice(0,4000);
      }
      // Don't clone or stringify a long section. Visit text nodes only until
      // 1,200 characters are gathered, and never read neighboring sections.
      const walker = document.createTreeWalker(s.root, NodeFilter.SHOW_TEXT, {
        acceptNode:n => n.parentElement?.closest(`${OWN},script,style`) || !range.intersectsNode(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      });
      let value='', node;
      while(value.length < 1200 && (node=walker.nextNode())) value += node.data.slice(0,1200-value.length) + '\n';
      return value.trim().slice(0,1200);
    } catch { return ''; }
  }
  function openNotes(s) {
    const context = baseContext();
    if (s) context.source={scope, progressKey:s.rec.key, sectionId:s.id, messageId:messageIdentity(s.rec.root).value,
      heading:s.headingText.slice(0,600), headingIndex:s.headingIndex || 0, title:context.title, url:context.url, quote:excerpt(s)};
    // Directly send in the click handler; native sidePanel.open requires a user gesture.
    rpc({type:'CGR_OPEN_NOTES', context}).catch(report);
  }
  function cardPayload(s, selectionOnly=false) {
    const ctx=baseContext(),selection=getSelection();
    let range;
    if(selection?.rangeCount&&!selection.isCollapsed&&s.rec.root.contains(selection.getRangeAt(0).commonAncestorContainer))range=selection.getRangeAt(0).cloneRange();
    else if(selectionOnly)return null;
    else {range=document.createRange();range.setStartBefore(s.heading);if(s.next)range.setEndBefore(s.next);else range.setEnd(s.root,s.root.childNodes.length);}
    const markdown=CGRClip.markdown(range.cloneContents());
    return {format:'cgr-card',version:1,markdown,source:{scope,progressKey:s.rec.key,sectionId:s.id,messageId:messageIdentity(s.rec.root).value,
      heading:s.headingText,title:ctx.title,url:ctx.url,headingIndex:s.headingIndex||0}};
  }
  function addWhiteboardHandle(s,label) {
    const button=document.createElement('button');button.type='button';button.className='cgr5-board-button';button.draggable=true;
    button.textContent='⠿';button.setAttribute('aria-label','拖入白板：'+s.headingText);
    button.title='拖入 Whiteboard 生成卡片；点击可直接发送（优先使用选中文字）';
    button.addEventListener('dragstart',event=>{
      try {const data=cardPayload(s);event.dataTransfer.setData('application/x-cgr-card',JSON.stringify(data));event.dataTransfer.setData('text/plain',data.markdown);event.dataTransfer.effectAllowed='copy';event.stopPropagation();}
      catch(e){event.preventDefault();report(e);}
    });label.append(button);
  }
  function sendToWhiteboard(s) {
    try {const context=baseContext();context.mode='whiteboard';if(s)context.card=cardPayload(s);rpc({type:'CGR_OPEN_NOTES',context}).catch(report);}
    catch(e){report(e);}
  }
  // Native selected-text drags keep working; enrich only assistant selections.
  document.addEventListener('dragstart',event=>{
    if(elementOf(event.target)?.closest(OWN)||!event.dataTransfer)return;
    const selection=getSelection();if(!selection?.rangeCount||selection.isCollapsed)return;
    const range=selection.getRangeAt(0),root=elementOf(range.startContainer)?.closest(ROLE),rec=turns.get(root);
    if(!rec?.active)return;
    const node=elementOf(range.startContainer);let section=null;
    for(const s of rec.sections.values())if(s.heading===node||s.heading.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING)section=s;
    if(section)try{const data=cardPayload(section,true);if(data)event.dataTransfer.setData('application/x-cgr-card',JSON.stringify(data));}catch(e){console.warn('[CGR drag]',String(e.message||e));}
  },true);
  function publishContext() { rpc({type:'CGR_CONTEXT_SET', context:baseContext()}).catch(e => console.warn('[CGR context]',String(e.message || e))); }
  async function locateSection(source) {
    if (checkRoute() || source.scope !== scope) return {found:false,message:'当前页面不是这条批注的原会话。'};
    let rec = [...turns.values()].find(r => messageIdentity(r.root).value === source.messageId);
    if (!rec) {
      const root = [...document.querySelectorAll(ROLE)].find(r => messageIdentity(r).value === source.messageId);
      if (root) { register(root); rec = turns.get(root); }
    }
    if (!rec) return {found:false,message:'原回复尚未加载，或已被重新生成。请先滚动加载历史消息，再次定位；保存的摘录仍可阅读。'};
    rec.root.scrollIntoView({block:'start',behavior:'instant'});
    nearTurns.add(rec); balanceTurns(); requestParse(rec,true);
    for (let i=0;i<25;i++) {
      if (source.scope!==scope || !rec.root.isConnected) break;
      const sections=[...rec.sections.values()];
      let section=sections.find(s=>s.id===source.sectionId);
      // Only a UNIQUE exact title is a safe fallback after harmless restructuring.
      if(!section){const matches=sections.filter(s=>s.headingText===source.heading);if(matches.length===1)section=matches[0];}
      if(section) {
        section.heading.scrollIntoView({block:'center',behavior:'instant'});
        section.heading.classList.add('cgr4-located');
        setTimeout(()=>section.heading.classList.remove('cgr4-located'),2200);
        return {found:true,message:'已定位原文章节。'};
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return {found:false,message:'找到了原回复，但章节已改变或未渲染；请根据保存的标题和摘录确认。'};
  }

  // ---- Summary and on-demand diagnostics are isolated from the host's CSS. ----
  function setText(node, value) { if (node.textContent !== value) node.textContent = value; }
  function diagnosticSnapshot() {
    let headings = 0;
    for (const r of active) headings += r.sections.size;
    return {version: '0.5.0', scope, registeredTurns: turns.size, activeTurns: active.size,
      observedHeadings: headings, mountedControls: mounted.size, cachedMessages: cache.size,
      pendingWrites: pending.size, queuedTasks: tasks.size, suspended, limits: LIMIT,
      counters: {...stats, maxSliceMs: +stats.maxSliceMs.toFixed(2)}};
  }
  function ensureSummary() {
    if (summary?.isConnected) return;
    summary = document.createElement('aside'); summary.dataset.cgrOwned = 'summary'; summary.id = 'cgr3-summary';
    const shadow = summary.attachShadow({mode: 'open'});
    const style = document.createElement('style');
    style.textContent = `:host{position:fixed;right:14px;bottom:82px;z-index:2147483000;font:12px/1.5 system-ui,sans-serif;color:CanvasText;color-scheme:light dark}
      *{box-sizing:border-box}.box{max-width:min(380px,calc(100vw - 28px));padding:9px 12px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:14px;background:Canvas;box-shadow:0 3px 14px #0002}
      .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.save{color:#128565;font-size:11px}.save.error{color:#cc562b}button{font:inherit;color:inherit;border:0;border-radius:6px;background:color-mix(in srgb,CanvasText 7%,transparent);padding:3px 7px;cursor:pointer}button:focus-visible{outline:2px solid #10a37f}
      .hint{max-width:340px;color:GrayText;margin:8px 0}pre{white-space:pre-wrap;font:11px/1.5 ui-monospace,monospace;max-height:42vh;overflow:auto;margin:8px 0 0}.detail[hidden]{display:none}@media(max-width:600px){:host{right:8px;bottom:76px}}`;
    const box = document.createElement('div'); box.className = 'box';
    const row = document.createElement('div'); row.className = 'row';
    summaryText = document.createElement('span'); saveText = document.createElement('span'); saveText.className = 'save';
    saveText.setAttribute('role', 'status'); saveText.setAttribute('aria-live', 'polite');
    const button = (label, handler) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', handler); return b;
    };
    detail = document.createElement('div'); detail.className = 'detail'; detail.hidden = true;
    detailPre = document.createElement('pre');
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = '只统计视口附近已加载的回复，不代表整场对话。远处控件会回收，进度不会被删除。';
    const tools = document.createElement('div'); tools.className = 'row';
    tools.append(button('备份与管理', () => rpc({type: 'CGR_OPTIONS'}).catch(report)),
      button('重试保存', retryFailed), button('重置附近', resetNearby),
      button('刷新诊断', () => setText(detailPre, JSON.stringify(diagnosticSnapshot(), null, 2))));
    detail.append(hint, tools, detailPre);
    row.append(summaryText, saveText, button('批注', () => openNotes()), button('白板',()=>sendToWhiteboard()), button('工具', () => {
      detail.hidden = !detail.hidden;
      if (!detail.hidden) setText(detailPre, JSON.stringify(diagnosticSnapshot(), null, 2));
    }));
    box.append(row, detail); shadow.append(style, box); document.body.append(summary);
  }
  function renderSummary() {
    ensureSummary();
    let total = 0, checked = 0, loading = false;
    for (const rec of active) {
      if (!rec.loaded && rec.sections.size) loading = true;
      for (const s of rec.sections.values()) { total++; if (currentEntry(rec, s)?.checked) checked++; }
    }
    setText(summaryText, total ? `附近回复 已读 ${checked}/${total}` : '附近暂无可标记标题');
    const failed = [...pending.values()].some((p) => p.failed);
    const status = lastError || failed ? '保存/读取异常，点工具重试' : pending.size ? '保存中…' : loading ? '读取中…' : '已保存';
    setText(saveText, status); saveText.classList.toggle('error', !!lastError || failed);
    saveText.title = lastError || '只在后台确认本地写入完成后显示已保存';
  }
  function queueSummary() {
    if (!suspended && !stopped) enqueue('summary', renderSummary);
    else if (stopped && summaryText) renderSummary();
  }
  function resetNearby() {
    if (!confirm('清除视口附近已加载回复的阅读标记？远处尚未加载的回复不受影响。')) return;
    const batches = new Map();
    for (const rec of active) if (rec.loaded) {
      const patches = batches.get(rec.key) || {};
      for (const s of rec.sections.values()) patches[s.id] = newEntry(false, currentEntry(rec, s));
      batches.set(rec.key, patches);
    }
    for (const [key, patches] of batches) {
      if (!Object.keys(patches).length) continue;
      persist(key, patches); refreshKey(key);
    }
  }

  // ---- Streaming/React updates: ignore body text tokens and our own mutations. ----
  function hasHeading(node) {
    return node.nodeType === Node.ELEMENT_NODE && (node.matches(HEAD) || !!node.querySelector(HEAD));
  }
  function onMutations(mutations) {
    if (checkRoute() || stopped || suspended) return;
    stats.mutationBatches++;
    let removed = false;
    const discoverNodes = new Set(), parse = new Set(), body = new Set();
    for (const m of mutations) {
      if (ownMutation(m)) { stats.ignoredOwnMutations++; continue; }
      const el = elementOf(m.target);
      if (!el || el.closest('textarea,[contenteditable="true"],script,style')) continue;
      const marker = el.closest(ROLE), rec = marker && turns.get(marker);
      if (m.type === 'attributes') {
        const previous = turns.get(el);
        if (previous && !el.matches(ROLE)) {
          deactivate(previous); turnObserver?.unobserve(el); nearTurns.delete(previous); turns.delete(el);
        }
        if (rec?.active) parse.add(rec);
        for (const child of el.querySelectorAll(ROLE)) {
          const affected = turns.get(child);
          if (affected?.active) parse.add(affected);
        }
        discoverNodes.add(el);
        continue;
      }
      if (m.type === 'characterData') {
        if (rec?.active && (el.closest(HEAD) || !rec.stable)) parse.add(rec);
        continue; // ordinary streaming body tokens do not rescan any response
      }
      if (m.removedNodes.length) removed = true;
      const headingChanged = el.closest(HEAD) || [...m.addedNodes, ...m.removedNodes].some(hasHeading);
      if (rec?.active) {
        if (headingChanged || !rec.parsed || !rec.stable) parse.add(rec);
        else if ([...m.addedNodes].some((n) => n.nodeType === Node.ELEMENT_NODE) &&
          [...rec.sections.values()].some((s) => s.control && currentEntry(rec, s)?.checked)) body.add(rec);
      }
      for (const node of m.addedNodes) if (node.nodeType === Node.ELEMENT_NODE && !isOwnedNode(node)) {
        // Skip ordinary Markdown blocks; new role-bearing wrappers/turns remain discoverable.
        if (node.matches(ROLE) || (!node.matches('p,pre,code,li,span,em,strong,a,svg,path,button,input') &&
            (node.matches('main,article') || node.querySelector(ROLE)))) discoverNodes.add(node);
      }
      if (!summary?.isConnected) enqueue('summary', renderSummary);
    }
    // If both an ancestor and descendant were inserted in one mutation batch,
    // scanning the ancestor is enough. No cross-message root filtering is used.
    for (const node of discoverNodes) {
      let parent = node.parentElement, covered = false;
      while (parent) { if (discoverNodes.has(parent)) { covered = true; break; } parent = parent.parentElement; }
      if (!covered) enqueueDiscovery(node);
    }
    for (const rec of parse) requestParse(rec);
    for (const rec of body) if (!parse.has(rec)) enqueue(`body-${rec.uid}`, () => {
      if (rec.active) for (const s of rec.sections.values()) if (s.control) { clearBlocks(s); paint(s); }
    });
    if (removed) enqueue('sweep', sweepDisconnected);
  }
  function resetObservers() {
    for (const rec of [...active]) deactivate(rec);
    turnObserver?.disconnect(); headingObserver?.disconnect();
    turnObserver = headingObserver = undefined; scrollRoot = null;
    turns.clear(); nearTurns.clear(); mounted.clear();
  }
  function suspendWork() {
    pageObserver?.disconnect(); cancelIdle(); clearTimeout(scrollTimer); scrollTimer = 0;
    for (const timer of parseTimers.values()) clearTimeout(timer);
    parseTimers.clear(); resetObservers();
  }
  function resumeWork() {
    if (stopped || suspended) return;
    if (!pageObserver) pageObserver = new MutationObserver(onMutations);
    pageObserver.observe(document.documentElement, {subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['data-message-author-role','data-role','data-author','data-message-id','data-turn-id','data-testid']});
    enqueueDiscovery(document, true); queueSummary();
  }
  function checkRoute() {
    if (location.pathname === path) return false;
    if (!routeQueued) { routeQueued = true; queueMicrotask(changeRoute); }
    return true;
  }
  async function changeRoute() {
    routeQueued = false;
    if (location.pathname === path) return;
    const from = scope;
    path = location.pathname;
    const nextScope = C.scope(path, draft);
    if (nextScope === from) return; // Same conversation through an alternate GPT URL.
    for (const rec of turns.values()) blocked.set(rec.root, messageIdentity(rec.root).value);
    generation++; storageEpoch++; suspendWork(); cache.clear(); loads.clear();
    // A new-chat page gets a per-document random namespace, never a shared '/'.
    if (nextScope.startsWith('d-') && !from.startsWith('d-')) draft = crypto.randomUUID();
    scope = C.scope(path, draft);
    if (from.startsWith('d-') && !scope.startsWith('d-')) {
      // Newly-created conversation keeps its current DOM; this is a promotion,
      // not another user's conversation. Late draft writes follow the alias.
      for (const root of document.querySelectorAll(ROLE)) blocked.delete(root);
      {
        try { await rpc({type: 'CGR_PROMOTE', from, to: scope, url: location.origin + path}); } catch (error) { report(error); }
      }
    }
    if (location.pathname !== path) { checkRoute(); return; }
    publishContext();
    resumeWork();
  }
  window.navigation?.addEventListener('currententrychange', checkRoute);
  window.addEventListener('popstate', checkRoute);
  document.addEventListener('scroll', () => {
    if (suspended || stopped || scrollTimer) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = 0;
      if (checkRoute()) return;
      enqueue('balance-turns', balanceTurns); enqueue('balance-headings', balanceHeadings);
    }, 120);
  }, {capture: true, passive: true});
  window.addEventListener('resize', () => {
    enqueue('balance-turns', balanceTurns); enqueue('balance-headings', balanceHeadings);
  }, {passive: true});
  document.addEventListener('visibilitychange', () => {
    suspended = document.hidden;
    if (suspended) suspendWork();
    else if (!checkRoute()) resumeWork();
  });
  window.addEventListener('pagehide', () => { suspended = true; suspendWork(); });
  window.addEventListener('pageshow', () => {
    if (!document.hidden && suspended) { suspended = false; if (!checkRoute()) resumeWork(); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let deleted = false;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(`${C.PREFIX}m:${scope}:`)) continue;
      if (!cache.has(key) && ![...active].some((r) => r.key === key)) continue;
      if (!change.newValue) {
        deleted = true; cache.delete(key);
        for (const rec of active) if (rec.key === key) { rec.record = C.emptyRecord(); rec.loaded = true; }
      } else cachePut(key, change.newValue);
      refreshKey(key);
    }
    if (deleted) storageEpoch++;
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === 'CGR_DIAGNOSTICS') respond(diagnosticSnapshot());
    if (message?.type === 'CGR_CONTEXT_REQUEST') respond(baseContext());
    if (message?.type === 'CGR_NOTES_CHANGED' && (!message.scope || message.scope === scope)) {
      for (const rec of active) rec.countsLoaded = false;
      enqueue('note-counts', () => loadNoteCounts(true));
    }
    if (message?.type === 'CGR_LOCATE_SECTION') {
      locateSection(message.source).then(respond, e=>respond({found:false,message:String(e.message||e)})); return true;
    }
  });
  publishContext();
  resumeWork();
})();
