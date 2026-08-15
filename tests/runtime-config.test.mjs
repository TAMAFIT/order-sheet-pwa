import test from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOM_GPT_URL, DEFAULT_ACTION_BASE_URL, isDedicatedCustomGptUrl } from '../runtime-config.js';

test('dedicated Custom GPT route is the configured handwritten-order GPT, not ChatGPT home', () => {
  assert.equal(CUSTOM_GPT_URL, 'https://chatgpt.com/g/g-6a7fed0cd0f0819191984e3694ba1c4b-shou-shu-kizhu-wen-jie-xi-gpt');
  assert.equal(isDedicatedCustomGptUrl(CUSTOM_GPT_URL), true);
  assert.equal(isDedicatedCustomGptUrl('https://chatgpt.com/'), false);
});

test('fresh installs use the production Action Worker URL', () => {
  assert.equal(DEFAULT_ACTION_BASE_URL, 'https://order-sheet-action-api.tamafit-takamatsu.workers.dev');
  assert.ok(DEFAULT_ACTION_BASE_URL.startsWith('https://'));
});
