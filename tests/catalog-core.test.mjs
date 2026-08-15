import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogGrams, catalogNormalize, chooseLookupGrams, rankCatalogCandidates, scoreCatalogCandidate } from '../catalog-core.js';

test('catalogNormalize aligns kana, spaces and punctuation', () => {
  assert.equal(catalogNormalize('ブルガリア・ヨーグルト 400g'), catalogNormalize('ブルガリア ヨーグルト400ｇ'));
});

test('catalogGrams creates unique Japanese bigrams', () => {
  assert.deepEqual(catalogGrams('牛乳'), ['牛乳']);
  assert.deepEqual(catalogGrams('牛乳牛'), ['牛乳', '乳牛']);
});

test('chooseLookupGrams keeps lookup bounded for long names', () => {
  assert.ok(chooseLookupGrams('明治ブルガリアヨーグルト脂肪ゼロ400g', 5).length <= 5);
});

test('exact catalog name ranks above a fuzzy alternative', () => {
  const query = 'らくれん牛乳1000ml';
  const ranked = rankCatalogCandidates(query, [
    { record: { jan: '4900000000001', name: 'らくれん牛乳 1000ml', category: '卵・牛乳・乳製品' }, matchedGramCount: 5 },
    { record: { jan: '4900000000002', name: 'らくれん低脂肪乳 1000ml', category: '卵・牛乳・乳製品' }, matchedGramCount: 3 }
  ], 5);
  assert.equal(ranked[0].jan, '4900000000001');
  assert.equal(ranked[0].exact, true);
});

test('preferred grocery category gets a small secondary boost only', () => {
  const base = scoreCatalogCandidate('ごまドレッシング', { name: 'ごまドレッシング', category: '文房具・手芸' }, 2, 2);
  const grocery = scoreCatalogCandidate('ごまドレッシング', { name: 'ごまドレッシング', category: '調味料' }, 2, 2);
  assert.equal(base, 1);
  assert.equal(grocery, 1);
});
