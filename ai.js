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

const EMBEDDED_SHARE_PROMPT = [
  'AIへの指示（この上部は注文内容ではありません）',
  '下の手書き注文票から「商品名」と「注文数量」だけを読み取ってください。',
  '・同じ商品でも統合せず、記載単位ごとに出力',
  '・個人名 / 施設名 / 時間 / 金額は不要',
  '・取消線で消された商品は cancelled=true',
  '・「2個入」「2L」など商品名中の数字と注文数量を混同しない',
  '・丸で囲まれた数字は注文数量として扱う',
  '・読めない場合は confidence を下げる',
  '・説明文なし、JSONだけ返す',
  '{"items":[{"name":"商品名","quantity":2,"confidence":0.92,"cancelled":false,"note":""}]}',
  '↓ ここから下が注文票です ↓'
].join('\n');

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('共有用画像を作成できませんでした'));
    };
    img.src = url;
  });
}

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const char of paragraph) {
      const next = current + char;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = char;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

async function makePromptEmbeddedImage(file, index) {
  const img = await loadImage(file);
  const maxImageWidth = 2400;
  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  const scale = Math.min(1, maxImageWidth / sourceWidth);
  const imageWidth = Math.max(900, Math.round(sourceWidth * scale));
  const imageHeight = Math.round(sourceHeight * (imageWidth / sourceWidth));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = Math.max(30, Math.min(54, Math.round(imageWidth * 0.022)));
  const lineHeight = Math.round(fontSize * 1.46);
  const sidePad = Math.round(imageWidth * 0.035);
  const topPad = Math.round(fontSize * 0.9);
  const textWidth = imageWidth - sidePad * 2;

  ctx.font = `700 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif`;
  const lines = wrapLines(ctx, EMBEDDED_SHARE_PROMPT, textWidth);
  const headerHeight = topPad * 2 + lines.length * lineHeight;

  canvas.width = imageWidth;
  canvas.height = headerHeight + imageHeight;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, headerHeight);
  ctx.fillStyle = '#111111';
  ctx.font = `700 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif`;
  ctx.textBaseline = 'top';

  let y = topPad;
  lines.forEach((line, lineIndex) => {
    if (lineIndex === 0) ctx.fillStyle = '#0b5d35';
    else if (line.startsWith('↓')) ctx.fillStyle = '#0b5d35';
    else ctx.fillStyle = '#111111';
    ctx.fillText(line, sidePad, y);
    y += lineHeight;
  });

  ctx.drawImage(img, 0, headerHeight, imageWidth, imageHeight);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('共有用画像の生成に失敗しました')), 'image/jpeg', 0.94);
  });

  return new File([blob], `order-sheet-with-instructions-${index + 1}.jpg`, { type: 'image/jpeg' });
}

async function buildBundledShareFiles(files) {
  const sourceFiles = Array.from(files || []);
  const bundled = [];
  for (let i = 0; i < sourceFiles.length; i += 1) {
    bundled.push(await makePromptEmbeddedImage(sourceFiles[i], i));
  }
  return bundled;
}

export async function shareToChatGPT(files, prompt) {
  const sourceFiles = Array.from(files || []);

  if (navigator.share && sourceFiles.length) {
    try {
      const bundledFiles = await buildBundledShareFiles(sourceFiles);
      const canShareBundled = !navigator.canShare || navigator.canShare({ files: bundledFiles });
      if (canShareBundled) {
        try { await navigator.clipboard?.writeText?.(prompt); } catch {}
        await navigator.share({
          title: '注文票を解析',
          files: bundledFiles
        });
        return { method: 'share-bundled-image', bundled: true };
      }
    } catch (error) {
      console.warn('Bundled share image failed; falling back to normal share.', error);
    }
  }

  if (navigator.share && (!sourceFiles.length || !navigator.canShare || navigator.canShare({ files: sourceFiles }))) {
    await navigator.share({
      title: '注文票を解析',
      text: prompt,
      ...(sourceFiles.length ? { files: sourceFiles } : {})
    });
    return { method: 'share', bundled: false };
  }

  await navigator.clipboard.writeText(prompt);
  window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
  return { method: 'clipboard', bundled: false };
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
