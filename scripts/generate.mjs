import fs from 'node:fs';

const key = process.env.OPENAI_API_KEY;
if (!key) throw Error('Set OPENAI_API_KEY secret');
const files = fs.readdirSync('articles').filter(x => x.endsWith('.json'));
const existing = files.map(x => JSON.parse(fs.readFileSync('articles/' + x, 'utf8')));
const today = new Date().toISOString().slice(0, 10);
const decode = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const extract = (s, tag) => decode((s.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>')) || [,''])[1]).trim();
const topics = [
  'Apple iPhone iPad Mac technology launch',
  'Samsung Xiaomi Sony LG new gadgets TV',
  'Elon Musk Tesla SpaceX technology',
  'OpenAI Google Microsoft NVIDIA AI announcements',
  'technology gadgets smartphones innovations'
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
if (headlines.length < 5) throw Error('Not enough verified recent news headlines; refusing to fabricate news');
const previous = existing.slice(-45).map(a => a.title);
const prompt = [
  'Ты редактор русскоязычного технологического медиа TechPulse для Казахстана.',
  'Создай ОДНУ интересную, динамичную новостную статью на основе ТОЛЬКО приведённых ниже реальных заголовков новостной ленты за последние 3 дня.',
  'Выбери один конкретный инфоповод о популярных брендах, гаджетах, известных предпринимателях, ИИ или технологиях. Заголовок цепляющий, но правдивый, без кликбейта, преувеличений и неподтверждённых фактов.',
  'ВАЖНО: доступны лишь заголовки, даты и ссылки, не полные тексты. Не утверждай детали, которых нет в заголовке; прямо атрибутируй информацию источнику, отличай факты от контекста и мнений. Не выдумывай цитаты, цифры, спецификации, цены, даты релизов или действия знаменитостей. Не пиши будто тестировал устройство.',
  'Вместо вымышленных подробностей объясни, почему событие важно, что пока неизвестно, и что стоит проверить дальше. Никаких слухов как установленных фактов.',
  'Выбери одну новость из списка, верни в sources ТОЧНО её title, url, published. Ссылку не изменяй. Если новость не даёт достаточно оснований для содержательной статьи, выбери другую.',
  'Текст естественный, читаемый, 3-5 разделов, по 2-3 содержательных абзаца, без искусственного SEO-спама. Реклама HARMEX добавляется на сайте отдельно.',
  'Не повторяй опубликованные темы: ' + previous.join('; '),
  'Верни JSON: slug (латиница, цифры и дефисы), title, description, date (строго ' + today + '), category, sections (массив {heading, paragraphs: массив строк}), sources (массив из одного объекта {title,url,published}).',
  'Доступные новости:\n' + JSON.stringify(headlines.slice(0, 45))
].join('\n\n');
const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
  body: JSON.stringify({model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', response_format: {type: 'json_object'}, messages: [{role: 'system', content: 'Return valid JSON only. Stay faithful to supplied evidence.'}, {role: 'user', content: prompt}]})
});
if (!res.ok) throw Error(await res.text());
const a = JSON.parse((await res.json()).choices[0].message.content);
if (!/^[a-z0-9-]{8,110}$/.test(a.slug || '') || !a.title || !a.description || !Array.isArray(a.sections) || a.sections.length < 3 || a.sections.length > 5 || a.sections.some(s => !s.heading || !Array.isArray(s.paragraphs) || s.paragraphs.length < 2 || s.paragraphs.some(p => typeof p !== 'string' || p.length < 70)) || !Array.isArray(a.sources) || a.sources.length !== 1 || !headlines.some(h => h.title === a.sources[0].title && h.url === a.sources[0].url && h.published === a.sources[0].published) || existing.some(e => e.title.toLowerCase() === a.title.toLowerCase()) || fs.existsSync('articles/' + a.slug + '.json')) throw Error('Invalid, unsourced or duplicate article');
// Independent editorial review: a news headline is not evidence for unmentioned details.
const source = a.sources[0];
const sourceHeadline = headlines.find(h => h.title === source.title && h.url === source.url);
const reviewPrompt = [
  'Act as a strict fact-checking editor. The ONLY available evidence is one news headline and its publication date. No full article, press release or official confirmation has been read.',
  'Check EVERY factual claim in the Russian draft (including headline, description, sections) against the source headline. Do not infer additional announcements, other devices, dates, prices, quotes, sources, or certainty from background knowledge.',
  'A claim may be accepted only if directly supported by the headline or explicitly framed as general opinion/uncertainty. If the draft says officially confirmed without the source headline proving it, reject. If it cites outlets not in the source, reject.',
  'Respond as JSON with approved (boolean), issues (array of strings). Be strict.',
  'SOURCE: ' + JSON.stringify(sourceHeadline),
  'DRAFT: ' + JSON.stringify(a)
].join('\\n');
const check = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
  body: JSON.stringify({model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', response_format: {type: 'json_object'}, temperature: 0, messages: [{role: 'system', content: 'You are a skeptical fact-checker. Output JSON only.'}, {role: 'user', content: reviewPrompt}]})
});
if (!check.ok) throw Error('Editorial verification API failed: ' + await check.text());
const verdict = JSON.parse((await check.json()).choices[0].message.content);
if (verdict.approved !== true || !Array.isArray(verdict.issues) || verdict.issues.length) {
  throw Error('Editorial review rejected draft: ' + JSON.stringify(verdict.issues || ['not approved']));
}
a.date = today;
fs.writeFileSync('articles/' + a.slug + '.json', JSON.stringify(a, null, 2) + '\n');
console.log('Created sourced news article:', a.title);
