import fs from 'node:fs';
const folder='articles';
const files=fs.readdirSync(folder).filter(f=>f.endsWith('.json'));
const decode=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').trim();
const stop=new Set(['with','from','that','this','will','after','about','could','would','their','first','latest','reveals','launches','announces','report','update','review','smart','technology','these','those','what','which','into','over','more','than']);
const checked=files.map(file=>({file,a:JSON.parse(fs.readFileSync(folder+'/'+file,'utf8'))})).filter(({a})=>!a.image&&!a.imageCheckedAt).slice(0,35);
let added=0;
for(const {file,a} of checked){
 const headline=a.sources?.[0]?.title||'';
 const words=(headline.replace(/\s+-\s+[^-]+$/,'').match(/[A-Za-z][A-Za-z0-9-]{3,}/g)||[]).map(x=>x.toLowerCase());
 const terms=[...new Set(words.filter(w=>!stop.has(w)))].slice(0,6);
 if(terms.length>=2){
  try{
   const url=new URL('https://commons.wikimedia.org/w/api.php');
   Object.entries({action:'query',generator:'search',gsrsearch:terms.slice(0,4).join(' ')+' filetype:bitmap',gsrnamespace:'6',gsrlimit:'10',prop:'imageinfo',iiprop:'url|extmetadata|size',iiurlwidth:'1200',format:'json'}).forEach(([k,v])=>url.searchParams.set(k,v));
   const response=await fetch(url,{headers:{'User-Agent':'TechPulseEditorial/1.0 (automated licensed-image search)'},signal:AbortSignal.timeout(10000)});
   if(response.ok){
    const pages=Object.values((await response.json()).query?.pages||{});
    for(const p of pages){
     const info=p.imageinfo?.[0],meta=info?.extmetadata||{};
     const license=decode(meta.LicenseShortName?.value);
     if(!info?.thumburl||info.width<700||info.height<350||!/^(CC BY|CC0|Public domain|PD-)/i.test(license))continue;
     if(terms.filter(t=>p.title.toLowerCase().includes(t)).length<2)continue;
     a.image={url:info.thumburl,alt:a.title,credit:decode(meta.Artist?.value).slice(0,160)||'Wikimedia Commons',license,source:info.descriptionurl,verified:true};
     added++;
     break;
    }
   }
  }catch(e){console.warn('Image search failed:',file,e.message)}
 }
 a.imageCheckedAt=new Date().toISOString();
 fs.writeFileSync(folder+'/'+file,JSON.stringify(a,null,2)+'\n');
}
console.log('Image backfill:',{checked:checked.length,added,remaining:files.length-checked.length});
