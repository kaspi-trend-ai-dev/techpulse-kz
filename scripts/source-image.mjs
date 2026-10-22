// Prefer the actual article photograph over branded social preview images.
// Attribution is not a license: publishers must still have permission to reuse photos.
const meta=(html,key)=>{for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){const k=(tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)||[])[1];if(k?.toLowerCase()===key.toLowerCase())return (tag.match(/content\s*=\s*["']([^"']+)["']/i)||[])[1]||'';}return ''};
const absolute=(value,base)=>{try{const u=new URL(value,base);return u.protocol==='https:'?u.href:null}catch{return null}};
const rejectImage=url=>!url||/(?:logo|watermark|avatar|icon|sprite|banner|advert|placeholder|default|favicon|kursiv[-_]?logo)/i.test(new URL(url).pathname);
const imageFromBody=(html,base)=>{
 const candidates=[];
 const blocks=[...html.matchAll(/<(?:figure|picture)\b[^>]*>[\s\S]{0,5000}?<\/(?:figure|picture)>/gi)].map(x=>x[0]);
 const article=(html.match(/<article\b[^>]*>[\s\S]{0,250000}?<\/article>/i)||[])[0]||'';
 if(article)blocks.push(article);
 for(const block of blocks){
  for(const match of block.matchAll(/<img\b[^>]*>/gi)){
   const tag=match[0];
   const value=(tag.match(/(?:data-src|data-original|src)\s*=\s*["']([^"']+)["']/i)||[])[1];
   const src=absolute(value,base);
   if(!src||rejectImage(src))continue;
   const width=Number((tag.match(/\bwidth\s*=\s*["']?(\d+)/i)||[])[1]||0);
   const height=Number((tag.match(/\bheight\s*=\s*["']?(\d+)/i)||[])[1]||0);
   if((width&&width<400)||(height&&height<220))continue;
   const alt=(tag.match(/\balt\s*=\s*["']([^"']*)["']/i)||[])[1]||'';
   candidates.push({url:src,alt});
  }
 }
 return candidates[0]||null;
};
export async function licensedSourceImage(article){
 const source=article.sources?.[0]?.url;
 if(!source||!/^https:\/\//.test(source)||new URL(source).hostname.endsWith('news.google.com'))return null;
 try{
  const response=await fetch(source,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Mozilla/5.0 (compatible; TechPulseEditorial/1.0)'}});
  if(!response.ok)return null;
  const html=(await response.text()).slice(0,650000);
  const original=imageFromBody(html,response.url);
  // Avoid fallback to branded social cards if no article-body photo is found.
  if(!original)return null;
  const author=meta(html,'author')||meta(html,'article:author')||'';
  return {url:original.url,source:response.url,credit:author||new URL(response.url).hostname,license:'Лицензия не проверена',alt:original.alt||article.title,verified:true};
 }catch(e){console.warn('Original article image unavailable:',e.message)}
 return null;
}
