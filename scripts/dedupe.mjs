// Event-level deduplication: headlines may describe the same news in different words.
const normalize=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const words=s=>new Set(normalize(s).split(' ').filter(x=>x.length>=4&&!/^(новые|новый|новая|новостей|новости|подробности|обзор|проблемы|планы|возможности|запуск|2026|2027|the|with|from|this|that|more|into|their|about|after|will|could|first|what|your|tech|apple|meta|microsoft|tesla|spacex|bose|xbox|iphone)$/.test(x)));
const sameSource=(a,b)=>{const x=a.sources?.[0]?.url,y=b.sources?.[0]?.url;return !!x&&!!y&&x.replace(/[?#].*$/,'').replace(/\/$/,'')===y.replace(/[?#].*$/,'').replace(/\/$/,'')};
const events=[
 ['iphone-duo',/iphone duo|айфон дуо/i],
 ['bose-skullcandy',/bose.*skullcandy|skullcandy.*bose/i],
 ['macbook-touch',/macbook.*(touchscreen|сенсорн)|(?:touchscreen|сенсорн).*macbook/i],
 ['ea-bioware',/ea.*bioware|bioware.*ea/i],
 ['justwatch-streaming',/justwatch/i],
 ['meta-muse',/meta.*muse|muse.*meta/i],
 ['meta-stock',/meta.*(?:stock|акци)|(?:stock|акци).*meta/i],
 ['microsoft-windows-ai',/microsoft.*(?:windows.?11|windows 11).*ai|microsoft.*ии.*windows|microsoft.*ai.*windows|windows.*(?:ai|ии).*microsoft/i],
 ['xbox-helix',/project helix/i],
 ['multimorphic-p3',/multimorphic.*p3|p3.*multimorphic/i],
 ['recursive-flint',/flint.*(?:ai|model|модел)|recursive.*flint/i],
 ['spacex-catch',/starship.*(?:catch|поймать|поймат)|(?:catch|поймать|поймат).*starship/i],
 ['tesla-cybercab-sale',/cybercab.*(?:sell|sale|selling|продаж)|(?:sell|sale|selling|продаж).*cybercab/i],
 ['tubi-october',/tubi.*186|186.*tubi/i],
 ['xbox-cloud',/xbox.*(?:cloud|облак).*?(?:pass|game)|xbox.*(?:pass|game).*?(?:cloud|облак)/i],
 ['optimus-production',/tesla.*optimus.*(?:production|производств)/i]
];
export function eventKey(a){const t=[a.title,a.slug,a.sources?.[0]?.title].filter(Boolean).join(' ');for(const [key,re] of events)if(re.test(t))return key;return null}
export function sameEvent(a,b){
 if(sameSource(a,b))return true;
 const x=eventKey(a),y=eventKey(b);
 if(x&&y&&x===y)return true;
 const aw=words([a.title,a.sources?.[0]?.title].join(' ')),bw=words([b.title,b.sources?.[0]?.title].join(' '));
 const intersection=[...aw].filter(w=>bw.has(w)).length;
 return intersection>=4&&intersection/Math.max(1,Math.min(aw.size,bw.size))>=.72;
}
export function uniqueArticles(items){
 const sorted=[...items].sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.slug||'').localeCompare(b.slug||''));
 const kept=[],removed=[];
 for(const a of sorted){const prior=kept.find(b=>sameEvent(a,b));if(prior)removed.push({article:a,kept:prior});else kept.push(a)}
 return {kept,removed};
}
