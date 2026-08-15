import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreshUrl, isAppCacheName, isAppServiceWorkerRegistration } from '../force-update-core.js';

test('isAppCacheName only matches this app cache namespace', () => {
  assert.equal(isAppCacheName('order-sheet-pwa-v12'), true);
  assert.equal(isAppCacheName('order-sheet-pwa-v11'), true);
  assert.equal(isAppCacheName('other-app-v1'), false);
});

test('buildFreshUrl adds a cache-busting query without dropping the path', () => {
  const result = new URL(buildFreshUrl('https://tamafit.github.io/order-sheet-pwa/', 12345));
  assert.equal(result.pathname, '/order-sheet-pwa/');
  assert.equal(result.searchParams.get('__app_refresh'), '12345');
});

test('service-worker filter stays inside the order-sheet app scope', () => {
  const base = 'https://tamafit.github.io/order-sheet-pwa/';
  assert.equal(isAppServiceWorkerRegistration({ scope: base }, base), true);
  assert.equal(isAppServiceWorkerRegistration({ scope: 'https://tamafit.github.io/other-app/' }, base), false);
  assert.equal(isAppServiceWorkerRegistration({ scope: 'https://example.com/order-sheet-pwa/' }, base), false);
});
