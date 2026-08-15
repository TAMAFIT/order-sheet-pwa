import test from 'node:test';
import assert from 'node:assert/strict';
import { insertRecognitionAfter, moveRecognition, removeRecognition, restoreRecognition } from '../review-edit-core.js';

test('insertRecognitionAfter keeps paper order contiguous', () => {
  const items = [
    { id: 'a', order: 1 },
    { id: 'b', order: 2 }
  ];
  const inserted = { id: 'x', order: 99 };
  const index = insertRecognitionAfter(items, 'a', inserted);
  assert.equal(index, 1);
  assert.deepEqual(items.map(item => item.id), ['a', 'x', 'b']);
  assert.deepEqual(items.map(item => item.order), [1, 2, 3]);
});

test('removeRecognition and restoreRecognition preserve original position', () => {
  const items = [
    { id: 'a', order: 1 },
    { id: 'b', order: 2 },
    { id: 'c', order: 3 }
  ];
  const snapshot = removeRecognition(items, 'b');
  assert.deepEqual(items.map(item => item.id), ['a', 'c']);
  assert.deepEqual(items.map(item => item.order), [1, 2]);
  restoreRecognition(items, snapshot);
  assert.deepEqual(items.map(item => item.id), ['a', 'b', 'c']);
  assert.deepEqual(items.map(item => item.order), [1, 2, 3]);
});

test('moveRecognition reorders cards and renumbers paper order', () => {
  const items = [
    { id: 'a', order: 1, person: 'A' },
    { id: 'b', order: 2, person: 'A' },
    { id: 'c', order: 3, person: 'A' }
  ];
  moveRecognition(items, 'c', 'a', 'before');
  assert.deepEqual(items.map(item => item.id), ['c', 'a', 'b']);
  assert.deepEqual(items.map(item => item.order), [1, 2, 3]);
});

test('moveRecognition adopts destination customer group when moved across groups', () => {
  const items = [
    { id: 'a', order: 1, place: '上', time: '10:00', person: 'A' },
    { id: 'b', order: 2, place: '上', time: '10:00', person: 'A' },
    { id: 'c', order: 3, place: '下', time: '11:00', person: 'B' }
  ];
  const result = moveRecognition(items, 'b', 'c', 'after');
  assert.deepEqual(items.map(item => item.id), ['a', 'c', 'b']);
  assert.deepEqual(items.map(item => item.order), [1, 2, 3]);
  assert.deepEqual(
    { place: items[2].place, time: items[2].time, person: items[2].person },
    { place: '下', time: '11:00', person: 'B' }
  );
  assert.deepEqual(result.previousGroup, { place: '上', time: '10:00', person: 'A' });
});
