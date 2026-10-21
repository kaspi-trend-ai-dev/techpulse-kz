import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

// 2 articles per hour, with a third at 02:00 and 14:00 UTC = 50/day.
const now=new Date();
const today=now.toISOString().slice(0,10);
const hour=now.getUTCHours();
const target=50;
const scheduled=2+([2,14].includes(hour)?1:0);
const countToday=()=>fs.readdirSync('articles').filter(x=>x.endsWith('.json')).filter(x=>{
 try{return JSON.parse(fs.readFileSync('articles/'+x,'utf8')).date===today}catch{return false}
}).length;
const existing=countToday();
const quota=Math.max(0,Math.min(scheduled,target-existing));
console.log('TechPulse editorial batch:',{today,hour,existing,quota,target});
let succeeded=0;
for(let i=0;i<quota;i++){
 const run=spawnSync(process.execPath,['scripts/generate.mjs'],{stdio:'inherit',env:process.env,timeout:180000});
 if(run.status===0){succeeded++;continue}
 console.warn('Article candidate rejected; skipping rather than publishing unverified material.',{attempt:i+1,status:run.status,error:run.error?.message});
}
console.log('Batch finished:',{succeeded,nowPublished:countToday(),target});
if(succeeded===0&&quota>0)console.warn('No approved news published in this batch. Next scheduled run will retry.');
