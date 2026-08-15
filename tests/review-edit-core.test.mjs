import test from 'node:test';
import assert from 'node:assert/strict';
import { insertRecognitionAfter, removeRecognition, restoreRecognition } from '../review-edit-core.js';

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
