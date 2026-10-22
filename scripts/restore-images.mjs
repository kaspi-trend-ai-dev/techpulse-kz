// Recover previously saved source images from Git history without overwriting newer images.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const dir='articles';
let restored=0,already=0,missing=0;
const history=execFileSync('git',['log','--format=%H','--',dir],{encoding:'utf8',maxBuffer:1024*1024}).trim().split('\n').filter(Boolean);
for(const file of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))){
 const path=dir+'/'+file;
 const article=JSON.parse(fs.readFileSync(path,'utf8'));
 if(article.image?.verified&&article.image?.url){already++;continue}
 let found=null;
 for(const sha of history){
  try{
   const old=JSON.parse(execFileSync('git',['show',sha+':'+path],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:2500}));
   if(old.image?.verified&&/^https:\/\//.test(old.image.url||'')){found=old.image;break}
  }catch{}
 }
 if(found){article.image=found;fs.writeFileSync(path,JSON.stringify(article,null,2)+'\n');restored++}
 else missing++;
}
console.log('Historical image recovery:',{restored,alreadyWithImages:already,noHistoricalImage:missing});
