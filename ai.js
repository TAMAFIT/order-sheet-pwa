import { makeAnalysisPrompt, parseAnalysisPayload } from './lib.js';

export function productsForPrompt(db) {
  return db.products.map(product => ({
    id: product.id,
    canonicalName: product.canonicalName,
    aliases: db.aliases.filter(a => a.productId === product.id).map(a => a.alias)
  }));
}

export function buildPrompt(db) {
  return makeAnalysisPrompt(productsForPrompt(db));
}

export async function shareToChatGPT(files, prompt) {
  const shareFiles = Array.from(files || []);
  if (navigator.share && (!shareFiles.length || !navigator.canShare || navigator.canShare({ files: shareFiles }))) {
    await navigator.share({
      title: '注文票を解析',
      text: prompt,
      ...(shareFiles.length ? { files: shareFiles } : {})
    });
    return { method: 'share' };
  }
  await navigator.clipboard.writeText(prompt);
  window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
  return { method: 'clipboard' };
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('画像の読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

export async function analyzeWithBackend({ endpoint, files, prompt, writerTag = '' }) {
  const cleanEndpoint = String(endpoint || '').trim();
  if (!cleanEndpoint) throw new Error('バックエンドURLが設定されていません');
  const images = await Promise.all(Array.from(files || []).map(async file => ({
    name: file.name,
    type: file.type || 'image/jpeg',
    dataUrl: await fileToDataUrl(file)
  })));
  const response = await fetch(cleanEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, images, writerTag })
  });
  if (!response.ok) throw new Error(`AIバックエンドエラー: HTTP ${response.status}`);
  const payload = await response.json();
  return parseAnalysisPayload(payload);
}

export const SAMPLE_ANALYSIS = {
  items: [
    { name: 'らくれん', quantity: 2, confidence: 0.98, cancelled: false },
    { name: 'ラクレン牛乳', quantity: 1, confidence: 0.95, cancelled: false },
    { name: 'おーいお茶2L', quantity: 3, confidence: 0.99, cancelled: false },
    { name: 'コロッケ2コ入', quantity: 1, confidence: 0.93, cancelled: false },
    { name: 'ゴマドレ', quantity: 2, confidence: 0.88, cancelled: false },
    { name: '新発売パンDX', quantity: 4, confidence: 0.62, cancelled: false }
  ]
};
