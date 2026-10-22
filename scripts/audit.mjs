import fs from 'node:fs';
import {uniqueArticles} from './dedupe.mjs';
const root='dist';
const fail=[];
const required=['index.html','robots.txt','sitemap.xml','CNAME','assets/style.css'];
for(const p of required)if(!fs.existsSync(root+'/'+p))fail.push('Missing '+p);
const isRussian=a=>{const parts=[a.title,a.description,...(a.sections||[]).flatMap(s=>[s.heading,...(s.paragraphs||[])])].filter(x=>typeof x==='string');return parts.length>=4&&parts.every(t=>(t.match(/[а-яё]/gi)||[]).length>=Math.max(12,(t.match(/[a-zа-яё]/gi)||[]).length*.28))};
const articles=fs.readdirSync('articles').filter(x=>x.endsWith('.json')).map(x=>JSON.parse(fs.readFileSync('articles/'+x,'utf8'))).filter(isRussian);
const {kept,removed}=uniqueArticles(articles);
if(removed.length)console.log('Historical duplicates excluded from build:',removed.map(x=>x.article.slug));
const seen=new Set();
for(const a of kept){
 if(!/^[a-z0-9-]+$/.test(a.slug||''))fail.push('Invalid slug: '+a.slug);
 if(seen.has(a.slug))fail.push('Duplicate slug: '+a.slug);
 seen.add(a.slug);
 if(!a.title||!a.description||!/^\d{4}-\d{2}-\d{2}$/.test(a.date||''))fail.push('Incomplete metadata: '+a.slug);
 if(!Array.isArray(a.sections)||!a.sections.length||a.sections.some(s=>!s.heading||!Array.isArray(s.paragraphs)||!s.paragraphs.length))fail.push('Incomplete article: '+a.slug);
 const page=root+'/articles/'+a.slug+'.html';
 if(!fs.existsSync(page)){fail.push('Missing article HTML: '+a.slug);continue}
 const html=fs.readFileSync(page,'utf8');
 if(!html.includes('<link rel="canonical" href="https://harmex.asia/articles/'+a.slug+'.html">'))fail.push('Canonical mismatch: '+a.slug);
 if(!html.includes('application/ld+json'))fail.push('Missing structured data: '+a.slug);
}
const sitemap=fs.existsSync(root+'/sitemap.xml')?fs.readFileSync(root+'/sitemap.xml','utf8'):'';
for(const a of kept)if(!sitemap.includes('https://harmex.asia/articles/'+a.slug+'.html'))fail.push('Not in sitemap: '+a.slug);
if(!sitemap.includes('https://harmex.asia/'))fail.push('Homepage not in sitemap');
if(fs.existsSync(root+'/CNAME')&&fs.readFileSync(root+'/CNAME','utf8').trim()!=='harmex.asia')fail.push('Wrong custom domain');
if(fail.length){console.error('AUDIT FAILED:\n'+fail.join('\n'));process.exit(1)}
console.log('AUDIT OK:',kept.length,'articles, canonical URLs, sitemap, schema, domain and assets');
