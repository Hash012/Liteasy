const {test}=require('node:test');
const assert=require('node:assert/strict');
globalThis.CGRCore=require('../../src/reading/shared.js');
require('../../src/reading/notes-core.js');
require('./idb-adapter.cjs');
require('../../src/reading/notes-db.js');
const N=globalThis.CGRNotes,D=globalThis.CGRNotesDB,C=CGRCore;
const source={scope:C.scope('/c/notes-test',''),progressKey:C.key(C.scope('/c/notes-test',''),'message:a'),sectionId:C.hash('section-a'),messageId:'message:a',heading:'并发控制',headingIndex:0,title:'数据库',url:'https://chatgpt.com/c/notes-test',quote:'原文摘录'};
const make=(extra={})=>({id:crypto.randomUUID(),title:'一个批注',tags:['数据库'],markdown:'**自己的理解**',source,pinned:false,deleted:false,...extra});
const save=(note,expectedRevision='',extra={})=>D.save({note,expectedRevision,op:crypto.randomUUID(),...extra});

test('annotation schema rejects invalid source, oversized note, and dangerous URLs',()=>{
 assert.equal(N.source({...source,url:'javascript:alert(1)'}).url,'');
 assert.equal(N.source({...source,url:'https://evil.example/c/a'}).url,'');
 assert.throws(()=>N.note(make({markdown:'a'.repeat(N.MAX_BODY+1)})));
 assert.throws(()=>N.source({...source,scope:'general'}));
 assert.throws(()=>N.tags(Array(13).fill('x')));
});
test('IDB callback logic: save and read preserve Markdown and source',async()=>{
 const n=make();const result=await save(n);assert.equal(result.note.markdown,n.markdown);
 assert.deepEqual((await D.get(n.id)).note,result.note);
 const page=await D.list({filter:{scope:source.scope},limit:1});assert.equal(page.items[0].id,n.id);assert.equal('markdown' in page.items[0],false);
});
test('optimistic concurrency refuses silent lost updates; retry op is idempotent',async()=>{
 const first=(await save(make())).note, op=crypto.randomUUID();
 const a={...first,markdown:'window A'},b={...first,markdown:'window B'};
 const out=await Promise.all([save(a,first.revision,{op}),save(b,first.revision)]);
 assert.equal(out.filter(x=>x.conflict).length,1);
 assert.equal(out[1].current.markdown,'window A');
 const replay=await save(a,first.revision,{op});assert.equal(replay.replay,true);
 assert.equal(replay.note.revision,out[0].note.revision);
});
test('draft cleanup only removes the version acknowledged by the note transaction',async()=>{
 const n=make(),d={id:crypto.randomUUID(),noteId:n.id,token:'draft-v1',baseRevision:'',title:n.title,tags:n.tags,markdown:n.markdown,source,pinned:false};
 await D.putDraft(d);await D.putDraft({...d,token:'draft-v2',markdown:'newer unsaved typing'});
 const result=await save(n,'',{draftId:d.id,draftToken:d.token});
 assert.equal((await D.drafts()).drafts.find(x=>x.id===d.id).token,'draft-v2');
 await save({...result.note,markdown:'newer unsaved typing'},result.note.revision,{draftId:d.id,draftToken:'draft-v2'});
 assert.equal((await D.drafts()).drafts.some(x=>x.id===d.id),false);
});
test('soft deletion retains Markdown and restore is a normal version-checked write',async()=>{
 const original=(await save(make())).note;
 const trashed=(await save({...original,deleted:true},original.revision)).note;
 assert.equal((await D.get(original.id)).note.markdown,original.markdown);
 assert.equal((await D.list({filter:{trash:true,scope:source.scope}})).items.some(n=>n.id===original.id),true);
 const restored=(await save({...trashed,deleted:false},trashed.revision)).note;assert.equal(restored.deleted,false);
});
test('note import is non-destructive, repeated conflicts deduplicate, stale backup does not resurrect trash',async()=>{
 const original=(await save(make())).note;
 const local=(await save({...original,markdown:'new local edit'},original.revision)).note;
 const data={format:'chatgpt-reading-annotations',version:1,notes:[original]};
 const imported=await D.importNotes(data);assert.equal(imported.copies,1);
 assert.equal((await D.get(local.id)).note.markdown,'new local edit');
 assert.equal((await D.importNotes(data)).copies,0);
 const deleted=(await save({...local,deleted:true},local.revision)).note;
 await D.importNotes(data);assert.equal((await D.get(local.id)).note.deleted,true);
 const before=await D.stats();await assert.rejects(()=>D.importNotes({...data,notes:[original,{...original,id:'bad'}]}));assert.deepEqual(await D.stats(),before);
});
test('keyset pagination, metadata-only lists, full-text search outside preview',async()=>{
 const sc=C.scope('/c/large-list',''),src={...source,scope:sc,progressKey:C.key(sc,'message:b')};
 const batch=Array.from({length:75},(_,i)=>({...make({source:src}),updatedAt:1000+i,createdAt:1000,revision:'import-'+i,markdown:'padding '.repeat(80)+(i===62?'SEARCH_AT_TAIL':'plain')}));
 await D.importNotes({format:'chatgpt-reading-annotations',version:1,notes:batch});
 let cursor=null,ids=[];
 do{const p=await D.list({filter:{scope:sc},cursor,limit:30});assert.ok(p.items.length<=30);ids.push(...p.items.map(n=>n.id));cursor=p.cursor;}while(cursor);
 assert.equal(ids.length,75);assert.equal(new Set(ids).size,75);
 const search=await D.list({filter:{scope:sc,query:'SEARCH_AT_TAIL'}});assert.equal(search.items.length,1);assert.equal(search.items[0].id,batch[62].id);
});
test('draft conversation promotion moves notes and drafts without rebinding other conversations',async()=>{
 const from=C.scope('/','temporary-a'),to=C.scope('/c/saved-a','');
 const src={...source,scope:from,progressKey:C.key(from,'message:c'),url:'https://chatgpt.com/'};
 const note=(await save(make({source:src}))).note;
 const d={id:crypto.randomUUID(),noteId:note.id,token:'draft',baseRevision:note.revision,title:note.title,tags:[],markdown:'draft',source:src};await D.putDraft(d);
 await D.promote(from,to,'https://chatgpt.com/c/saved-a');
 const got=(await D.get(note.id)).note;assert.equal(got.source.scope,to);assert.equal(got.source.url,'https://chatgpt.com/c/saved-a');
 assert.equal((await D.drafts()).drafts.find(x=>x.id===d.id).source.scope,to);
});
test('Markdown export preserves source and raw body, escapes metadata and omits deleted notes',()=>{
 const body='## My reasoning\n\n```cpp\nreturn 42;\n```';
 const note={...make({markdown:body,title:'title ](javascript:alert(1))'}),updatedAt:1,createdAt:1};
 const md=N.toMarkdown([note,{...note,id:crypto.randomUUID(),deleted:true}]);
 assert.ok(md.includes(body));assert.ok(md.includes(source.url));assert.equal(md.split('return 42;').length,2);assert.ok(md.includes('\\]\\('));
});


test('recovery drafts are paginated, metadata-only at startup and hydrated individually',async()=>{
 for(let i=0;i<65;i++)await D.putDraft({id:'paged-draft-'+String(i).padStart(3,'0'),noteId:'paged-note-'+String(i).padStart(3,'0'),token:'token-'+i,baseRevision:'',title:'草稿 '+i,tags:[],markdown:'草稿正文'.repeat(800),source:{scope:'general'}});
 const first=await D.drafts({metadataOnly:true,limit:30});
 assert.equal(first.drafts.length,30);assert.ok(first.total>=65);assert.ok(first.cursor);
 assert.ok(first.drafts.every(d=>!('markdown' in d)&&Number.isInteger(d.chars)));
 const second=await D.drafts({metadataOnly:true,limit:30,cursor:first.cursor});
 assert.equal(second.drafts.length,30);assert.ok(second.drafts.every(d=>!first.drafts.some(x=>x.id===d.id)));
 const full=await D.getDraft(first.drafts[0].id);assert.equal(full.draft.markdown.length,first.drafts[0].chars);
});
