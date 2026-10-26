import fs from 'node:fs';
import {editorialQualityIssues} from './editorial-quality.mjs';
import {uniqueArticles} from './dedupe.mjs';

// Diagnostic triage only: flags are not proof of Google penalties, and nothing is deleted.
const folder='articles';
const files=fs.readdirSync(folder).filter(name=>name.endsWith('.json')).sort();
const articles=[],invalid=[];
for(const file of files){
  try {
    const a=JSON.parse(fs.readFileSync(folder+'/'+file,'utf8'));
    if(!a||typeof a!=='object'||Array.isArray(a))throw Error('Not an article object');
    articles.push(a);
  } catch(error){invalid.push({file,error:error.message})}
}
const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/g,' ').trim().replace(/\s+/g,' ');
const paragraphs=a=>(Array.isArray(a.sections)?a.sections:[]).flatMap(s=>Array.isArray(s.paragraphs)?s.paragraphs.filter(p=>typeof p==='string'):[]);
const occurrence=new Map();
for(const a of articles)for(const p of new Set(paragraphs(a).filter(p=>p.length>=90).map(norm))){
  occurrence.set(p,(occurrence.get(p)||0)+1);
}
const {removed}=uniqueArticles(articles.filter(a=>a.title&&a.slug));
const removedBySlug=new Map(removed.map(x=>[x.article.slug,x.kept.slug]));
const audit=[];
for(const a of articles){
  const issues=[];
  const ps=paragraphs(a),body=ps.join(' ');
  const title=String(a.title||''),description=String(a.description||'');
  const sources=Array.isArray(a.sources)?a.sources:[];
  // Original evergreen advice is not a syndicated news report; missing news sources is not necessarily an error.
  const isGuide=!sources.length && /телевизор|smart tv|экран/i.test(title+' '+a.category) && /^(как|почему|телевизор|выбор|определение)/i.test(title);
  const add=(type,weight,message)=>issues.push({type,weight,message});
  if(!/^[a-z0-9-]{8,110}$/.test(a.slug||''))add('technical',4,'Некорректный slug');
  if(!/^20\d\d-\d\d-\d\d$/.test(a.date||''))add('technical',3,'Нет корректной даты');
  if(!isGuide&&!sources.some(s=>/^https:\/\//.test(s.url||'')))add('source',4,'Нет источника с HTTPS');
  if(title.length<30)add('metadata',2,'Заголовок слишком короткий');
  if(title.length>125)add('metadata',2,'Заголовок слишком длинный');
  if(description.length<100)add('metadata',2,'Мало информации в описании');
  if(description.length>340)add('metadata',1,'Слишком длинное описание');
  if(body.length<700)add('depth',3,'Менее 700 знаков основного текста');
  if(ps.length<3)add('depth',2,'Меньше трёх содержательных абзацев');
  for(const msg of editorialQualityIssues(a))add('quality',4,msg);
  const repeated=ps.filter(p=>p.length>=90&&(occurrence.get(norm(p))||0)>=2).length;
  if(repeated>=2)add('repetition',4,repeated+' абзаца встречаются в нескольких статьях');
  if(removedBySlug.has(a.slug))add('duplicate',5,'Похожая статья: '+removedBySlug.get(a.slug));
  if(a.region==='kz'&&!/(казахстан|казах|алмат|астан|шымкент|област|республик|актоб|ақтөб|караган|қараған|павлодар|семей|кокшетау|көкшетау|атырау|актау|ақтау|костанай|қостанай|туркестан|түркістан|кызылорд|қызылорд|тараз|уральск|орал|усть-камен|өскемен|almaty|astana|kazakhstan)/i.test(title+' '+description))
    add('local',2,'Неочевидна связь с Казахстаном');
  if(a.region!=='kz'&&a.region!=='global')add('metadata',1,'Регион не указан');
  const facts=(body.match(/\d[\d,. ]*%?/g)||[]).length;
  if(facts===0&&body.length<1200)add('specificity',2,'Нет числовых данных при коротком материале (проверить вручную)');
  const score=issues.reduce((s,x)=>s+x.weight,0);
  audit.push({slug:a.slug||'',title,region:a.region||'unknown',date:a.date||'',score,bodyCharacters:body.length,paragraphs:ps.length,issues});
}
audit.sort((a,b)=>b.score-a.score||a.slug.localeCompare(b.slug));
const review=audit.filter(x=>x.score>=5),counts={};
for(const item of audit)for(const {type} of item.issues)counts[type]=(counts[type]||0)+1;
const summary={scanned:files.length,validJson:articles.length,invalidJson:invalid.length,
  reviewRecommended:review.length,highPriority:audit.filter(x=>x.score>=10).length,
  duplicateCandidates:removed.length,issueTypes:counts};
fs.mkdirSync('reports',{recursive:true});
fs.writeFileSync('reports/content-audit.json',JSON.stringify({summary,invalid,reviewQueue:audit.filter(x=>x.score>0)},null,2)+'\n');
const esc=s=>String(s).replace(/\|/g,'\\|').replace(/[\r\n]/g,' ');
const lines=[
 '# TechPulse — аудит архива статей','',
 '> Автоматическая первичная проверка: замечания — признаки для редактора, а не подтверждённые санкции Google. Скрипт ничего не удаляет и не меняет URL.','',
 '| Показатель | Количество |','|---|---:|',
 '| JSON-файлов в архиве | '+summary.scanned+' |',
 '| Успешно прочитаны | '+summary.validJson+' |',
 '| Статей для ручной проверки (оценка ≥5) | '+summary.reviewRecommended+' |',
 '| Высокий приоритет (оценка ≥10) | '+summary.highPriority+' |',
 '| Кандидатов на дубли | '+summary.duplicateCandidates+' |',
 '| Некорректных JSON | '+summary.invalidJson+' |','',
 '## Признаки для проверки','',
 ...Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([key,count])=>'- '+key+': '+count),
 '','## Первые 40 статей на редакционную проверку','',
 '| Оценка | Статья | Что проверить |','|---:|---|---|',
 ...review.slice(0,40).map(a=>'| '+a.score+' | ['+esc(a.title||a.slug)+'](https://harmex.asia/articles/'+encodeURIComponent(a.slug)+'.html) | '+esc(a.issues.slice(0,3).map(x=>x.message).join('; '))+' |'),
 '','## Дальнейшая работа','',
 '1. Проверять первоисточник, даты и факты перед переписыванием.',
 '2. Улучшать содержимое по существующему URL, не удаляя автоматически страницы с поисковым трафиком.',
 '3. Потенциальные дубли объединять только после проверки вручную.',
 '4. Следить за показами и кликами в Google Search Console после правок.',''
];
fs.writeFileSync('reports/CONTENT-QUALITY.md',lines.join('\n'));
console.log('CONTENT AUDIT:',JSON.stringify(summary));
console.log('TOP 10 REVIEW:',JSON.stringify(review.slice(0,10).map(a=>({title:a.title,slug:a.slug,score:a.score,issues:a.issues.map(x=>x.type)}))));
if(invalid.length){console.error('Unparseable article files:',JSON.stringify(invalid));process.exitCode=1}
