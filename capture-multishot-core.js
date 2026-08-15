export const CAPTURE_MODE_SINGLE = 'single';
export const CAPTURE_MODE_SPLIT = 'split';
export const MAX_SPLIT_PARTS = 2;

export function normalizeCaptureMode(value = CAPTURE_MODE_SINGLE) {
  return value === CAPTURE_MODE_SPLIT ? CAPTURE_MODE_SPLIT : CAPTURE_MODE_SINGLE;
}

export function nextSplitSlot(count = 0) {
  const value = Math.max(0, Number(count) || 0);
  if (value <= 0) return 'top';
  if (value === 1) return 'bottom';
  return 'complete';
}

export function acceptedIncomingCount(mode, currentCount = 0, incomingCount = 0) {
  const normalizedMode = normalizeCaptureMode(mode);
  const incoming = Math.max(0, Number(incomingCount) || 0);
  if (!incoming) return 0;
  if (normalizedMode === CAPTURE_MODE_SINGLE) return 1;
  const remaining = Math.max(0, MAX_SPLIT_PARTS - Math.max(0, Number(currentCount) || 0));
  return Math.min(remaining, incoming);
}

export function splitStatus(count = 0) {
  const slot = nextSplitSlot(count);
  if (slot === 'top') return { slot, label: '① 上半分を撮影してください', complete: false };
  if (slot === 'bottom') return { slot, label: '② 下半分を撮影してください', complete: false };
  return { slot, label: '上下2枚を1枚にまとめました', complete: true };
}
