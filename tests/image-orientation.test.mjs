import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuarterTurns, portraitRotationFor, rotatedSize } from '../image-orientation-core.js';

test('landscape images are rotated to portrait automatically', () => {
  assert.equal(portraitRotationFor(1600, 900, 0), 1);
  assert.deepEqual(rotatedSize(1600, 900, 1), { width: 900, height: 1600 });
});

test('portrait images keep their orientation by default', () => {
  assert.equal(portraitRotationFor(900, 1600, 0), 0);
});

test('manual 180 degree correction is preserved after portrait normalization', () => {
  assert.equal(portraitRotationFor(900, 1600, 2), 2);
  assert.equal(portraitRotationFor(1600, 900, 2), 3);
  assert.equal(normalizeQuarterTurns(-1), 3);
});
