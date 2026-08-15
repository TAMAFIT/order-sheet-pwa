import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateInstantRecognitions,
  attentionItems,
  attentionReason,
  isUnreadableName
} from '../instant-results-core.js';

test('instant totals aggregate readable rows without confirmation', () => {
  const totals = aggregateInstantRecognitions([
    { id: 'a', order: 1, rawName: '牛乳', quantity: 1, confidence: .9, status: 'pending' },
    { id: 'b', order: 2, rawName: '牛 乳', quantity: 2, confidence: .8, status: 'pending' }
  ], []);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].canonicalName, '牛乳');
  assert.equal(totals[0].quantity, 3);
  assert.deepEqual(totals[0].sourceIds, ['a', 'b']);
});

test('unreadable product is listed for attention and excluded from totals', () => {
  const items = [
    { id: 'a', order: 1, rawName: '判読不明', quantity: 1, confidence: .2, note: '商品名判読困難' },
    { id: 'b', order: 2, rawName: '食パン', quantity: 2, confidence: .92 }
  ];
  assert.equal(isUnreadableName('判読不明'), true);
  assert.equal(aggregateInstantRecognitions(items, []).length, 1);
  assert.equal(attentionItems(items).length, 1);
  assert.match(attentionReason(items[0]), /商品名/);
});

test('low-confidence readable product stays in totals but is flagged', () => {
  const item = { id: 'a', order: 1, rawName: 'バナナ', quantity: 2, confidence: .45 };
  const totals = aggregateInstantRecognitions([item], []);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].quantity, 2);
  assert.equal(totals[0].attentionCount, 1);
  assert.equal(attentionItems([item]).length, 1);
});

test('matched learned product uses canonical name and location', () => {
  const products = [{ id: 'p1', canonicalName: '明治 おいしい牛乳', location: 'A' }];
  const totals = aggregateInstantRecognitions([
    { id: 'a', order: 1, rawName: 'おいしい牛乳', matchedProductId: 'p1', quantity: 2, confidence: .9 }
  ], products);
  assert.equal(totals[0].canonicalName, '明治 おいしい牛乳');
  assert.equal(totals[0].location, 'A');
  assert.equal(totals[0].quantity, 2);
});

test('cancelled rows do not enter totals or attention list', () => {
  const item = { id: 'a', order: 1, rawName: '牛乳', quantity: 1, confidence: .1, cancelled: true };
  assert.equal(aggregateInstantRecognitions([item], []).length, 0);
  assert.equal(attentionItems([item]).length, 0);
});
