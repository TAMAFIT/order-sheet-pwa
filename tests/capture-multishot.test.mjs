import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_MODE_SINGLE,
  CAPTURE_MODE_SPLIT,
  acceptedIncomingCount,
  nextSplitSlot,
  normalizeCaptureMode,
  splitStatus
} from '../capture-multishot-core.js';

test('normalizes capture modes safely', () => {
  assert.equal(normalizeCaptureMode(CAPTURE_MODE_SPLIT), CAPTURE_MODE_SPLIT);
  assert.equal(normalizeCaptureMode('unknown'), CAPTURE_MODE_SINGLE);
});

test('split mode advances top then bottom then complete', () => {
  assert.equal(nextSplitSlot(0), 'top');
  assert.equal(nextSplitSlot(1), 'bottom');
  assert.equal(nextSplitSlot(2), 'complete');
  assert.equal(splitStatus(1).complete, false);
  assert.equal(splitStatus(2).complete, true);
});

test('single mode accepts only one image', () => {
  assert.equal(acceptedIncomingCount(CAPTURE_MODE_SINGLE, 0, 3), 1);
});

test('split mode never accepts more than two total images', () => {
  assert.equal(acceptedIncomingCount(CAPTURE_MODE_SPLIT, 0, 5), 2);
  assert.equal(acceptedIncomingCount(CAPTURE_MODE_SPLIT, 1, 5), 1);
  assert.equal(acceptedIncomingCount(CAPTURE_MODE_SPLIT, 2, 1), 0);
});
