import test from 'node:test';
import assert from 'node:assert/strict';
import { clampHorizontalDrag, nativeSelectionAllowed } from '../review-reorder-v18.js';

test('horizontal drag stays visually close to the card column', () => {
  assert.equal(clampHorizontalDrag(5), 5);
  assert.equal(clampHorizontalDrag(99), 18);
  assert.equal(clampHorizontalDrag(-99), -18);
});

test('native text selection is limited to editable text fields', () => {
  assert.equal(nativeSelectionAllowed({ tagName: 'INPUT' }), true);
  assert.equal(nativeSelectionAllowed({ tagName: 'textarea' }), true);
  assert.equal(nativeSelectionAllowed({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(nativeSelectionAllowed({ tagName: 'DIV', isContentEditable: false }), false);
});
