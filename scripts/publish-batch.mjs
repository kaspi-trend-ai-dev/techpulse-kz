import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

// Continuous editorial work during each hourly Actions window.
// No daily article cap or per-hour article quota; runtime and repeated failures
// provide operational protection against unbounded API costs and stuck jobs.
const started=Date.now();
const runtimeMs=45*60*1000;
const maxConsecutiveFailures=6;
const count=()=>fs.readdirSync('articles').filter(x=>x.endsWith('.json')).length;
const before=count();
let published=0,attempts=0,consecutiveFailures=0;
console.log('TechPulse continuous publishing:',{before,runtimeMinutes:45,articleQuota:'none',focus:'TV purchase-intent traffic'});
while(Date.now()-started<runtimeMs-180000&&consecutiveFailures<maxConsecutiveFailures){
 attempts++;
 const remaining=runtimeMs-(Date.now()-started);
 const run=spawnSync(process.execPath,['scripts/generate.mjs'],{
  stdio:'inherit',
  env:{...process.env,EDITORIAL_ATTEMPT:String(attempts)},
  timeout:Math.min(180000,Math.max(1000,remaining))
 });
 if(run.status===0){
  published++;
  consecutiveFailures=0;
  console.log('Published article',published,'total',count());
 }else{
  consecutiveFailures++;
  console.warn('Candidate failed; searching next story.',{attempts,consecutiveFailures,status:run.status,error:run.error?.message});
 }
}
console.log('Editorial batch summary:',{attempts,published,total:count(),durationSeconds:Math.round((Date.now()-started)/1000),consecutiveFailures});
if(published===0){
 console.error('No article published this run; inspect source and generation errors.');
 process.exitCode=1;
}
