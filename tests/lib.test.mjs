import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText,
  similarity,
  rankCandidates,
  resolveRecognitionItem,
  aggregateRecognitions,
  parseAnalysisPayload
} from '../lib.js';

test('normalizes Japanese width and kana variants', () => {
  assert.equal(normalizeText(' ラクレン 牛乳 '), normalizeText('らくれん牛乳'));
  assert.equal(normalizeText('おーいお茶 ２Ｌ'), normalizeText('おーいお茶2L'));
});

test('similarity ranks learned alias first', () => {
  const products = [
    { id: 'p1', canonicalName: 'らくれん牛乳', active: true },
    { id: 'p2', canonicalName: '低脂肪牛乳', active: true }
  ];
  const aliases = [
    { productId: 'p1', alias: 'らくれん' },
    { productId: 'p2', alias: '低脂肪' }
  ];
  const ranked = rankCandidates('ラクレン', products, aliases);
  assert.equal(ranked[0].product.id, 'p1');
  assert.ok(ranked[0].score >= 0.99);
});

test('writer-specific alias gets a deterministic boost', () => {
  const products = [
    { id: 'p1', canonicalName: '商品A', active: true },
    { id: 'p2', canonicalName: '商品B', active: true }
  ];
  const aliases = [
    { productId: 'p1', alias: 'ABC', writerTag: '担当A' },
    { productId: 'p2', alias: 'ABD', writerTag: '' }
  ];
  const ranked = rankCandidates('ABC', products, aliases, '担当A');
  assert.equal(ranked[0].product.id, 'p1');
});

test('recognition keeps exact alias as a suggestion but waits for human confirmation', () => {
  const db = {
    products: [{ id: 'p1', canonicalName: 'ごまドレッシング', location: 'A', active: true }],
    aliases: [{ productId: 'p1', alias: 'ゴマドレ', writerTag: '' }]
  };
  const result = resolveRecognitionItem({ order: 3, person: '山田さん', name: 'ごまどれ', quantity: 2 }, db);
  assert.equal(result.matchedProductId, 'p1');
  assert.equal(result.status, 'pending');
  assert.equal(result.order, 3);
  assert.equal(result.person, '山田さん');
});

test('aggregates only confirmed rows of the same canonical product and skips cancelled items', () => {
  const products = [{ id: 'p1', canonicalName: 'らくれん牛乳', location: 'B' }];
  const totals = aggregateRecognitions([
    { status: 'confirmed', matchedProductId: 'p1', quantity: 2, cancelled: false },
    { status: 'confirmed', matchedProductId: 'p1', quantity: 3, cancelled: false },
    { status: 'pending', matchedProductId: 'p1', quantity: 8, cancelled: false },
    { status: 'confirmed', matchedProductId: 'p1', quantity: 9, cancelled: true }
  ], products);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].quantity, 5);
  assert.equal(totals[0].location, 'B');
});

test('parses AI JSON payload with paper-order metadata and preserves order', () => {
  const items = parseAnalysisPayload('{"items":[{"order":2,"place":"松ヶ崎","time":"10:40","person":"木田さん","name":"コロッケ2コ入","quantity":3,"confidence":0.9},{"order":1,"person":"泉近さん","name":"牛乳","quantity":1}]}');
  assert.equal(items[0].order, 1);
  assert.equal(items[0].person, '泉近さん');
  assert.equal(items[1].name, 'コロッケ2コ入');
  assert.equal(items[1].place, '松ヶ崎');
  assert.equal(items[1].quantity, 3);
});

test('similarity stays bounded', () => {
  assert.ok(similarity('ABC', 'ABD') >= 0 && similarity('ABC', 'ABD') <= 1);
});