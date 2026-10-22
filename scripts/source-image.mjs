// Only reuse the exact lead image from the cited source when that page explicitly
// declares a reusable Creative Commons license. Attribution alone is not permission.
const meta=(html,key)=>{for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){const k=(tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)||[])[1];if(k?.toLowerCase()===key.toLowerCase())return (tag.match(/content\s*=\s*["']([^"']+)["']/i)||[])[1]||'';}return ''};
const absolute=(value,base)=>{try{const u=new URL(value,base);return u.protocol==='https:'?u.href:null}catch{return null}};
export async function licensedSourceImage(article){
 const source=article.sources?.[0]?.url;
 if(!source||!/^https:\/\//.test(source)||new URL(source).hostname.endsWith('news.google.com'))return null;
 try{
  const response=await fetch(source,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'TechPulseEditorial/1.0'}});
  if(!response.ok)return null;
  const html=(await response.text()).slice(0,650000);
  const image=absolute(meta(html,'og:image'),response.url);
  if(!image)return null;
  // Missing license metadata is not treated as a prohibition; inspect any image-specific rights data.\n  // But missing permission cannot itself authorize republication.\n  // Page-wide copyright metadata is NOT a license for the photograph.
  // Require a license URL explicitly associated with the image in structured data.
  const scripts=[...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
  const objects=[];
  const visit=x=>{if(!x||typeof x!=='object')return;if(Array.isArray(x)){x.forEach(visit);return}objects.push(x);Object.values(x).forEach(v=>{if(typeof v==='object')visit(v)})};
  for(const script of scripts){try{visit(JSON.parse(script))}catch{}}
  for(const o of objects){
   const candidate=absolute(typeof o.contentUrl==='string'?o.contentUrl:typeof o.url==='string'?o.url:'',response.url);
   if(!candidate||candidate!==image)continue;
   const license=typeof o.license==='string'?o.license:o.license?.url||'';
   if(!/^https:\/\/creativecommons\.org\/licenses\/(by|by-sa|by-nd|by-nc|by-nc-sa|by-nc-nd)\/\d\.\d\/?/i.test(license)&&!/^https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/?/i.test(license))continue;
   // NC licenses cannot be used on this commercial website. ND is excluded.
   if(/\/by-nc|\/by-nd/i.test(license))continue;
   const credit=typeof o.creditText==='string'?o.creditText:typeof o.creator?.name==='string'?o.creator.name:typeof o.author?.name==='string'?o.author.name:'';
   if(!credit)continue;
   return {url:image,source:response.url,credit,license,alt:article.title,verified:true};
  }
 }catch(e){console.warn('Original image rights unavailable:',e.message)}
 return null;
}
