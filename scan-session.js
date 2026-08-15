const ACTIVE_SCAN_KEY = 'order-sheet-active-scan-v1';

function fallbackUuid() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createScanId() {
  return globalThis.crypto?.randomUUID?.() || fallbackUuid();
}

function readRecord() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_SCAN_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeRecord(record) {
  localStorage.setItem(ACTIVE_SCAN_KEY, JSON.stringify(record));
  globalThis.dispatchEvent?.(new CustomEvent('order-sheet-scan-changed', { detail: record }));
  return record;
}

export function startNewScan() {
  return writeRecord({
    scanId: createScanId(),
    status: 'captured',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

export function ensureActiveScan() {
  const existing = readRecord();
  if (existing?.scanId) return existing;
  return startNewScan();
}

export function getActiveScan() {
  return readRecord();
}

export function getActiveScanId() {
  return readRecord()?.scanId || '';
}

export function setActiveScanStatus(status, patch = {}) {
  const current = ensureActiveScan();
  return writeRecord({
    ...current,
    ...patch,
    status,
    updatedAt: new Date().toISOString()
  });
}

export function clearActiveScan() {
  localStorage.removeItem(ACTIVE_SCAN_KEY);
  globalThis.dispatchEvent?.(new CustomEvent('order-sheet-scan-changed', { detail: null }));
}
