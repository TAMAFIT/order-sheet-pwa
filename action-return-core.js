export function normalizeApiBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function buildScanResultUrl(baseUrl, scanId) {
  const base = normalizeApiBaseUrl(baseUrl);
  const id = String(scanId || '').trim();
  if (!/^https:\/\//i.test(base)) throw new Error('Action結果APIは https:// のURLを設定してください');
  if (!id) throw new Error('scan_id がありません');
  return `${base}/scan/${encodeURIComponent(id)}`;
}

export function extractCompletedScanPayload(payload, expectedScanId = '') {
  if (!payload || typeof payload !== 'object') return null;
  const scanId = String(payload.scan_id || payload.scanId || '').trim();
  if (expectedScanId && scanId && scanId !== expectedScanId) throw new Error('scan_id が一致しません');
  const status = String(payload.status || '').toLowerCase();
  if (status && status !== 'completed') return null;
  const items = Array.isArray(payload.items) ? payload.items : payload.result?.items;
  if (!Array.isArray(items) || !items.length) return null;
  return {
    scan_id: scanId || expectedScanId,
    status: 'completed',
    items
  };
}
