import fs from 'node:fs';
import {licensedSourceImage} from './source-image.mjs';
const folder='articles';
const files=fs.readdirSync(folder).filter(f=>f.endsWith('.json'));
let checked=0,added=0,removed=0;
for(const file of files){
 const path=folder+'/'+file;
 const a=JSON.parse(fs.readFileSync(path,'utf8'));
 // Recheck any old images; old keyword matches are not sufficient evidence.
 const prior=Boolean(a.image);
 const image=await licensedSourceImage(a);
 if(image){a.image=image;added++}else if(prior){console.log('Keeping existing image when source lookup has no replacement:',a.slug)}
 delete a.imageCheckedAt;
 checked++;
 if(image||!prior)fs.writeFileSync(path,JSON.stringify(a,null,2)+'\n');
}
console.log('Source-image rights audit:',{checked,withVerifiedImages:added,removedUnverified:removed});
