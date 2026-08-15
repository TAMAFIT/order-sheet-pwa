import { normalizeText, similarity } from './lib.js';

const PREFERRED_CATEGORY_WORDS = [
  '野菜', 'くだもの', 'お魚', 'お肉', '卵', '牛乳', '乳製品', 'ヨーグルト', '豆腐', '納豆',
  'パン', '米', 'ごはん', '麺', '調味料', 'レトルト', 'インスタント', '冷凍食品', 'アイス',
  'お菓子', '飲料', 'コーヒー', '紅茶', 'お茶', '惣菜', '漬物', 'ハム', 'ソーセージ',
  '紙', '介護', '日用品', '生活雑貨', 'キッチン'
];

export function catalogNormalize(value = '') {
  return normalizeText(value);
}

export function catalogGrams(value = '') {
  const normalized = catalogNormalize(value);
  if (!normalized) return [];
  if (normalized.length === 1) return [normalized];
  const grams = [];
  const seen = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const gram = normalized.slice(index, index + 2);
    if (!seen.has(gram)) {
      seen.add(gram);
      grams.push(gram);
    }
  }
  return grams.slice(0, 32);
}

export function chooseLookupGrams(value = '', limit = 5) {
  const grams = catalogGrams(value);
  if (grams.length <= limit) return grams;
  const indexes = new Set([0, 1, Math.floor((grams.length - 1) / 2), grams.length - 2, grams.length - 1]);
  return [...indexes]
    .filter(index => index >= 0 && index < grams.length)
    .slice(0, limit)
    .map(index => grams[index]);
}

export function isPreferredCatalogCategory(category = '') {
  const value = String(category || '');
  return PREFERRED_CATEGORY_WORDS.some(word => value.includes(word));
}

export function scoreCatalogCandidate(query, record, matchedGramCount = 0, lookupGramCount = 0) {
  const raw = catalogNormalize(query);
  const candidate = catalogNormalize(record?.name || '');
  if (!raw || !candidate) return 0;
  if (raw === candidate) return 1;

  const contains = candidate.includes(raw) || raw.includes(candidate);
  const lengthRatio = Math.min(raw.length, candidate.length) / Math.max(raw.length, candidate.length);
  const containsScore = contains ? 0.82 + (0.13 * lengthRatio) : 0;
  const editScore = similarity(raw, candidate);
  const gramCoverage = lookupGramCount > 0 ? Math.min(1, matchedGramCount / lookupGramCount) : 0;
  const fuzzyScore = (editScore * 0.78) + (gramCoverage * 0.2);
  const categoryBoost = isPreferredCatalogCategory(record?.category) ? 0.02 : 0;
  return Math.max(0, Math.min(0.995, Math.max(containsScore, fuzzyScore) + categoryBoost));
}

export function rankCatalogCandidates(query, entries = [], limit = 8) {
  const lookupGramCount = chooseLookupGrams(query).length;
  return entries
    .map(entry => {
      const record = entry?.record || entry;
      const matchedGramCount = Number(entry?.matchedGramCount || 0);
      const score = scoreCatalogCandidate(query, record, matchedGramCount, lookupGramCount);
      return {
        jan: String(record?.jan || ''),
        name: String(record?.name || ''),
        category: String(record?.category || ''),
        score,
        exact: catalogNormalize(query) === catalogNormalize(record?.name || '')
      };
    })
    .filter(candidate => candidate.jan && candidate.name && candidate.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact) || a.name.localeCompare(b.name, 'ja'))
    .slice(0, Math.max(1, Number(limit) || 8));
}
