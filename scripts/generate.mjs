import {licensedSourceImage} from './source-image.mjs';
import {sameEvent} from './dedupe.mjs';
import {editorialQualityIssues} from './editorial-quality.mjs';
import fs from 'node:fs';


async function findLicensedImage(article, headline) {
  // Fail closed: Commons images only, with machine-readable license and a strict topical match.
  const title=String(headline||'').replace(/\s+-\s+[^-]+$/,'');
  const words=title.match(/[A-Za-z][A-Za-z0-9-]{3,}/g)||[];
  const stop=new Set(['with','from','that','this','will','after','about','could','would','their','first','latest','reveals','launches','announces','report','update','review','smart','technology']);
  const terms=[...new Set(words.map(x=>x.toLowerCase()).filter(x=>!stop.has(x)))].slice(0,6);
  if(terms.length<2)return null;
  try{
    const api=new URL('https://commons.wikimedia.org/w/api.php');
    api.searchParams.set('action','query');api.searchParams.set('generator','search');
    api.searchParams.set('gsrsearch',terms.slice(0,4).join(' ')+' filetype:bitmap');
    api.searchParams.set('gsrnamespace','6');api.searchParams.set('gsrlimit','8');
    api.searchParams.set('prop','imageinfo');api.searchParams.set('iiprop','url|extmetadata|size');
    api.searchParams.set('iiurlwidth','1200');api.searchParams.set('format','json');
    const res=await fetch(api,{signal:AbortSignal.timeout(10000)});
    if(!res.ok)return null;
    const pages=Object.values((await res.json()).query?.pages||{});
    for(const page of pages){
      const info=page.imageinfo?.[0],meta=info?.extmetadata||{};
      if(!info?.thumburl||info.width<700||info.height<350)continue;
      const license=String(meta.LicenseShortName?.value||'');
      if(!/^(CC BY|CC0|Public domain|PD-)/i.test(license))continue;
      const fileTitle=page.title.toLowerCase();
      const matched=terms.filter(t=>fileTitle.includes(t));
      if(matched.length<2)continue;
      const credit=String(meta.Artist?.value||'').replace(/<[^>]*>/g,'').slice(0,160);
      article.image={url:info.thumburl,alt:article.title,credit:credit||'Wikimedia Commons',license,source:info.descriptionurl,verified:true};
      return article.image;
    }
  }catch(error){console.warn('Licensed image lookup skipped:',error.message)}
  return null;
}

const key = process.env.OPENAI_API_KEY;
if (!key) throw Error('Set OPENAI_API_KEY secret');
const files = fs.readdirSync('articles').filter(x => x.endsWith('.json'));
const existing = files.map(x => JSON.parse(fs.readFileSync('articles/' + x, 'utf8')));
const today = new Date(Date.now()+5*60*60*1000).toISOString().slice(0, 10);
const decode = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const extract = (s, tag) => decode((s.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>')) || [,''])[1]).trim();
const attempt=Number(process.env.EDITORIAL_ATTEMPT||1);
const kazakhstanMode=process.env.EDITORIAL_REGION==='kz'||(process.env.EDITORIAL_REGION!=='global'&&attempt%4!==0);
const localMatch=/казахстан|алматы|астан|шымкент|караган|қараған|актау|ақтау|атырау|павлодар|костанай|қостанай|актобе|ақтөбе|туркестан|түркістан|семей|қызылорд|кызылорд|казахск|kazakhstan|almaty|astana|shymkent|kazakh/i;
const political=/президент|парламент|мажилис|сенат|депутат|министр|акимат|аким[а-яё]*|правительств|выбор(?:ы|ов|ам|ами|ах)|избирательн|оппозици|митинг|протест|политическ|политическ[а-яё]*\s+парти[а-яё]*|законопроект|конституци|санкци|геополит|president|parliament|election|opposition|protest|politic|government|minister|akimat/i;
// Explain topic failures rather than asking the model to repair an opaque category label.
function topicIssues(article) {
  const text=[article.title,article.description,article.sources?.[0]?.title].join(' ');
  const issues=[];
  if(!localMatch.test(text))issues.push('Kazakhstan topic: no supported local connection in headline, description or source');
  const match=text.match(political);
  if(match)issues.push('Kazakhstan topic: political term '+JSON.stringify(match[0]));
  return issues;
}
const globalTopics = [
  'Samsung LG TCL Xiaomi Hisense smart TV new models prices features',
  'Google TV Android TV streaming YouTube Netflix television',
  '4K television display LED OLED QLED screen technology',
  'PlayStation Xbox console TV HDMI gaming entertainment',
  'home cinema soundbar TV setup technology',
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
const localTopics=['Казахстан технологии инновации стартапы','Алматы Астана бизнес предприниматели открытия','Казахстан образование наука университеты','Казахстан спорт культура туризм события','Казахстан медицина здоровье технологии','Казахстан транспорт авиация инфраструктура','Казахстан экология городская жизнь','Казахстан новые продукты сервисы компании'];
const topics=kazakhstanMode?localTopics:globalTopics;
const headlines = [];
for (const topic of topics) {
  try {
    const feed = 'https://news.google.com/rss/search?q=' + encodeURIComponent(topic + ' when:3d') + (kazakhstanMode?'&hl=ru&gl=KZ&ceid=KZ:ru':'&hl=en-US&gl=US&ceid=US:en');
    const response = await fetch(feed, {headers: {'User-Agent': 'HarmexMediaEditorial/1.0'}, signal: AbortSignal.timeout(12000)});
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
const publisherFeeds=kazakhstanMode?[
 'https://www.inform.kz/rss',
 'https://tengrinews.kz/rss/',
 'https://www.nur.kz/rss/all.rss',
 'https://kapital.kz/rss',
 'https://kz.kursiv.media/feed/'
]:[
 'https://techcrunch.com/feed/',
 'https://www.theverge.com/rss/index.xml',
 'https://www.engadget.com/rss.xml',
 'https://www.wired.com/feed/rss',
 'https://arstechnica.com/feed/',
 'https://www.whathifi.com/feeds.xml',
 'https://www.tomsguide.com/feeds.xml',
 'https://www.techradar.com/feeds.xml'
];
for(const feed of publisherFeeds){
 try{
  const response=await fetch(feed,{headers:{'User-Agent':'Mozilla/5.0 HarmexMediaEditorial/1.0'},signal:AbortSignal.timeout(9000)});
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
  const response=await fetch(entry.url,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; HarmexMediaEditorial/1.0)'},signal:AbortSignal.timeout(9000)});
  if(!response.ok)return null;
  const finalUrl=response.url;
  if(!/^https:\/\//.test(finalUrl)||new URL(finalUrl).hostname.endsWith('news.google.com'))return null;
  const html=(await response.text()).slice(0,500000);
  const article=(html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i)||html.match(/<main\b[^>]*>[\s\S]*?<\/main>/i)||[])[0];
  if(!article)return null; // Navigation and related headlines are not article evidence.
  const body=stripHtml(article.replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,' '));
  if(body.length<400)return null;
  return {url:finalUrl,excerpt:body.slice(0,9500)};
 }catch{return null}
}
// Rank current topics by recency, multiple independent headline mentions, and broad consumer interest.
const normalize=s=>s.toLowerCase().replace(/\s+-\s+[^-]+$/,'').replace(/[^a-z0-9а-яё ]/gi,' ').replace(/\s+/g,' ').trim();
const tokens=s=>new Set(normalize(s).split(' ').filter(w=>w.length>3&&!['about','after','with','from','will','that','this','technology','latest','news'].includes(w)));
const similarity=(a,b)=>{const x=tokens(a),y=tokens(b);const shared=[...x].filter(w=>y.has(w)).length;return shared/Math.max(1,Math.min(x.size,y.size))};
const publishedTitles=existing.map(x=>x.title);
const ranked=headlines.filter(h=>(!kazakhstanMode||(localMatch.test(h.title)&&!political.test(h.title)))&&!publishedTitles.some(t=>similarity(h.title,t)>=0.65)&&!existing.some(e=>sameEvent(e,{title:h.title,sources:[{url:h.url,title:h.title}]}))).map(h=>{
 const age=(Date.now()-Date.parse(h.published+'T12:00:00Z'))/86400000;
 const mentions=headlines.filter(other=>other!==h&&similarity(h.title,other.title)>=0.65).length;
 const relevance=/apple|iphone|samsung|tesla|spacex|openai|chatgpt|google|nvidia|microsoft|xiaomi|ai |robot|launch|unveil|announce|release|breakthrough|billion|viral/i.test(h.title)?2:0;
 const buyerIntent=/television|smart tv|google tv|android tv|oled|qled|mini.led|hdmi|home cinema|streaming|netflix|youtube|soundbar|playstation|ps5|xbox|hisense|tcl|tv review|tv price|tv deal/i.test(h.title)?8:0;
 return {...h,score:Math.max(0,3-age)+Math.min(5,mentions*1.5)+relevance+buyerIntent};
}).sort((a,b)=>b.score-a.score);
if (ranked.length < (kazakhstanMode?1:5)) throw Error('Not enough distinct recent news headlines; refusing to fabricate or repeat news');
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
 ...(kazakhstanMode?['РЕЖИМ КАЗАХСТАН: выбирай только событие, непосредственно происходящее в Казахстане или затрагивающее жизнь страны. Темы: технологии, бизнес, образование, культура, спорт, туризм, наука, здоровье, городская жизнь. Не выбирай государственную политику, политических деятелей, выборы, оппозицию, протесты или политические конфликты. Укажи region: "kz".']:['РЕЖИМ МИР: выбирай международную новость; укажи region: "global".']),
  'Ты редактор русскоязычного новостного портала HARMEX MEDIA для аудитории Казахстана. Цель — достоверно и содержательно освещать события Казахстана и мира: общество, экономику, бизнес, технологии, науку, культуру и спорт. HARMEX Electronics — отдельное коммерческое направление бренда; новости не должны быть скрытой рекламой электроники.',
  'Создай ОДНУ интересную, динамичную новостную статью на основе ТОЛЬКО приведённых ниже реальных заголовков новостной ленты за последние 3 дня. Новости отсортированы по актуальности, упоминаниям и интересу широкой аудитории.',
  ...(kazakhstanMode?['Для казахстанской ленты выбирай наиболее значимое и свежее событие любой разрешённой тематики, не ограничивайся электроникой.']:['В международной ленте выбирай самые значимые свежие проверяемые новости науки, технологий, бизнеса, общества, культуры и спорта; не фокусируйся на телевизорах или продажах. Не вставляй рекламу HARMEX в редакционный текст.']),
  'Приоритет отдавай первому подходящему источнику в списке, чтобы повторные попытки выбирали разные новости. Выбери один конкретный инфоповод из разрешённых тем. Заголовок яркий, эмоциональный, интригующий, с сильным новостным глаголом и конкретикой; не выдумывай сенсации, не искажай факты и не обещай того, чего нет в тексте.',
  'Доступны выдержки из текстов первоисточников. Используй только явно подтверждённые ими факты; не придумывай цитаты, цифры, характеристики, даты и заявления. Различай официальное подтверждение и сообщения журналистов. Не пиши будто тестировал устройство.',
  'Объём зависит от подтверждённых фактов: если их мало, НЕ публикуй слабую новость: выбери более содержательный первоисточник. Не добавляй предположения о будущих моделях, обновлениях, рыночных последствиях или отсутствующих сведениях ради объёма. Совет читателю допустим только как явно обозначенный совет, без новых фактов о товаре.',
  'Редакционный стандарт: минимум два РАЗНЫХ проверяемых факта сверх пересказа заголовка (например, модель и подтверждённая особенность, точная дата и место, цена и условия, участники и результат). Каждый факт должен прямо следовать из исходного текста. Если их нет ни в одной новости, откажись от публикации, не выдумывай сведения.',
  'Не заполняй разделы общими фразами вроде «может заинтересовать пользователей», «расширяет возможности», «отражает стремление», «важно следить за обновлениями». Каждая часть должна добавлять конкретную новую информацию: кто, что, когда, где, сколько и почему это важно именно читателю.',
  'Выбери одну новость из списка с текстом первоисточника. Верни в sources ТОЧНО её title, url, published. Ссылку не изменяй. Если данных недостаточно, выбери другую.',
  'Авторский рерайт обязателен: осмысли первоисточник, выдели главное, измени композицию и формулировки, объясни значение новости читателю. Не копируй предложения, абзацы, структуру и заголовок из первоисточника, кроме точных названий, фактов и коротких атрибутированных цитат. Сохраняй ссылку на источник. Не делай поверхностную замену синонимов.',
  'СТРОГО: весь заголовок, description, заголовки разделов и все абзацы — только на русском языке. Не копируй английские заголовки или абзацы из источника. Допустимы только собственные имена, бренды, названия продуктов и общепринятые технические обозначения латиницей.',
  'Текст естественный, читаемый, 1-5 разделов, по 1-3 содержательных абзаца, без искусственного SEO-спама. Каждый абзац не короче 40 символов; заголовки разделов содержат не менее 12 русских букв. Не растягивай текст. Реклама HARMEX добавляется на сайте отдельно.',
  'Не повторяй опубликованные темы: ' + previous.join('; '),
  'Верни JSON: region (kz или global), slug (латиница, цифры и дефисы), title, description, date (строго ' + today + '), category, sections (массив {heading, paragraphs: массив строк}), sources (массив из одного объекта {title,url,published}).',
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
const hasRussianProse = value => typeof value === 'string' && (value.match(/[а-яё]/gi)||[]).length >= 12;
const structuralIssues = article => {
  const issues = [];
  if (!article || typeof article !== 'object') return ['response is not an object'];
  if(kazakhstanMode)issues.push(...topicIssues(article));
  if (!article.title || typeof article.title !== 'string') issues.push('missing title');
  if (!article.description || typeof article.description !== 'string') issues.push('missing description');
  if(!hasRussianProse(article.title)||!hasRussianProse(article.description))issues.push('title and description must be written in Russian');
  if(Array.isArray(article.sections)&&article.sections.some(s=>!hasRussianProse(s.heading)||!Array.isArray(s.paragraphs)||s.paragraphs.some(p=>!hasRussianProse(p))))issues.push('all section headings and paragraphs must be in Russian');
  if (!Array.isArray(article.sections) || article.sections.length < 1 || article.sections.length > 5) issues.push('sections count must be 1-5');
  else article.sections.forEach((section, index) => {
    if (!section.heading) issues.push('section ' + index + ' missing heading');
    if (!Array.isArray(section.paragraphs) || section.paragraphs.length < 1) issues.push('section ' + index + ' needs at least 1 paragraph');
    else if (section.paragraphs.some(p => typeof p !== 'string' || p.trim().length < 40)) issues.push('section ' + index + ' has short/invalid paragraphs');
  });
  if (!Array.isArray(article.sources) || article.sources.length !== 1 || !evidence.some(h => h.title === article.sources[0]?.title && h.url === article.sources[0]?.url && h.published === article.sources[0]?.published)) issues.push('source not found in fetched headlines');
  if(article.sources?.[0]?.published){const age=Date.now()-Date.parse(article.sources[0].published+'T00:00:00Z');if(!Number.isFinite(age)||age>4*86400000||age< -86400000)issues.push('source publication date is stale or invalid');}
  if(article.sources?.[0]?.url&&!/^https:\/\//i.test(article.sources[0].url))issues.push('source must use HTTPS');
  if (!/^[a-z0-9-]{8,110}$/.test(article.slug || '')) issues.push('invalid slug');
  if (existing.some(e => sameEvent(e,article)||similarity(e.title,String(article.title||''))>=0.65)) issues.push('duplicate or near-duplicate event, even with rewritten headline');
  if (fs.existsSync('articles/' + article.slug + '.json')) issues.push('duplicate slug');
  issues.push(...editorialQualityIssues(article));
  return issues;
};
a.slug = slugify(a.slug);
a.region=kazakhstanMode?'kz':'global';
// Resolve the cited source deterministically from the publisher evidence,
// rather than asking the model to reproduce URLs and timestamps perfectly.
function resolveSource(article) {
 const candidate=article.sources?.[0];
 if(!candidate)return false;
 const match=chosenEvidence.find(h=>h.url===candidate.url) ||
   chosenEvidence.find(h=>h.title===candidate.title) ||
   chosenEvidence.find(h=>similarity(h.title,String(candidate.title||''))>=0.85);
 if(!match)return false;
 article.sources=[{title:match.title,url:match.url,published:match.published}];
 return true;
}
resolveSource(a);
let initialIssues = structuralIssues(a);
for (let attempt = 0; attempt < 2 && initialIssues.length; attempt++) {
  console.warn('Draft structure correction', attempt + 1, JSON.stringify(initialIssues));
  const correction = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
    body: JSON.stringify({model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', response_format: {type: 'json_object'}, messages: [
      {role: 'system', content: 'Repair the listed validation problems using only the supplied evidence. Keep 1-5 sections with at least one paragraph per section. For topic failures choose a different eligible event and rewrite the whole draft faithfully; never hide political facts by deleting a keyword. Do not add factual claims. Output JSON.'},
      {role: 'user', content: 'Fix these validation problems: ' + JSON.stringify(initialIssues) + '. Choose exactly one source from this list, copying title/url/published byte for byte: ' + JSON.stringify(chosenEvidence.map(({score,...h})=>h)) + '. Avoid published titles: ' + JSON.stringify(previous) + '. Return the complete corrected article JSON. Draft: ' + JSON.stringify(a)}
    ]})});
  if (!correction.ok) throw Error('Draft repair API failed: ' + await correction.text());
  const fixed = JSON.parse((await correction.json()).choices[0].message.content);
  fixed.slug = slugify(fixed.slug);
  fixed.region=kazakhstanMode?'kz':'global';
  resolveSource(fixed);
  Object.assign(a, fixed);
  initialIssues = structuralIssues(a);
}
if (initialIssues.length) throw Error('Draft validation failed after repair: ' + JSON.stringify(initialIssues));
// Independent editorial review: a news headline is not evidence for unmentioned details.
const source = a.sources[0];
const sourceHeadline = evidence.find(h => h.title === source.title && h.url === source.url);
const reviewPrompt = [
  'Act as a strict fact-checking editor. Also check that the draft is an original synthesis, not copied wording or the same headline from the source. A strong attention-grabbing headline is welcome only if its claims are supported. Available evidence is the source headline and an extracted excerpt from the original publisher; verify every factual claim against that evidence.',
  'Check EVERY factual claim in the Russian draft (including headline, description, sections) against the source headline and excerpt. Do not infer other devices, dates, prices, quotes, sources, or certainty from background knowledge.',
  'Reject close translations, copied source sentences, near-identical headline phrasing and invented sensational claims. A factual claim may be accepted if supported by the supplied source headline or article excerpt, preserving attribution and uncertainty; clearly labelled general commentary is allowed. Reject invented quotes, unsupported claims of official confirmation and invented attributions.',
  'Accept faithful semantic paraphrases of supported facts: a reported price crash supports a reported price reduction, but not an invented amount, market, retailer or cause. Shared names, ratings and factual terminology alone are not copying. Reject copied expressive sentences and near-identical headlines, not the necessary restatement of a fact. Clearly labelled general buyer advice needs no source quote unless it asserts a product-specific fact. For every issue quote the problematic draft claim and explain the evidence gap; do not list supported claims as issues.',
  ...(kazakhstanMode?['Also verify that the event concerns Kazakhstan and is nonpolitical. Reject state politics, elections, political figures, opposition, protests and political conflicts. Ordinary consumer choice or a shipment of products is not politics. Check the full draft and source excerpt, not just keywords.']:[]),
  'Beyond accuracy, reject articles with fewer than two distinct source-supported details beyond the headline, shallow generic paragraphs, or repetitions of the same fact across sections. The goal is new information for readers, not keyword-filled text. If evidence is too thin for a useful article, approved=false and say why; NEVER invent details to pass.',
  'Respond as JSON with approved (boolean), issues (array of strings). Only put ACTUAL unsupported or incorrect claims and genuine utility deficiencies in issues. Do not list supported claims or explanations. If all claims are supported, approved=true and issues=[]. The article date is the HARMEX MEDIA publication date, not the original source date. Russian grammatical cases of proper names are valid.',
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
const valid = draft => /^[a-z0-9-]{8,110}$/.test(draft.slug || '') && hasRussianProse(draft.title) && hasRussianProse(draft.description) &&
  Array.isArray(draft.sections) && draft.sections.length >= 1 && draft.sections.length <= 5 &&
  draft.sections.every(x => hasRussianProse(x.heading) && Array.isArray(x.paragraphs) && x.paragraphs.length >= 1 && x.paragraphs.every(p => hasRussianProse(p) && p.trim().length >= 40)) &&
  Array.isArray(draft.sources) && draft.sources.length === 1 && draft.sources[0].title === source.title &&
  draft.sources[0].url === source.url && draft.sources[0].published === source.published && editorialQualityIssues(draft).length===0;
let draft = a;
let verdict = await review(draft);
for (let attempt = 0; attempt < 2 && verdict.approved !== true; attempt++) {
  console.log('Editorial rewrite attempt', attempt + 1, JSON.stringify(verdict.issues || []));
  const revised = await chatJson([
    {role: 'system', content: 'You are a careful Russian-language general news editor. Output JSON only.'},
    {role: 'user', content: 'Rewrite this article to address ALL fact-check issues. A source excerpt is available; remove unsupported specifics rather than inventing them. Keep 1-5 sections with at least one meaningful paragraph each (minimum 40 characters). Shorten the article when evidence is limited; do not pad it with speculation. Do not introduce new factual claims. Preserve slug, sources and date exactly. Return the full article JSON.\\nSOURCE: ' + JSON.stringify(sourceHeadline) + '\\nISSUES: ' + JSON.stringify(verdict.issues) + '\\nARTICLE: ' + JSON.stringify(draft)}
  ]);
  // The rewrite is allowed to improve prose, but immutable metadata belongs to the publisher pipeline.
  revised.slug=a.slug;
  revised.region=a.region;
  revised.date=a.date;
  revised.sources=a.sources;
  if (!valid(revised)) {console.warn('Rewrite broke article structure; retaining previous draft for next attempt');continue;}
  draft = revised;
  verdict = await review(draft);
}
if (verdict.approved !== true) {
  throw Error('Editorial review rejected after rewrites: ' + JSON.stringify(verdict.issues || ['not approved']));
}
Object.assign(a, draft);
a.region=kazakhstanMode?'kz':'global';
const finalIssues=structuralIssues(a);
if(finalIssues.length)throw Error('Final article validation failed: '+JSON.stringify(finalIssues));
if(existing.some(e=>sameEvent(e,a)))throw Error('Duplicate news event blocked before publication');
a.date = today;
a.publishedAt = new Date().toISOString();
// Fail closed: no independently verified event-specific rights, so publish without a photo.
// Do not use keyword-matched Commons pictures as substitutes for the original event.
a.image=await licensedSourceImage(a)||undefined;
fs.writeFileSync('articles/' + a.slug + '.json', JSON.stringify(a, null, 2) + '\n');
console.log('Created sourced news article:', a.title);
