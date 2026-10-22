import fs from 'node:fs';
import {uniqueArticles} from './dedupe.mjs';
const folder='articles';
const items=fs.readdirSync(folder).filter(x=>x.endsWith('.json')).map(file=>JSON.parse(fs.readFileSync(folder+'/'+file,'utf8')));
const {kept,removed}=uniqueArticles(items);
for(const {article,kept:original} of removed){const path=folder+'/'+article.slug+'.json';if(fs.existsSync(path))fs.unlinkSync(path);console.log('REMOVED DUPLICATE:',article.slug,'=>',original.slug)}
console.log('Event deduplication:',{before:items.length,kept:kept.length,removed:removed.length});
