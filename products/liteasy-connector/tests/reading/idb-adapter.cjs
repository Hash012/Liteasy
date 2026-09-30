/* TEST ONLY: asynchronous IndexedDB API adapter for restricted about:blank tests.
 * Production uses the browser's IndexedDB. This tests callback/transaction logic,
 * but is NOT evidence of native IDB durability or quota behavior. */
(() => {
  const clone=x=>x===undefined?undefined:structuredClone(x);
  const compare=(a,b)=>{
    if(Array.isArray(a)&&Array.isArray(b)){
      for(let i=0;i<Math.min(a.length,b.length);i++){const c=compare(a[i],b[i]);if(c)return c;}return a.length-b.length;
    }
    return a<b?-1:a>b?1:0;
  };
  class Range {
    constructor(lower,upper,lo=false,uo=false){Object.assign(this,{lower,upper,lowerOpen:lo,upperOpen:uo});}
    includes(x){return (this.lower===undefined||(this.lowerOpen?compare(x,this.lower)>0:compare(x,this.lower)>=0))&&
      (this.upper===undefined||(this.upperOpen?compare(x,this.upper)<0:compare(x,this.upper)<=0));}
    static bound(a,b,l=false,u=false){return new Range(a,b,l,u);}static upperBound(b,u=false){return new Range(undefined,b,false,u);}static only(x){return new Range(x,x);}
  }
  globalThis.IDBKeyRange=Range;
  const states=globalThis.__idbStates=Object.create(null);
  let tail=Promise.resolve();
  class Transaction {
    constructor(database,names,mode){
      this.database=database;this.names=names;this.mode=mode;this.queue=[];this.active=false;this.finished=false;this.error=null;
      const predecessor=tail;tail=new Promise(resolve=>{this.release=resolve;});
      predecessor.then(()=>{
        this.maps={};for(const name of names)this.maps[name]=new Map(database.stores[name].values);
        this.active=true;this.pump();
      });
    }
    objectStore(name){if(!this.names.includes(name))throw new Error('store not in transaction');return new Store(this,name);}
    request(work){const req={result:undefined,error:null};this.queue.push({req,work});if(this.active)this.pump();return req;}
    again(req,work){this.queue.push({req,work});if(this.active)this.pump();}
    pump(){
      if(this.running||this.finished)return;
      this.running=true;
      setTimeout(()=>{
        this.running=false;if(this.finished)return;
        const job=this.queue.shift();
        if(!job){
          this.finished=true;
          if(this.mode==='readwrite')for(const name of this.names)this.database.stores[name].values=new Map(this.maps[name]);
          this.oncomplete?.({target:this});this.release();return;
        }
        try{job.req.result=job.work();job.req.onsuccess?.({target:job.req});}
        catch(e){job.req.error=e;this.error=e;job.req.onerror?.({target:job.req});this.abort();return;}
        this.pump();
      },0);
    }
    abort(){if(this.finished)return;this.finished=true;this.queue=[];setTimeout(()=>{this.onabort?.({target:this});this.release();},0);}
  }
  class Store {
    constructor(tx,name,index=null){Object.assign(this,{tx,name,indexName:index});}
    get map(){return this.tx.maps[this.name];}
    get(key){return this.tx.request(()=>clone(this.map.get(key)));}
    put(value){return this.tx.request(()=>{if(this.tx.mode!=='readwrite')throw new Error('ReadonlyError');const copy=clone(value);this.map.set(copy.id,copy);return copy.id;});}
    delete(key){return this.tx.request(()=>{this.map.delete(key);});}
    clear(){return this.tx.request(()=>{this.map.clear();});}
    count(){return this.tx.request(()=>this.map.size);}
    getAll(){return this.tx.request(()=>[...this.map.values()].map(clone));}
    index(name){return new Store(this.tx,this.name,name);}
    openCursor(range,direction='next'){
      const self=this;let entries,index=0,req;
      function step(){
        if(!entries){
          const path=self.indexName?self.tx.database.stores[self.name].indexes[self.indexName]:'id';
          entries=[...self.map.values()].map(value=>({primaryKey:value.id,key:Array.isArray(path)?path.map(k=>value[k]):value[path]}))
            .filter(e=>!range||range.includes(e.key)).sort((a,b)=>compare(a.key,b.key));
          if(direction==='prev')entries.reverse();
        }
        if(index>=entries.length)return null;
        const e=entries[index];
        return {...e,value:clone(self.map.get(e.primaryKey)),continue(){index++;self.tx.again(req,step);},update(value){return self.put(value);}};
      }
      req=this.tx.request(step);return req;
    }
  }
  const factory={open(name,version){
    const req={};setTimeout(()=>{
      const fresh=!states[name];
      const state=states[name]||(states[name]={version,stores:{}});
      req.result={createObjectStore(n){state.stores[n]={values:new Map(),indexes:{}};return{createIndex(i,path){state.stores[n].indexes[i]=path;}};},
        transaction(names,mode){return new Transaction(state,Array.isArray(names)?names:[names],mode);},close(){},onversionchange:null};
      if(fresh)req.onupgradeneeded?.({target:req});req.onsuccess?.({target:req});
    },0);return req;
  }};
  Object.defineProperty(globalThis,'indexedDB',{value:factory,configurable:true});
  globalThis.__idbSnapshot=()=>Object.fromEntries(Object.entries(states).map(([n,s])=>[n,{version:s.version,stores:Object.fromEntries(Object.entries(s.stores).map(([k,v])=>[k,{indexes:v.indexes,values:[...v.values]}]))}]));
  globalThis.__idbRestore=data=>{for(const [n,s]of Object.entries(data)){states[n]={version:s.version,stores:Object.fromEntries(Object.entries(s.stores).map(([k,v])=>[k,{indexes:v.indexes,values:new Map(v.values)}]))};}};
})();
