export const CUSTOM_GPT_URL = 'https://chatgpt.com/g/g-6a7fed0cd0f0819191984e3694ba1c4b-shou-shu-kizhu-wen-jie-xi-gpt';
export const DEFAULT_ACTION_BASE_URL = 'https://order-sheet-action-api.tamafit-takamatsu.workers.dev';

export function isDedicatedCustomGptUrl(value = CUSTOM_GPT_URL) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'chatgpt.com'
      && url.pathname.startsWith('/g/g-6a7fed0cd0f0819191984e3694ba1c4b-');
  } catch {
    return false;
  }
}
