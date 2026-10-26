import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

// Frequent editorial work in short Actions windows, scheduled every five minutes.
// No daily article cap or per-hour article quota; runtime and repeated failures
// provide operational protection against unbounded API costs and stuck jobs.
const started=Date.now();
const runtimeMs=4*60*1000;
const maxConsecutiveFailures=3;
const count=()=>fs.readdirSync('articles').filter(x=>x.endsWith('.json')).length;
const before=count();
let published=0,attempts=0,consecutiveFailures=0;
let previousAttemptFailed=false;
console.log('HARMEX MEDIA continuous publishing:',{before,runtimeMinutes:4,articleQuota:'none',focus:'Kazakhstan and world news, source-based reporting'});
while(Date.now()-started<runtimeMs-20000&&consecutiveFailures<maxConsecutiveFailures){
 attempts++;
 // After a failed local attempt, try global sources before the failure limit.
 const region=process.env.EDITORIAL_REGION || (previousAttemptFailed?'global':(attempts%4===0?'global':'kz'));
 const remaining=runtimeMs-(Date.now()-started);
 const run=spawnSync(process.execPath,['scripts/generate.mjs'],{
  encoding:'utf8',
  env:{...process.env,EDITORIAL_ATTEMPT:String(attempts),EDITORIAL_REGION:region},
  timeout:Math.min(150000,Math.max(1000,remaining-10000))
 });
 const output=(run.stdout||'')+'\n'+(run.stderr||'');
 if(output)process.stdout.write(output);
 if(/credit_balance_exhausted|insufficient_quota|You have no credits remaining/i.test(output)){
  console.error('OPENAI_API_BILLING_REQUIRED: API credits exhausted; stopping attempts until billing is restored.');
  break;
 }
 const saved=count()-before;
 if(saved>published){
  published=saved;
  consecutiveFailures=0;
  previousAttemptFailed=false;
  console.log('Verified article files saved:',published,'total:',count());
 }else{
  consecutiveFailures++;
  previousAttemptFailed=region==='kz';
  console.warn('No verified article saved this attempt; searching next story.',{attempts,region,consecutiveFailures,status:run.status,error:run.error?.message});
 }
}
console.log('Editorial batch summary:',{attempts,published,total:count(),durationSeconds:Math.round((Date.now()-started)/1000),consecutiveFailures});
if(published===0){
 console.error('No article published this run; inspect source and generation errors.');
 process.exitCode=1;
}else{
 console.log('APPROVED ARTICLES RETAINED:',published,'Rejected attempts do not discard them.');
}
