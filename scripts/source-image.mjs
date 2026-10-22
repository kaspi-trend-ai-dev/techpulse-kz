// Editorial image retrieval from the cited original article.
// Copyright status is not verified by this module; attribution is not permission.
const meta=(html,key)=>{for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){const k=(tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)||[])[1];if(k?.toLowerCase()===key.toLowerCase())return (tag.match(/content\s*=\s*["']([^"']+)["']/i)||[])[1]||'';}return ''};
const absolute=(value,base)=>{try{const u=new URL(value,base);return u.protocol==='https:'?u.href:null}catch{return null}};
export async function licensedSourceImage(article){
 const source=article.sources?.[0]?.url;
 if(!source||!/^https:\/\//.test(source)||new URL(source).hostname.endsWith('news.google.com'))return null;
 try{
  const response=await fetch(source,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Mozilla/5.0 (compatible; TechPulseEditorial/1.0)'}});
  if(!response.ok)return null;
  const html=(await response.text()).slice(0,650000);
  const image=absolute(meta(html,'og:image')||meta(html,'twitter:image'),response.url);
  if(!image)return null;
  const title=meta(html,'og:title')||'';
  // Avoid unrelated site banners and home-page thumbnails.
  if(title&&article.title){const words=x=>new Set(String(x).toLowerCase().match(/[a-zа-яё0-9]{5,}/gi)||[]);const a=words(article.title),b=words(title);if(a.size&&b.size&&![...a].some(w=>b.has(w)))return null;}
  const author=meta(html,'author')||meta(html,'article:author')||'';
  return {url:image,source:response.url,credit:author||new URL(response.url).hostname,license:'Лицензия не проверена',alt:article.title,verified:true};
 }catch(e){console.warn('Original article image unavailable:',e.message)}
 return null;
}
