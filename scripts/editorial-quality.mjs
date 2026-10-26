// Conservative language-quality checks: does not claim to fact-check external claims.
// These checks supplement the LLM source-based review, not replace it.
const fillerPatterns = [
  /может\s+заинтересовать/i,
  /(?:позволяет|позволяют)\s+(?:читателям|пользователям|покупателям)\s+(?:ознакомиться|познакомиться|выбрать)/i,
  /(?:отражает|отражают)\s+стремлени/i,
  /(?:расширяет|расширяют)\s+возможност/i,
  /(?:демонстрирует|демонстрируют)\s+разнообразие/i,
  /(?:важно|стоит|рекомендуется)\s+следить\s+за\s+обновлени/i,
  /(?:важное|значимое)\s+(?:событие|шаг|изменение)\s+для\s+(?:всех|любител|поклонник)/i,
  /(?:может|могут)\s+(?:оказать|повлиять|привести|стать)\s+(?:существенн|значительн|важн)/i,
  /(?:предоставляет|предоставляют)\s+(?:больше|новые)\s+возможност/i,
  /(?:представляет|представляют)\s+интерес\s+для/i,
  /(?:продолжат|продолжает)\s+развитие\s+(?:технологий|рынка)/i,
  /(?:помогает|помогут|позволяет)\s+лучше\s+(?:понять|ориентироваться)/i
];
const allParagraphs = article => (Array.isArray(article?.sections) ? article.sections : []).flatMap(s => Array.isArray(s?.paragraphs) ? s.paragraphs.filter(p => typeof p === 'string') : []);
export function editorialQualityIssues(article) {
  const paragraphs = allParagraphs(article);
  const issues = [];
  if (paragraphs.length === 0) return ['No article paragraphs'];
  const fullText = paragraphs.join(' ');
  if (fullText.length < 450) issues.push('Article lacks sufficient sourced detail (less than 450 characters of body text)');
  // Focus on repeated padding, not isolated useful background commentary.
  const filler = paragraphs.filter(p => fillerPatterns.some(re => re.test(p)));
  if (filler.length >= 2 && filler.length / paragraphs.length >= 0.30)
    issues.push(`${filler.length}/${paragraphs.length} paragraphs use generic filler instead of source-specific facts`);
  const headings = (article.sections || []).map(s => String(s.heading || '')).join(' ').toLowerCase();
  if ((headings.match(/(?:значение|важность|перспективы|актуальность|влияние)/g) || []).length >= 2 && paragraphs.length <= 4)
    issues.push('Multiple sections are generic commentary rather than reporting');
  return issues;
}
