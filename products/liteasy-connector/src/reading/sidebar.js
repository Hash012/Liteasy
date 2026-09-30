/* Native side panel and standalone manager. No ChatGPT DOM or account access.
 * One editor, one bounded list page, one disposable Markdown worker. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id), N=CGRNotes;
  const uuid=()=>crypto.randomUUID();
  const preview=new CGRMarkdown.Preview($('preview'));
  let context=null, tabId=null, sourceFilter=null, lastContextNonce='';
  let current=null, mode='split', dirty=false, editToken='', draftId=uuid(), durableToken='';
  let saveTimer=0, previewTimer=0, searchTimer=0, refreshTimer=0, saving=null, attempt=null, conflict=null;
  let draftWanted=null, draftFlight=null, draftError='', saveError='', firstDirty=0;
  let pageCursor=null, nextCursor=null, cursorStack=[], listSerial=0, externalSerial=0, navigating=false, exportBusy=false;
  let draftCursor=null,draftNext=null,draftPages=[];
  const overriddenTab=new URLSearchParams(location.search).get('tabId');
  const notice=(text,error=false)=>{$('notice').textContent=text;$('notice').classList.toggle('error',error);};
  const onError=error=>notice(String(error?.message||error),true);
  async function rpc(message) {
    const result=await chrome.runtime.sendMessage(message);
    if(!result?.ok)throw new Error(result?.error || '扩展后台未响应；更新扩展后请重新打开侧栏');
    return result;
  }
  function setStatus(text,error=false){for(const id of ['save-status','save-status-top']){$(id).textContent=text;$(id).title=text;$(id).classList.toggle('error',error);}}
  function filter() {
    const f={query:$('search').value.trim(),trash:$('status-filter').value==='trash',pinned:$('status-filter').value==='pinned'};
    if($('scope-filter').value==='current')f.scope=context?.scope || 'general';
    if(sourceFilter && $('scope-filter').value==='current' && sourceFilter.scope===context?.scope){f.messageKey=sourceFilter.progressKey;f.sectionId=sourceFilter.sectionId;}
    return f;
  }
  function displaySectionFilter() {
    const visible=sourceFilter && $('scope-filter').value==='current' && sourceFilter.scope===context?.scope;
    $('section-filter').hidden=!visible;
    $('section-filter-text').textContent=visible?'本节：'+sourceFilter.heading:'';
  }
  function scheduleList(reset=true) {clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>loadList(reset).catch(onError),200);}
  async function loadList(reset=false) {
    if(reset){pageCursor=null;cursorStack=[];}
    const serial=++listSerial;
    $('list-status').textContent='读取中…';
    const result=await rpc({type:'CGR_NOTE_LIST',filter:filter(),cursor:pageCursor,limit:30});
    if(serial!==listSerial)return;
    nextCursor=result.cursor;
    const fragment=document.createDocumentFragment();
    for(const h of result.items){
      const b=document.createElement('button');b.type='button';b.className='note-card';b.dataset.noteId=h.id;
      b.draggable=true;b.addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-cgr-note',h.id);e.dataTransfer.setData('text/plain',h.title||'批注');e.dataTransfer.effectAllowed='copy';});
      b.classList.toggle('selected',current?.id===h.id);
      const title=document.createElement('span');title.className='card-title';title.textContent=(h.pinned?'↑ ':'')+(h.title||h.source.heading||'未命名批注');
      const snippet=document.createElement('span');snippet.className='card-preview';snippet.textContent=h.preview;
      const source=document.createElement('span');source.className='card-source';source.textContent=(h.source.heading || '独立批注')+' · '+new Date(h.updatedAt).toLocaleDateString();
      const tags=document.createElement('span');tags.className='card-tags';
      for(const tag of h.tags.slice(0,4)){const e=document.createElement('span');e.className='tag';e.textContent=tag;tags.append(e);}
      b.append(title,snippet,source,tags);b.onclick=()=>selectNote(h.id).catch(onError);fragment.append(b);
    }
    if(!result.items.length){const p=document.createElement('p');p.className='list-empty';p.textContent=result.cursor?'本批候选中没有匹配结果。点击下一页继续搜索。':filter().trash?'回收站为空。':'这里还没有匹配的批注。';fragment.append(p);}
    $('note-list').replaceChildren(fragment);$('prev-page').disabled=!cursorStack.length;$('next-page').disabled=!nextCursor;
    $('list-status').textContent=`第 ${cursorStack.length+1} 页 · ${result.items.length} 条`;
    displaySectionFilter();
  }
  function formNote(){
    if(!current)return null;
    return {...current,title:$('note-title').value,tags:N.tags($('note-tags').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean)),markdown:$('note-body').value};
  }
  function makeDraft(){
    const n=formNote();
    return {id:draftId,noteId:n.id,token:editToken,baseRevision:n.revision||'',title:n.title,tags:n.tags,markdown:n.markdown,source:n.source,pinned:n.pinned};
  }
  function checkpoint() {
    if(!current||!dirty)return Promise.resolve(true);
    try {draftWanted=makeDraft();} catch(e) {draftError=String(e.message||e);setStatus(draftError,true);return Promise.resolve(false);}
    if(!draftFlight)draftFlight=(async()=>{
      let success=true;
      while(draftWanted){
        const d=draftWanted;draftWanted=null;
        try {await rpc({type:'CGR_DRAFT_PUT',draft:d});if(draftId===d.id){durableToken=d.token;draftError='';}}
        catch(e){draftError=String(e.message||e);success=false;setStatus('草稿未保存：'+draftError,true);break;}
      }
      return success;
    })().finally(()=>{draftFlight=null;});
    return draftFlight;
  }
  function schedulePreview(force=false) {
    clearTimeout(previewTimer);
    if(!current||mode==='write'||document.hidden||document.body.dataset.workspace==='whiteboard')return;
    const render=()=>preview.render($('note-body').value,{force}).catch(e=>notice('批注可继续保存。'+String(e.message||e),true));
    if(force)render();else previewTimer=setTimeout(render,350);
  }
  function setMode(next) {
    mode=next;
    $('write-area').hidden=next==='preview';$('preview-area').hidden=next==='write';
    document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
    if(mode==='write')preview.close();else schedulePreview();
  }
  function fillEditor(n,{isDraft=false,recoveredId='',recoveredToken=''}={}) {
    clearTimeout(saveTimer);clearTimeout(previewTimer);preview.close();
    current=structuredClone(n);dirty=isDraft;editToken=recoveredToken||uuid();draftId=recoveredId||uuid();durableToken=recoveredId?editToken:'';
    attempt=null;conflict=null;saveError='';firstDirty=0;
    $('editor-empty').hidden=true;$('editor').hidden=false;
    $('note-title').value=n.title||'';$('note-tags').value=n.tags.join(', ');$('note-body').value=n.markdown||'';
    $('char-count').textContent=n.markdown.length.toLocaleString()+' 字符';
    $('source-details').hidden=!n.source.heading&&!n.source.quote;
    $('source-heading').textContent=n.source.heading?'原文 · '+n.source.heading:'原文摘录';
    $('source-conversation').textContent=n.source.title||'';$('source-quote').textContent=n.source.quote||'没有保存摘录。';
    $('editor-kind').textContent=n.deleted?'回收站 · 只读':n.source.sectionId?'章节批注':'独立批注';
    $('locate-note').disabled=!n.source.url;
    $('pin-note').setAttribute('aria-pressed',String(n.pinned));$('pin-note').textContent=n.pinned?'已置顶':'置顶';
    for(const id of ['note-title','note-tags','note-body'])$(id).readOnly=!!n.deleted;
    $('pin-note').disabled=!!n.deleted;$('save-note').disabled=!!n.deleted;
    $('delete-note').hidden=!!n.deleted||!n.revision;$('restore-note').hidden=!n.deleted;$('conflict').hidden=true;
    setStatus(isDraft?'已恢复本地草稿，尚未保存为正式批注':n.revision?'已保存 · '+new Date(n.updatedAt).toLocaleTimeString():'输入后自动保存');
    setMode(n.deleted?'preview':n.revision&&!isDraft?'preview':'split');
    document.querySelectorAll('.note-card').forEach(b=>b.classList.toggle('selected',b.dataset.noteId===n.id));
  }
  function emptyNote(source) {
    return {id:uuid(),title:source?.heading||'',tags:[],markdown:'',source:N.source(source||{scope:context?.scope||'general',url:context?.url||'',title:context?.title||''}),pinned:false,deleted:false,revision:'',createdAt:0,updatedAt:0};
  }
  async function canLeave() {
    if(!dirty&&!saving)return true;
    const saved=await saveNow();
    if(saved&&!dirty)return true;
    const durable=await checkpoint();
    if(!durable||durableToken!==editToken){notice('当前编辑还未写入本地。请重试保存，或先使用“当前编辑内容 · Markdown”导出。',true);return false;}
    return confirm('当前编辑未保存为正式批注，但已保留恢复草稿。暂时离开这篇批注？');
  }
  async function newNote(source=null) {
    if(navigating)return;navigating=true;
    try{if(!await canLeave())return;fillEditor(emptyNote(source));$('note-body').focus();}finally{navigating=false;}
  }
  async function selectNote(id) {
    if(navigating)return;
    if(current?.id===id)return;
    navigating=true;
    try {
      if(!await canLeave())return;
      const result=await rpc({type:'CGR_NOTE_GET',id});
      if(!result.note)throw new Error('这条批注已不存在，请刷新列表');
      fillEditor(result.note);
    } finally {navigating=false;}
  }
  function onInput() {
    if(!current||current.deleted)return;
    editToken=uuid();dirty=true;firstDirty=firstDirty||Date.now();
    $('char-count').textContent=$('note-body').value.length.toLocaleString()+' 字符';
    setStatus(conflict?'有版本冲突；编辑已保留为草稿':'保存中…',!!conflict);
    checkpoint();
    clearTimeout(saveTimer);
    if(!conflict)saveTimer=setTimeout(()=>saveNow(),Math.max(0,Math.min(700,3000-(Date.now()-firstDirty))));
    schedulePreview();
  }
  async function performSave() {
    if(!current||(!dirty&&!attempt))return true;
    if(conflict){setStatus('请先处理版本冲突',true);return false;}
    clearTimeout(saveTimer);
    try {
      // First settle a previous ambiguous response with the SAME operation ID.
      // A worker restart after commit cannot accidentally double-write the note.
      if(!attempt){
        await checkpoint();
        attempt={type:'CGR_NOTE_SAVE',note:formNote(),expectedRevision:current.revision||'',op:uuid(),draftId,draftToken:editToken};
      }
      const a=attempt;
      setStatus('正在写入本地…');
      const result=await rpc(a);
      if(current?.id!==a.note.id)return false;
      if(result.conflict){conflict=result.current||{missing:true};$('conflict').hidden=false;setStatus('版本冲突：两份内容均未覆盖',true);await checkpoint();return false;}
      attempt=null;saveError='';firstDirty=0;
      current={...current,revision:result.note.revision,createdAt:result.note.createdAt,updatedAt:result.note.updatedAt,source:result.note.source};
      if(editToken===a.draftToken){
        current=result.note;dirty=false;
        setStatus('已保存 · '+new Date(result.note.updatedAt).toLocaleTimeString());
        $('delete-note').hidden=!!current.deleted;
      } else {dirty=true;setStatus('继续保存最新编辑…');}
      scheduleList(true);
      return !dirty;
    } catch(e) {saveError=String(e.message||e);setStatus('保存失败：'+saveError,true);await checkpoint();return false;}
  }
  function saveNow() {
    if(saving)return saving.then(()=>dirty&&!conflict&&!saveError?saveNow():!dirty);
    saving=performSave().finally(()=>{saving=null;if(dirty&&!conflict&&!saveError){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveNow(),100);}});
    return saving;
  }
  async function mutateFlag(key,value) {
    if(!current)return;
    if(!await canLeave())return;
    if(dirty)return;
    current[key]=value;dirty=true;editToken=uuid();firstDirty=Date.now();
    checkpoint();
    const ok=await saveNow();
    if(ok)fillEditor(current);
  }
  async function recoverDrafts(reset=true) {
    if(reset){draftCursor=null;draftPages=[];}
    const result=await rpc({type:'CGR_DRAFT_LIST',metadataOnly:true,limit:30,cursor:draftCursor});
    draftNext=result.cursor;$('draft-prev').disabled=!draftPages.length;$('draft-next').disabled=!draftNext;
    $('draft-page').textContent=`第 ${draftPages.length+1} 页 · 共 ${result.total} 份`;
    const fragment=document.createDocumentFragment();
    for(const d of result.drafts){
      const row=document.createElement('div');row.className='draft-row';
      const title=document.createElement('strong');title.textContent=d.title||d.source.heading||'未命名草稿';
      const meta=document.createElement('p');meta.className='muted';meta.textContent=new Date(d.updatedAt).toLocaleString()+' · '+d.chars+' 字符';
      const restore=document.createElement('button');restore.textContent='恢复编辑';restore.onclick=async()=>{
        try{if(!await canLeave())return;const {draft:full}=await rpc({type:'CGR_DRAFT_GET',id:d.id});if(!full)throw new Error('这份草稿已经清理，请刷新草稿列表');fillEditor({...emptyNote(full.source),id:full.noteId,title:full.title,tags:full.tags,markdown:full.markdown,pinned:full.pinned,revision:full.baseRevision},{isDraft:true,recoveredId:full.id,recoveredToken:full.token});$('draft-dialog').close();setMode('split');}catch(e){onError(e);}
      };
      const discard=document.createElement('button');discard.textContent='删除草稿';discard.className='danger-text';discard.onclick=async()=>{
        if(!confirm('只删除这份恢复草稿？已保存的正式批注不受影响。'))return;
        try{await rpc({type:'CGR_DRAFT_REMOVE',id:d.id});row.remove();if(d.id===draftId)durableToken='';}catch(e){onError(e);}
      };
      row.append(title,meta,restore,discard);fragment.append(row);
    }
    if(!result.drafts.length){const p=document.createElement('p');p.textContent='没有待恢复草稿。成功保存后，对应草稿会自动清理。';fragment.append(p);}
    $('draft-list').replaceChildren(fragment);if(!$('draft-dialog').open)$('draft-dialog').showModal();
  }
  function download(filename,body,type) {
    const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');
    a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function exportNotes(kind,all=false) {
    if(exportBusy)return;exportBusy=true;
    try {
      // A failed current edit must be exported separately, never silently omitted.
      if(dirty && !await saveNow())throw new Error('当前编辑尚未保存。请先处理冲突，或导出“当前编辑内容 · Markdown”。');
      let cursor=null, notes=[],bytes=0;const encoder=new TextEncoder();
      const f=all?{includeDeleted:true}:filter();
      do {
        const result=await rpc({type:'CGR_NOTE_LIST',filter:f,cursor,limit:40,includeBodies:true});
        notes.push(...result.items);cursor=result.cursor;
        bytes+=result.items.reduce((n,x)=>n+encoder.encode(JSON.stringify(x)).length+2,0);
        if(bytes>30*1024*1024)throw new Error('本批批注超过 30 MB，请按会话分批导出，避免管理页面占用过多内存。');
        notice(`正在整理 ${notes.length} 条批注…`);
      } while(cursor);
      const date=new Date().toISOString().slice(0,10);
      const body=kind==='md'?N.toMarkdown(notes):JSON.stringify({format:'chatgpt-reading-annotations',version:1,exportedAt:new Date().toISOString(),notes},null,2);
      if(encoder.encode(body).length>32*1024*1024)throw new Error('导出文件超过 32 MB，请按会话或标签筛选后分批导出。');
      download(`reading-notes-${date}.${kind==='md'?'md':'json'}`,body,kind==='md'?'text/markdown;charset=utf-8':'application/json');
      notice(`已生成 ${notes.length} 条批注的 ${kind==='md'?'Markdown':'JSON'} 文件，请检查下载列表。`);
    } catch(e) {onError(e);} finally {exportBusy=false;}
  }
  function exportCurrent() {
    if(!current){notice('请先打开一篇批注。');return;}
    try {
      const n={...formNote(),deleted:false,updatedAt:Date.now(),createdAt:current.createdAt||Date.now()};
      download('reading-note-draft-'+new Date().toISOString().slice(0,10)+'.md',N.toMarkdown([n]),'text/markdown;charset=utf-8');
      notice('已导出当前编辑内容；这不会覆盖已保存的批注。');
    } catch(e){onError(e);}
  }
  async function importNotes(file) {
    if(!file)return;
    if(file.size>32*1024*1024)throw new Error('文件超过 32 MB，请拆分为多个批注备份。');
    const data=JSON.parse(await file.text());
    if(!confirm('合并导入批注？与本地正文不同的同 ID 批注会保留为副本，不覆盖本地编辑。建议先导出当前备份。'))return;
    const result=await rpc({type:'CGR_NOTE_IMPORT',data});
    await loadList(true);notice(`导入完成：新增 ${result.added}，冲突副本 ${result.copies}，同步删除状态 ${result.deleted}，跳过 ${result.skipped}。`);
  }
  function insertFormat(kind) {
    const input=$('note-body');if(!current||current.deleted)return;
    const start=input.selectionStart,end=input.selectionEnd,selection=input.value.slice(start,end);
    const formats={bold:['**','**','重点'],italic:['*','*','强调'],code:['`','`','code'],fence:['\n```rust\n','\n```\n','let value = 42;'],task:['\n- [ ] ','\n','待验证的观点'],link:['[','](https://example.com)','链接文字'],table:['\n| 项目 | 说明 |\n| --- | --- |\n| ',' |  |\n','例子'],math:['\n$$\n','\n$$\n','\\frac{a}{b}']};
    const [before,after,placeholder]=formats[kind],content=selection||placeholder;
    input.setRangeText(before+content+after,start,end,'end');input.focus();input.setSelectionRange(start+before.length,start+before.length+content.length);
    onInput();
  }
  async function applyContext(next) {
    if(!next){context=null;sourceFilter=null;$('context-title').textContent='未连接 ChatGPT；仍可管理全部批注';$('scope-filter').value='all';await loadList(true);return;}
    const changed=context?.scope!==next.scope;context=next;tabId=next.tabId??tabId;
    window.dispatchEvent(new CustomEvent('cgr-context',{detail:next}));
    $('context-title').textContent=next.title||'当前 ChatGPT 会话';$('context-title').title=next.url||'';
    if(changed)sourceFilter=null;
    if(next.mode==='whiteboard'){await loadList(true);return;}
    if(next.source && next.nonce!==lastContextNonce){
      lastContextNonce=next.nonce;sourceFilter=next.source;$('scope-filter').value='current';$('status-filter').value='active';$('search').value='';
      await loadList(true);
      if(current?.source.progressKey===next.source.progressKey && current?.source.sectionId===next.source.sectionId)return;
      const result=await rpc({type:'CGR_NOTE_LIST',filter:{scope:next.source.scope,messageKey:next.source.progressKey,sectionId:next.source.sectionId},limit:1});
      if(result.items.length)await selectNote(result.items[0].id);else await newNote(next.source);
      return;
    }
    await loadList(true);
    if(changed&&current)notice('列表已切换到当前会话。编辑器仍保留原批注，不会把它改绑到新会话。');
  }
  async function followTab(id) {
    const serial=++externalSerial;tabId=id;
    const result=await rpc({type:'CGR_CONTEXT_GET',tabId:id});
    if(serial===externalSerial)await applyContext(result.context);
  }
  $('new-note').onclick=()=>newNote(sourceFilter).catch(onError);
  $('settings').onclick=()=>chrome.runtime.openOptionsPage();
  $('export-toggle').onclick=()=>{$('export-tools').hidden=!$('export-tools').hidden;};
  $('draft-next').onclick=()=>{if(draftNext){draftPages.push(draftCursor);draftCursor=draftNext;recoverDrafts(false).catch(onError);}};
  $('draft-prev').onclick=()=>{if(draftPages.length){draftCursor=draftPages.pop();recoverDrafts(false).catch(onError);}};
  $('drafts-toggle').onclick=()=>recoverDrafts().catch(onError);
  $('help-toggle').onclick=()=>$('help-dialog').showModal();
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  document.querySelectorAll('[data-format]').forEach(b=>b.onclick=()=>insertFormat(b.dataset.format));
  for(const id of ['note-title','note-tags','note-body'])$(id).addEventListener('input',onInput);
  $('note-body').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&['b','i'].includes(e.key.toLowerCase())){e.preventDefault();insertFormat(e.key.toLowerCase()==='b'?'bold':'italic');}});
  document.addEventListener('keydown',e=>{if(document.body.dataset.workspace!=='whiteboard'&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveError='';saveNow();}});
  $('save-note').onclick=()=>{saveError='';saveNow();};$('force-preview').onclick=()=>{if(mode==='write')setMode('split');schedulePreview(true);};
  $('pin-note').onclick=()=>mutateFlag('pinned',!current?.pinned).catch(onError);
  $('delete-note').onclick=()=>{if(current&&confirm('将这条批注移入回收站？可随时恢复，不影响原文与阅读标记。'))mutateFlag('deleted',true).catch(onError);};
  $('restore-note').onclick=()=>mutateFlag('deleted',false).catch(onError);
  $('locate-note').onclick=async()=>{if(!current)return;try{const r=await rpc({type:'CGR_NOTE_LOCATE',source:current.source,tabId});notice(r.message||'已打开原会话。',r.found===false);}catch(e){onError(e);}};
  $('conflict-copy').onclick=async()=>{
    try{await checkpoint();const own=formNote();own.id=uuid();own.title=(own.title+'（冲突副本）').slice(0,300);own.revision='';own.deleted=false;fillEditor(own);onInput();await saveNow();}catch(e){onError(e);}
  };
  $('conflict-reload').onclick=async()=>{try{if(!await checkpoint())return;const r=await rpc({type:'CGR_NOTE_GET',id:current.id});if(!r.note)throw new Error('原批注已不存在；请将编辑另存为副本。');fillEditor(r.note);notice('已读取最新版本；你刚才的编辑保留在“恢复草稿”中。');}catch(e){onError(e);}};
  $('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadList(true).catch(onError),250);};
  for(const id of ['scope-filter','status-filter'])$(id).onchange=()=>{displaySectionFilter();loadList(true).catch(onError);};
  $('refresh-list').onclick=()=>loadList(true).catch(onError);
  $('clear-section').onclick=()=>{sourceFilter=null;displaySectionFilter();loadList(true).catch(onError);};
  $('next-page').onclick=()=>{if(!nextCursor)return;cursorStack.push(pageCursor);pageCursor=nextCursor;loadList().catch(onError);};
  $('prev-page').onclick=()=>{if(!cursorStack.length)return;pageCursor=cursorStack.pop();loadList().catch(onError);};
  $('export-md').onclick=()=>exportNotes('md');$('export-json').onclick=()=>exportNotes('json');$('export-all').onclick=()=>exportNotes('json',true);$('export-current').onclick=exportCurrent;
  $('import-notes').onchange=e=>{const file=e.target.files[0];e.target.value='';importNotes(file).catch(onError);};
  $('preview').addEventListener('click',e=>{const a=e.target.closest('a');if(a?.getAttribute('href')?.startsWith('#')){e.preventDefault();const target=document.getElementById(a.getAttribute('href').slice(1));if(target&&$('preview').contains(target))target.scrollIntoView({block:'nearest'});}});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='session' && tabId!=null && changes[`cgr4:context:${tabId}`])applyContext(changes[`cgr4:context:${tabId}`].newValue).catch(onError);
  });
  chrome.runtime.onMessage.addListener(m=>{
    if(m?.type!=='CGR_NOTES_CHANGED')return;
    scheduleList(true);
    if(current && m.id===current.id && !saving && !dirty)rpc({type:'CGR_NOTE_GET',id:current.id}).then(r=>{
      if(r.note&&current?.id===r.note.id&&!dirty&&!saving&&current.revision!==r.note.revision)fillEditor(r.note);
    }).catch(onError);
  });
  if(!overriddenTab)chrome.tabs.onActivated.addListener(info=>followTab(info.tabId).catch(onError));
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){clearTimeout(previewTimer);preview.close();if(dirty){checkpoint();saveNow();}}
    else {schedulePreview();scheduleList(true);}
  });
  window.addEventListener('pagehide',()=>{preview.close();if(dirty){checkpoint();saveNow();}});
  window.addEventListener('beforeunload',e=>{if(dirty&&durableToken!==editToken){e.preventDefault();e.returnValue='';}});
  globalThis.CGRSidebarBridge={rpc,notice,download,getContext:()=>context,getTabId:()=>tabId,
    prepare:canLeave,pause:()=>{clearTimeout(previewTimer);preview.close();},resume:schedulePreview,
    currentNote:()=>current?formNote():null};
  $('note-to-board').onclick=()=>{if(current)window.dispatchEvent(new CustomEvent('cgr-whiteboard-note',{detail:formNote()}));};
  (async()=>{
    if(overriddenTab && /^\d+$/.test(overriddenTab))tabId=Number(overriddenTab);
    else tabId=(await chrome.tabs.query({active:true,currentWindow:true}))[0]?.id;
    if(tabId!=null)await followTab(tabId);else await applyContext(null);
    const drafts=await rpc({type:'CGR_DRAFT_LIST',metadataOnly:true,limit:1});
    if(drafts.total)$('drafts-toggle').textContent=`恢复草稿 (${drafts.total})`;
  })().catch(onError);
})();
