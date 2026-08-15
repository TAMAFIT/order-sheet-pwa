import { makeAnalysisPrompt, parseAnalysisPayload } from './lib.js';
import { ensureActiveScan, getActiveScanId } from './scan-session.js';
import { CUSTOM_GPT_URL } from './runtime-config.js';
import './action-return.js';

export function productsForPrompt(db) {
  return db.products.map(product => ({
    id: product.id,
    canonicalName: product.canonicalName,
    aliases: db.aliases.filter(a => a.productId === product.id).map(a => a.alias)
  }));
}

export function buildPrompt(db) {
  const scanId = ensureActiveScan().scanId;
  const base = makeAnalysisPrompt(productsForPrompt(db), '');
  return `${base}\n\nSCAN_ID: ${scanId}\nこのGPTに submitScanResult Action がある場合は、解析完了後に必ず同じSCAN_IDでActionを実行して結果を保存してください。Actionが使えない・失敗・拒否された場合は、上記JSONだけを返してください。`;
}

function embeddedSharePrompt(scanId) {
  return [
    'AIへの指示（この上部は注文内容ではありません）',
    `SCAN_ID: ${scanId}`,
    '下の手書き注文票を、紙の上から順番に1明細ずつ読み取ってください。',
    '・同じ商品でも統合・合算しない',
    '・orderを1,2,3...で付ける',
    '・施設/見出し→place、時間→time、個人名→person',
    '・商品名→name、注文数量→quantity',
    '・取消線は cancelled=true',
    '・「2個入」「2L」など商品名中の数字と注文数量を混同しない',
    '・丸で囲まれた数字は注文数量',
    '・読めない場合は confidence を下げる',
    '・同じ商品に見えてもこの段階では統合しない',
    '・このGPTに submitScanResult Action がある場合、解析後に必ず実行する',
    '・Actionへ渡す scan_id は上記SCAN_IDと完全一致させる',
    '・Actionへ渡すitemsは下記JSON形式と同じ構造にする',
    '・Actionが無い/失敗/拒否された場合は、最初にJSONコードブロック1つだけ返す',
    '{"scan_id":"SCAN_ID","status":"completed","items":[{"order":1,"place":"","time":"","person":"","name":"商品名","quantity":2,"confidence":0.92,"cancelled":false,"note":""}]}',
    '↓ ここから下が注文票です ↓'
  ].join('\n');
}

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

async function makePromptEmbeddedImage(file, index, scanId) {
  const img = await loadImage(file);
  const maxImageWidth = 2400;
  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  const scale = Math.min(1, maxImageWidth / sourceWidth);
  const imageWidth = Math.max(900, Math.round(sourceWidth * scale));
  const imageHeight = Math.round(sourceHeight * (imageWidth / sourceWidth));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('この端末では共有用画像を作成できません');

  const fontSize = Math.max(26, Math.min(46, Math.round(imageWidth * 0.019)));
  const lineHeight = Math.round(fontSize * 1.4);
  const sidePad = Math.round(imageWidth * 0.035);
  const topPad = Math.round(fontSize * 0.8);
  const textWidth = imageWidth - sidePad * 2;

  ctx.font = `700 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif`;
  const lines = wrapLines(ctx, embeddedSharePrompt(scanId), textWidth);
  const headerHeight = topPad * 2 + lines.length * lineHeight;

  canvas.width = imageWidth;
  canvas.height = headerHeight + imageHeight;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, headerHeight);
  ctx.font = `700 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif`;
  ctx.textBaseline = 'top';

  let y = topPad;
  lines.forEach((line, lineIndex) => {
    if (lineIndex === 0 || line.startsWith('SCAN_ID:') || line.startsWith('↓')) ctx.fillStyle = '#0b5d35';
    else ctx.fillStyle = '#111111';
    ctx.fillText(line, sidePad, y);
    y += lineHeight;
  });

  ctx.drawImage(img, 0, headerHeight, imageWidth, imageHeight);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('共有用画像の生成に失敗しました')), 'image/jpeg', 0.94);
  });

  return new File([blob], `order-sheet-${scanId.slice(0, 8)}-${index + 1}.jpg`, { type: 'image/jpeg' });
}

async function buildBundledShareFiles(files, scanId) {
  const sourceFiles = Array.from(files || []);
  const bundled = [];
  for (let i = 0; i < sourceFiles.length; i += 1) {
    bundled.push(await makePromptEmbeddedImage(sourceFiles[i], i, scanId));
  }
  return bundled;
}

function downloadPreparedFile(file) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function openDedicatedCustomGpt() {
  window.location.assign(CUSTOM_GPT_URL);
}

export async function shareToChatGPT(files, prompt) {
  const sourceFiles = Array.from(files || []);
  const scanId = getActiveScanId() || ensureActiveScan().scanId;
  let bundledFiles = [];

  try {
    if (sourceFiles.length) bundledFiles = await buildBundledShareFiles(sourceFiles, scanId);
  } catch (error) {
    console.warn('Bundled share image failed; opening the dedicated GPT with the original image as manual fallback.', error);
  }

  try { await navigator.clipboard?.writeText?.(prompt); } catch {}

  if (bundledFiles.length) {
    try {
      bundledFiles.forEach(downloadPreparedFile);
    } catch (error) {
      console.warn('Prepared-image download failed. The user can attach the original photo manually.', error);
    }
  }

  openDedicatedCustomGpt();
  return {
    method: 'custom-gpt',
    bundled: bundledFiles.length > 0,
    preparedFileCount: bundledFiles.length,
    scanId,
    customGptUrl: CUSTOM_GPT_URL
  };
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
    { order: 1, place: '松ヶ崎', time: '10:40〜11:05', person: '泉近さん', name: 'ブルガリアヨーグルト', quantity: 1, confidence: 0.91, cancelled: false },
    { order: 2, place: '松ヶ崎', time: '10:40〜11:05', person: '泉近さん', name: 'TVラベルレス水2L', quantity: 1, confidence: 0.86, cancelled: false },
    { order: 3, place: '松ヶ崎', time: '10:40〜11:05', person: '木田さん', name: 'はちみつ赤飯', quantity: 1, confidence: 0.72, cancelled: false },
    { order: 4, place: '松ヶ崎', time: '10:40〜11:05', person: '藤井さん', name: 'ブルガリヤヨーグルト', quantity: 2, confidence: 0.82, cancelled: false },
    { order: 5, place: '松ヶ崎', time: '10:40〜11:05', person: '藤井さん', name: 'ゴマドレ', quantity: 1, confidence: 0.88, cancelled: false }
  ]
};
