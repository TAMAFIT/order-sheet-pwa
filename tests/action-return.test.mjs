import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScanResultUrl, extractCompletedScanPayload, normalizeApiBaseUrl } from '../action-return-core.js';

test('normalizes action API base URL', () => {
  assert.equal(normalizeApiBaseUrl('https://example.workers.dev///'), 'https://example.workers.dev');
});

test('builds scan result URL safely', () => {
  assert.equal(
    buildScanResultUrl('https://example.workers.dev/', '7f20e8a1-1234-4abc-8abc-123456789012'),
    'https://example.workers.dev/scan/7f20e8a1-1234-4abc-8abc-123456789012'
  );
});

test('rejects non-https action API URL', () => {
  assert.throws(() => buildScanResultUrl('http://example.com', 'abc'), /https/);
});

test('extracts completed action payload and validates scan id', () => {
  const payload = extractCompletedScanPayload({
    scan_id: '7f20e8a1-1234-4abc-8abc-123456789012',
    status: 'completed',
    items: [{ name: 'らくれん牛乳', quantity: 2 }]
  }, '7f20e8a1-1234-4abc-8abc-123456789012');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].quantity, 2);
  assert.throws(() => extractCompletedScanPayload({
    scan_id: 'different', status: 'completed', items: [{ name: 'x', quantity: 1 }]
  }, 'expected'), /一致/);
});

test('pending payload is not imported', () => {
  assert.equal(extractCompletedScanPayload({ scan_id: 'x', status: 'pending', items: [] }, 'x'), null);
});
