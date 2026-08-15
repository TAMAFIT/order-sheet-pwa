import { parseAnalysisPayload } from './lib.js';
import { ensureActiveScan, getActiveScanId } from './scan-session.js';
import { CUSTOM_GPT_URL } from './runtime-config.js';
import { normalizeQuarterTurns, portraitRotationFor, rotatedSize } from './image-orientation-core.js';
import './capture-guard.js';
import './action-return.js';

let manualRotationQuarterTurns = 0;
let preparedCache = { key: '', promise: null };

export function setShareImageRotation(quarterTurns = 0) {
  manualRotationQuarterTurns = normalizeQuarterTurns(quarterTurns);
  preparedCache = { key: '', promise: null };
  return manualRotationQuarterTurns;
}

export function getShareImageRotation() {
  return manualRotationQuarterTurns;
}

export function buildPrompt() {
  const scanId = ensureActiveScan().scanId;
  return [
    `SCAN_ID: ${scanId}`,
    '添付した手書き注文票を、このGPTに設定済みの注文票解析ルールで解析してください。',
    '解析完了後は同じSCAN_IDで submitScanResult Action を1回実行してください。',
    'Actionの許可が表示されたら、ユーザーが許可するまで待ってください。'
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

function drawOrientedImage(ctx, img, x, y, width, height, quarterTurns) {
  const turns = normalizeQuarterTurns(quarterTurns);
  ctx.save();
  if (turns === 0) {
    ctx.drawImage(img, x, y, width, height);
  } else if (turns === 1) {
    ctx.translate(x + height, y);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0, width, height);
  } else if (turns === 2) {
    ctx.translate(x + width, y + height);
    ctx.rotate(Math.PI);
    ctx.drawImage(img, 0, 0, width, height);
  } else {
    ctx.translate(x, y + width);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, 0, 0, width, height);
  }
  ctx.restore();
}

async function makeScanTaggedImage(file, index, scanId) {
  const img = await loadImage(file);
  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  const quarterTurns = portraitRotationFor(sourceWidth, sourceHeight, manualRotationQuarterTurns);
  const oriented = rotatedSize(sourceWidth, sourceHeight, quarterTurns);
  const maxOutputWidth = 2200;
  const scale = Math.min(1, maxOutputWidth / Math.max(1, oriented.width));
  const baseWidth = Math.max(1, Math.round(sourceWidth * scale));
  const baseHeight = Math.max(1, Math.round(sourceHeight * scale));
  const outputSize = rotatedSize(baseWidth, baseHeight, quarterTurns);
  const imageWidth = Math.max(1, Math.round(outputSize.width));
  const imageHeight = Math.max(1, Math.round(outputSize.height));
  const fontSize = Math.max(22, Math.min(34, Math.round(imageWidth * 0.025)));
  const headerHeight = Math.round(fontSize * 3.25);

  const canvas = document.createElement('canvas');
  canvas.width = imageWidth;
  canvas.height = headerHeight + imageHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('この端末では共有用画像を作成できません');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, headerHeight);
  ctx.fillStyle = '#2e6b45';
  ctx.font = `800 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText('注文票 解析用', Math.round(fontSize * 0.8), Math.round(fontSize * 0.45));
  ctx.fillStyle = '#111111';
  ctx.font = `700 ${Math.max(18, Math.round(fontSize * 0.72))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText(`SCAN_ID: ${scanId}`, Math.round(fontSize * 0.8), Math.round(fontSize * 1.75));

  drawOrientedImage(ctx, img, 0, headerHeight, baseWidth, baseHeight, quarterTurns);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('共有用画像の生成に失敗しました')), 'image/jpeg', 0.94);
  });
  return new File([blob], `order-sheet-${scanId.slice(0, 8)}-${index + 1}.jpg`, { type: 'image/jpeg' });
}

async function buildBundledShareFiles(files, scanId) {
  const sourceFiles = Array.from(files || []);
  const bundled = [];
  for (let i = 0; i < sourceFiles.length; i += 1) {
    bundled.push(await makeScanTaggedImage(sourceFiles[i], i, scanId));
  }
  return bundled;
}

function prepareBundledFiles(scanId, files) {
  const sourceFiles = Array.from(files || []);
  if (!scanId || !sourceFiles.length) return null;
  const key = `${scanId}:${manualRotationQuarterTurns}:${sourceFiles.length}`;
  const promise = buildBundledShareFiles(sourceFiles, scanId).catch(error => {
    console.warn('Prepared image generation failed.', error);
    return [];
  });
  preparedCache = { key, promise };
  return promise;
}

if (typeof document !== 'undefined') {
  globalThis.addEventListener('order-sheet-scan-changed', event => {
    const scan = event.detail;
    if (scan?.status !== 'captured' || !scan.scanId) return;
    manualRotationQuarterTurns = 0;
    preparedCache = { key: '', promise: null };
    const files = document.querySelector('#imageInput')?.files;
    if (files?.length) prepareBundledFiles(scan.scanId, files);
  });
}

async function preparedFilesFor(scanId, files) {
  const sourceFiles = Array.from(files || []);
  const key = `${scanId}:${manualRotationQuarterTurns}:${sourceFiles.length}`;
  if (preparedCache.key === key && preparedCache.promise) return preparedCache.promise;
  return prepareBundledFiles(scanId, sourceFiles) || [];
}

async function toPngBlob(file) {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像をクリップボード用に変換できません');
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('画像をクリップボード用に変換できません')), 'image/png');
  });
}

async function copyPreparedImage(file) {
  if (!navigator.clipboard?.write || typeof globalThis.ClipboardItem === 'undefined') return false;
  try {
    const png = await toPngBlob(file);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch (error) {
    console.warn('Image clipboard is unavailable; using saved-file fallback.', error);
    return false;
  }
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function openDedicatedCustomGpt() {
  window.location.assign(CUSTOM_GPT_URL);
}

export async function shareToChatGPT(files, prompt) {
  const sourceFiles = Array.from(files || []);
  const scanId = getActiveScanId() || ensureActiveScan().scanId;
  let bundledFiles = [];

  try {
    bundledFiles = await preparedFilesFor(scanId, sourceFiles);
  } catch (error) {
    console.warn('Bundled share image failed; opening the dedicated GPT with the original image as manual fallback.', error);
  }

  let imageCopied = false;
  let filesSaved = false;
  if (bundledFiles.length === 1) imageCopied = await copyPreparedImage(bundledFiles[0]);

  if (!imageCopied && bundledFiles.length) {
    try {
      bundledFiles.forEach(downloadPreparedFile);
      filesSaved = true;
      await sleep(700);
    } catch (error) {
      console.warn('Prepared-image download failed. The user can attach the original photo manually.', error);
    }
  }

  if (!imageCopied) {
    try { await navigator.clipboard?.writeText?.(prompt); } catch {}
  }

  openDedicatedCustomGpt();
  return {
    method: 'custom-gpt',
    bundled: bundledFiles.length > 0,
    imageCopied,
    filesSaved,
    preparedFileCount: bundledFiles.length,
    scanId,
    rotationQuarterTurns: manualRotationQuarterTurns,
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
