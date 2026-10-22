import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

// Cumulative daily quota: recover missed hourly slots instead of dropping them.
const now=new Date();
const almaty=new Date(now.getTime()+5*60*60*1000);
const today=almaty.toISOString().slice(0,10),hour=almaty.getUTCHours();
const manual=process.env.GITHUB_EVENT_NAME==='workflow_dispatch';
const target=50;
const countToday=()=>fs.readdirSync('articles').filter(x=>x.endsWith('.json')).filter(x=>{
 try{return JSON.parse(fs.readFileSync('articles/'+x,'utf8')).date===today}catch{return false}
}).length;
const plannedByNow=2*(hour+1)+(hour>=2?1:0)+(hour>=14?1:0);
const starting=countToday();
const quota=Math.max(0,Math.min(target-starting,manual?3:plannedByNow-starting));
const maxAttempts=Math.min(24,Math.max(quota*3,quota+3));
console.log('TechPulse publication target:',{today,hour,timezone:'Asia/Almaty',manual,starting,plannedByNow,quota,maxAttempts,target});
let succeeded=0,attempts=0;
while(succeeded<quota&&attempts<maxAttempts){
 attempts++;
 const run=spawnSync(process.execPath,['scripts/generate.mjs'],{
  stdio:'inherit',env:{...process.env,EDITORIAL_ATTEMPT:String(attempts)},
  timeout:180000
 });
 if(run.status===0){succeeded++;continue}
 console.warn('Candidate failed, trying another news story.',{attempts,status:run.status,error:run.error?.message});
}
console.log('Editorial batch summary:',{attempts,succeeded,nowPublished:countToday(),plannedByNow,target});
if(succeeded<quota){
 console.error('Publication shortfall: remaining articles will be retried by next hourly run.');
 process.exitCode=1;
}
