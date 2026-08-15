import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSuppressReturnHandling } from '../capture-guard.js';

test('suppresses focus/visibility handling while image picker is returning', () => {
  assert.equal(shouldSuppressReturnHandling({ pickerOpen: true, activeStatus: 'shared', actionAwaiting: true }), true);
});

test('suppresses polling for a newly captured scan before it is shared', () => {
  assert.equal(shouldSuppressReturnHandling({ pickerOpen: false, activeStatus: 'captured', actionAwaiting: false }), true);
});

test('allows return handling after a scan has actually been shared', () => {
  assert.equal(shouldSuppressReturnHandling({ pickerOpen: false, activeStatus: 'shared', actionAwaiting: true }), false);
});
