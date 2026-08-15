import { normalizeText } from './lib.js';

export const ATTENTION_CONFIDENCE = 0.6;

export function isUnreadableName(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return true;
  const normalized = normalizeText(raw);
  if (!normalized) return true;
  return [
    '判読不明',
    '不明',
    '読取不明',
    '読み取り不明',
    '商品名不明'
  ].some(label => normalized === normalizeText(label));
}

export function attentionReason(item = {}) {
  if (item.cancelled) return '';
  const name = String(item.rawName ?? item.name ?? '').trim();
  const note = String(item.note || '').trim();
  if (isUnreadableName(name)) return note || '商品名を読み取れませんでした';
  if (/(数量).*(判読|不明|困難)|((判読|不明|困難).*(数量))/u.test(note)) return note || '数量を確認してください';
  if (/(商品名|商品).*(判読|不明|困難)|((判読|不明|困難).*(商品名|商品))/u.test(note)) return note || '商品名を確認してください';
  const confidence = Number(item.confidence);
  if (Number.isFinite(confidence) && confidence < ATTENTION_CONFIDENCE) {
    return `読み取り精度 ${Math.round(Math.max(0, confidence) * 100)}%`;
  }
  return '';
}

export function needsAttention(item = {}) {
  return Boolean(attentionReason(item));
}

export function attentionItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter(item => needsAttention(item))
    .slice()
    .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
}

export function aggregateInstantRecognitions(recognitions = [], products = []) {
  const productMap = new Map((Array.isArray(products) ? products : []).map(product => [product.id, product]));
  const totals = new Map();

  for (const item of Array.isArray(recognitions) ? recognitions : []) {
    if (!item || item.cancelled) continue;
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const rawName = String(item.rawName ?? item.name ?? '').trim();
    if (isUnreadableName(rawName)) continue;

    const product = item.matchedProductId ? productMap.get(item.matchedProductId) : null;
    const canonicalName = String(product?.canonicalName || rawName).trim();
    if (!canonicalName) continue;
    const rawKey = normalizeText(canonicalName) || canonicalName.toLowerCase();
    const key = product?.id ? `product:${product.id}` : `raw:${rawKey}`;
    const reason = attentionReason(item);
    const confidence = Number(item.confidence);

    const current = totals.get(key) || {
      key,
      productId: product?.id || null,
      canonicalName,
      location: product?.location || '',
      quantity: 0,
      sourceIds: [],
      firstOrder: Number(item.order || 0),
      attentionCount: 0,
      confidence: Number.isFinite(confidence) ? confidence : 1
    };

    current.quantity += quantity;
    if (item.id) current.sourceIds.push(item.id);
    current.firstOrder = Math.min(current.firstOrder || Number(item.order || 0), Number(item.order || 0));
    if (reason) current.attentionCount += 1;
    if (Number.isFinite(confidence)) current.confidence = Math.min(current.confidence, confidence);
    totals.set(key, current);
  }

  return [...totals.values()].sort((a, b) => {
    const la = a.location || 'ZZZ';
    const lb = b.location || 'ZZZ';
    const locationOrder = la.localeCompare(lb, 'ja');
    if (locationOrder) return locationOrder;
    const paperOrder = Number(a.firstOrder || 0) - Number(b.firstOrder || 0);
    if (paperOrder) return paperOrder;
    return a.canonicalName.localeCompare(b.canonicalName, 'ja');
  });
}
