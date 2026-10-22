import fs from 'node:fs';

const key = process.env.OPENAI_API_KEY;
if (!key) throw Error('Set OPENAI_API_KEY secret');
const files = fs.readdirSync('articles').filter(x => x.endsWith('.json'));
const existing = files.map(x => JSON.parse(fs.readFileSync('articles/' + x, 'utf8')));
const today = new Date().toISOString().slice(0, 10);
const decode = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const extract = (s, tag) => decode((s.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>')) || [,''])[1]).trim();
const attempt=Number(process.env.EDITORIAL_ATTEMPT||1);
const topics = [
  'Apple iPhone iPad Mac technology launch',
  'Samsung Xiaomi Sony LG new gadgets TV',
  'Elon Musk Tesla SpaceX technology',
  'OpenAI Google Microsoft NVIDIA AI announcements',
  'technology gadgets smartphones innovations',
  'cybersecurity privacy data breach technology',
  'gaming consoles PlayStation Xbox Nintendo Steam',
  'robotics science chip semiconductors breakthrough',
  'Google Android Meta WhatsApp social media updates',
  'electric vehicles batteries energy technology'
];
const headlines = [];
for (const topic of topics) {
  try {
    const feed = 'https://news.google.com/rss/search?q=' + encodeURIComponent(topic + ' when:3d') + '&hl=en-US&gl=US&ceid=US:en';
    const response = await fetch(feed, {headers: {'User-Agent': 'TechPulseEditorial/1.0'}, signal: AbortSignal.timeout(12000)});
    if (!response.ok) continue;
    const xml = await response.text();
    for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const item = match[1];
      const title = extract(item, 'title'), link = extract(item, 'link'), date = extract(item, 'pubDate');
      if (!title || !/^https:\/\/news\.google\.com\//.test(link)) continue;
      const timestamp = Date.parse(date);
      if (!Number.isFinite(timestamp) || Date.now() - timestamp > 3 * 86400000 || timestamp > Date.now() + 3600000) continue;
      if (headlines.some(h => h.title.toLowerCase() === title.toLowerCase())) continue;
      headlines.push({title, url: link, published: new Date(timestamp).toISOString().slice(0,10)});
    }
  } catch (e) { console.warn('RSS unavailable:', topic, e.message); }
}
// Publisher RSS feeds expose direct article URLs; Google News RSS URLs often do not.
const publisherFeeds=[
 'https://techcrunch.com/feed/',
 'https://www.theverge.com/rss/index.xml',
 'https://www.engadget.com/rss.xml',
 'https://www.wired.com/feed/rss',
 'https://arstechnica.com/feed/'
];
for(const feed of publisherFeeds){
 try{
  const response=await fetch(feed,{headers:{'User-Agent':'Mozilla/5.0 TechPulseEditorial/1.0'},signal:AbortSignal.timeout(9000)});
  if(!response.ok)continue;
  const xml=await response.text();
  for(const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)){
   const item=match[1],title=extract(item,'title'),link=extract(item,'link'),date=extract(item,'pubDate');
   const timestamp=Date.parse(date);
   if(!title||!/^https:\/\//.test(link)||!Number.isFinite(timestamp)||Date.now()-timestamp>3*86400000||timestamp>Date.now()+3600000)continue;
   if(headlines.some(h=>h.title.toLowerCase()===title.toLowerCase()))continue;
   headlines.push({title,url:link,published:new Date(timestamp).toISOString().slice(0,10)});
  }
 }catch(error){console.warn('Publisher RSS unavailable:',feed,error.message)}
}
// Fetch readable excerpts from original publishers where Google News exposes their URLs.
// Reject sources with no verifiable article text; a headline alone is insufficient.
const stripHtml=html=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
async function fetchEvidence(entry){
 try{
  const response=await fetch(entry.url,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; TechPulseEditorial/1.0)'},signal:AbortSignal.timeout(9000)});
  if(!response.ok)return null;
  const finalUrl=response.url;
  if(!/^https:\/\//.test(finalUrl)||new URL(finalUrl).hostname.endsWith('news.google.com'))return null;
  const html=(await response.text()).slice(0,500000);
  const article=(html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i)||[])[0]||html;
  const body=stripHtml(article);
  if(body.length<800)return null;
  return {url:finalUrl,excerpt:body.slice(0,9500)};
 }catch{return null}
}
// Rank current topics by recency, multiple independent headline mentions, and broad consumer interest.
const normalize=s=>s.toLowerCase().replace(/\s+-\s+[^-]+$/,'').replace(/[^a-z0-9а-яё ]/gi,' ').replace(/\s+/g,' ').trim();
const tokens=s=>new Set(normalize(s).split(' ').filter(w=>w.length>3&&!['about','after','with','from','will','that','this','technology','latest','news'].includes(w)));
const similarity=(a,b)=>{const x=tokens(a),y=tokens(b);const shared=[...x].filter(w=>y.has(w)).length;return shared/Math.max(1,Math.min(x.size,y.size))};
const publishedTitles=existing.map(x=>x.title);
const ranked=headlines.filter(h=>!publishedTitles.some(t=>similarity(h.title,t)>=0.65)).map(h=>{
 const age=(Date.now()-Date.parse(h.published+'T12:00:00Z'))/86400000;
 const mentions=headlines.filter(other=>other!==h&&similarity(h.title,other.title)>=0.65).length;
 const relevance=/apple|iphone|samsung|tesla|spacex|openai|chatgpt|google|nvidia|microsoft|xiaomi|ai |robot|launch|unveil|announce|release|breakthrough|billion|viral/i.test(h.title)?2:0;
 return {...h,score:Math.max(0,3-age)+Math.min(5,mentions*1.5)+relevance};
}).sort((a,b)=>b.score-a.score);
if (ranked.length < 5) throw Error('Not enough distinct recent news headlines; refusing to fabricate or repeat news');
// Try high-ranked stories until one has substantive source evidence.
const evidence=[];
const direct=ranked.filter(h=>!new URL(h.url).hostname.endsWith('news.google.com'));
const offset=direct.length?((attempt-1)*7)%direct.length:0;
const candidates=[...direct.slice(offset),...direct.slice(0,offset)].slice(0,40);
for(let i=0;i<candidates.length&&evidence.length<8;i+=5){
 const group=await Promise.all(candidates.slice(i,i+5).map(async item=>{
  const found=await fetchEvidence(item);
  return found?{...item,sourceUrl:found.url,excerpt:found.excerpt}:null;
 }));
 evidence.push(...group.filter(Boolean));
}
if(!evidence.length)throw Error('No readable publisher articles found; skipping unverified publication');
const previous = existing.slice(-100).map(a => a.title);
const rotated=evidence.length?((attempt-1)%evidence.length):0;
const chosenEvidence=[...evidence.slice(rotated),...evidence.slice(0,rotated)];
const prompt = [
  'Ты редактор русскоязычного технологического медиа TechPulse для Казахстана.',
  'Создай ОДНУ интересную, динамичную новостную статью на основе ТОЛЬКО приведённых ниже реальных заголовков новостной ленты за последние 3 дня. Новости отсортированы по актуальности, упоминаниям и интересу широкой аудитории.',
  'Приоритет отдавай первому подходящему источнику в списке, чтобы повторные попытки выбирали разные новости. Выбери один конкретный инфоповод о популярных брендах, гаджетах, известных предпринимателях, ИИ или технологиях. Заголовок цепляющий, но правдивый, без кликбейта, преувеличений и неподтверждённых фактов.',
  'Доступны выдержки из текстов первоисточников. Используй только явно подтверждённые ими факты; не придумывай цитаты, цифры, характеристики, даты и заявления. Различай официальное подтверждение и сообщения журналистов. Не пиши будто тестировал устройство.',
  'Вместо вымышленных подробностей объясни, почему событие важно, что пока неизвестно, и что стоит проверить дальше. Никаких слухов как установленных фактов.',
  'Выбери одну новость из списка с текстом первоисточника. Верни в sources ТОЧНО её title, url, published. Ссылку не изменяй. Если данных недостаточно, выбери другую.',
  'Текст естественный, читаемый, 3-5 разделов, по 2-3 содержательных абзаца, без искусственного SEO-спама. Реклама HARMEX добавляется на сайте отдельно.',
  'Не повторяй опубликованные темы: ' + previous.join('; '),
  'Верни JSON: slug (латиница, цифры и дефисы), title, description, date (строго ' + today + '), category, sections (массив {heading, paragraphs: массив строк}), sources (массив из одного объекта {title,url,published}).',
  'Доступные новости:\n' + JSON.stringify(chosenEvidence.map(({score,...h})=>h))
].join('\n\n');
const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
  body: JSON.stringify({model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', response_format: {type: 'json_object'}, messages: [{role: 'system', content: 'Return valid JSON only. Stay faithful to supplied evidence.'}, {role: 'user', content: prompt}]})
});
if (!res.ok) throw Error(await res.text());
const a = JSON.parse((await res.json()).choices[0].message.content);
const slugify = value => String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
const structuralIssues = article => {
  const issues = [];
  if (!article || typeof article !== 'object') return ['response is not an object'];
  if (!article.title || typeof article.title !== 'string') issues.push('missing title');
  if (!article.description || typeof article.description !== 'string') issues.push('missing description');
  if (!Array.isArray(article.sections) || article.sections.length < 3 || article.sections.length > 5) issues.push('sections count must be 3-5');
  else article.sections.forEach((section, index) => {
    if (!section.heading) issues.push('section ' + index + ' missing heading');
    if (!Array.isArray(section.paragraphs) || section.paragraphs.length < 2) issues.push('section ' + index + ' needs 2 paragraphs');
    else if (section.paragraphs.some(p => typeof p !== 'string' || p.trim().length < 70)) issues.push('section ' + index + ' has short/invalid paragraphs');
  });
  if (!Array.isArray(article.sources) || article.sources.length !== 1 || !evidence.some(h => h.title === article.sources[0]?.title && h.url === article.sources[0]?.url && h.published === article.sources[0]?.published)) issues.push('source not found in fetched headlines');
  if (!/^[a-z0-9-]{8,110}$/.test(article.slug || '')) issues.push('invalid slug');
  if (existing.some(e => similarity(e.title,String(article.title||''))>=0.65)) issues.push('duplicate or near-duplicate topic');
  if (fs.existsSync('articles/' + article.slug + '.json')) issues.push('duplicate slug');
  return issues;
};
a.slug = slugify(a.slug);
let initialIssues = structuralIssues(a);
for (let attempt = 0; attempt < 2 && initialIssues.length; attempt++) {
  console.warn('Draft structure correction', attempt + 1, JSON.stringify(initialIssues));
  const correction = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
    body: JSON.stringify({model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', response_format: {type: 'json_object'}, messages: [
      {role: 'system', content: 'Repair the JSON structure only. Do not add factual claims. Output JSON.'},
      {role: 'user', content: 'Fix these validation problems: ' + JSON.stringify(initialIssues) + '. Choose exactly one source from this list, copying title/url/published byte for byte: ' + JSON.stringify(chosenEvidence.map(({score,...h})=>h)) + '. Avoid published titles: ' + JSON.stringify(previous) + '. Return the complete corrected article JSON. Draft: ' + JSON.stringify(a)}
    ]})});
  if (!correction.ok) throw Error('Draft repair API failed: ' + await correction.text());
  const fixed = JSON.parse((await correction.json()).choices[0].message.content);
  fixed.slug = slugify(fixed.slug);
  Object.assign(a, fixed);
  initialIssues = structuralIssues(a);
}
if (initialIssues.length) throw Error('Draft validation failed after repair: ' + JSON.stringify(initialIssues));
// Independent editorial review: a news headline is not evidence for unmentioned details.
const source = a.sources[0];
const sourceHeadline = evidence.find(h => h.title === source.title && h.url === source.url);
const reviewPrompt = [
  'Act as a strict fact-checking editor. Available evidence is the source headline and an extracted excerpt from the original publisher; verify every factual claim against that evidence.',
  'Check EVERY factual claim in the Russian draft (including headline, description, sections) against the source headline and excerpt. Do not infer other devices, dates, prices, quotes, sources, or certainty from background knowledge.',
  'A factual claim may be accepted only if supported by the supplied excerpt; clearly labelled general commentary is allowed. Reject invented quotes, unsupported claims of official confirmation and invented attributions.',
  'Respond as JSON with approved (boolean), issues (array of strings). Be strict.',
  'SOURCE: ' + JSON.stringify(sourceHeadline),
  'DRAFT: ' + JSON.stringify(a)
].join('\\n');
async function chatJson(messages) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
    body: JSON.stringify({model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', response_format: {type: 'json_object'}, temperature: 0, messages})
  });
  if (!response.ok) throw Error('Editorial API failed: ' + await response.text());
  return JSON.parse((await response.json()).choices[0].message.content);
}
const review = draft => chatJson([
  {role: 'system', content: 'You are a skeptical fact-checker. Output JSON only.'},
  {role: 'user', content: reviewPrompt.replace('DRAFT: ' + JSON.stringify(a), 'DRAFT: ' + JSON.stringify(draft))}
]);
const valid = draft => /^[a-z0-9-]{8,110}$/.test(draft.slug || '') && !!draft.title && !!draft.description &&
  Array.isArray(draft.sections) && draft.sections.length >= 3 && draft.sections.length <= 5 &&
  draft.sections.every(x => x.heading && Array.isArray(x.paragraphs) && x.paragraphs.length >= 2 && x.paragraphs.every(p => typeof p === 'string' && p.length >= 70)) &&
  Array.isArray(draft.sources) && draft.sources.length === 1 && draft.sources[0].title === source.title &&
  draft.sources[0].url === source.url && draft.sources[0].published === source.published;
let draft = a;
let verdict = await review(draft);
for (let attempt = 0; attempt < 2 && (verdict.approved !== true || !Array.isArray(verdict.issues) || verdict.issues.length); attempt++) {
  console.log('Editorial rewrite attempt', attempt + 1, JSON.stringify(verdict.issues || []));
  const revised = await chatJson([
    {role: 'system', content: 'You are a careful Russian technology news editor. Output JSON only.'},
    {role: 'user', content: 'Rewrite this article to address ALL fact-check issues. A source excerpt is available; remove unsupported specifics rather than inventing them. Keep 3-5 sections with at least two meaningful paragraphs each. Do not introduce new factual claims. Preserve slug, sources and date exactly. Return the full article JSON.\\nSOURCE: ' + JSON.stringify(sourceHeadline) + '\\nISSUES: ' + JSON.stringify(verdict.issues) + '\\nARTICLE: ' + JSON.stringify(draft)}
  ]);
  if (!valid(revised) || revised.slug !== a.slug || revised.date !== a.date) throw Error('Editorial rewrite returned invalid article');
  draft = revised;
  verdict = await review(draft);
}
if (verdict.approved !== true || !Array.isArray(verdict.issues) || verdict.issues.length) {
  throw Error('Editorial review rejected after rewrites: ' + JSON.stringify(verdict.issues || ['not approved']));
}
Object.assign(a, draft);
a.date = today;
fs.writeFileSync('articles/' + a.slug + '.json', JSON.stringify(a, null, 2) + '\n');
console.log('Created sourced news article:', a.title);
