import { performance } from "node:perf_hooks";
import { hybridRank } from "./index.mjs";
const vector = (seed) => Array.from({length:768},(_,index)=>((seed*31+index*17)%997)/997);
const candidates=Array.from({length:200},(_,index)=>({id:`paper-${index}`,title:`Database transactions and memory retrieval ${index}`,abstract:"Database transaction scheduling, concurrency control, recovery and retrieval. ".repeat(20),vector:vector(index)}));
const views=Array.from({length:8},(_,index)=>({id:`view-${index}`,kind:index<3?"document":index<6?"annotation":"profile",title:"Reading question",text:"database transaction concurrency memory retrieval scheduling recovery",vector:vector(index+20)}));
const timings=[];
for(let index=0;index<35;index++){const start=performance.now();hybridRank(candidates,views);if(index>=5)timings.push(performance.now()-start);}
timings.sort((a,b)=>a-b);
console.log(JSON.stringify({candidates:200,views:8,dimensions:768,samples:timings.length,fusionP95Ms:timings[28],platform:process.platform,architecture:process.arch,peakRssBytes:process.resourceUsage().maxRSS*1024}));
