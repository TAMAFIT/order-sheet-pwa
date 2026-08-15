import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare-action-api/src/index.js';

class FakeKv {
  constructor() { this.map = new Map(); }
  async put(key, value) { this.map.set(key, value); }
  async get(key) { return this.map.get(key) ?? null; }
}

function env() {
  return {
    ACTION_API_KEY: 'test-secret',
    ALLOWED_ORIGIN: 'https://tamafit.github.io',
    RESULTS: new FakeKv()
  };
}

const scanId = '7f20e8a1-1234-4abc-8abc-123456789012';

test('health endpoint responds without auth', async () => {
  const response = await worker.fetch(new Request('https://worker.example/health'), env());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
});

test('scan result write requires bearer secret', async () => {
  const e = env();
  const response = await worker.fetch(new Request('https://worker.example/scan-result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scan_id: scanId, status: 'completed', items: [{ order: 1, name: '牛乳', quantity: 1 }] })
  }), e);
  assert.equal(response.status, 401);
});

test('authorized write can be read back by scan_id', async () => {
  const e = env();
  const write = await worker.fetch(new Request('https://worker.example/scan-result', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-secret'
    },
    body: JSON.stringify({
      scan_id: scanId,
      status: 'completed',
      items: [{ order: 1, place: '松ヶ崎', person: '泉近さん', name: 'ブルガリアヨーグルト', quantity: 2, confidence: 0.9 }]
    })
  }), e);
  assert.equal(write.status, 200);

  const read = await worker.fetch(new Request(`https://worker.example/scan/${scanId}`), e);
  assert.equal(read.status, 200);
  const payload = await read.json();
  assert.equal(payload.scan_id, scanId);
  assert.equal(payload.status, 'completed');
  assert.equal(payload.items[0].name, 'ブルガリアヨーグルト');
  assert.equal(payload.items[0].quantity, 2);
});

test('dynamic OpenAPI points at deployed origin', async () => {
  const response = await worker.fetch(new Request('https://worker.example/openapi.json'), env());
  const payload = await response.json();
  assert.equal(payload.openapi, '3.1.0');
  assert.equal(payload.servers[0].url, 'https://worker.example');
  assert.equal(payload.paths['/scan-result'].post.operationId, 'submitScanResult');
});
