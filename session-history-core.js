import { setupReviewReorder } from './review-reorder-v17.js';

let liveRecognitionItems = [];

setupReviewReorder(() => liveRecognitionItems);

export function cloneValue(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function buildSessionSnapshot({
  id,
  scanId = '',
  writerTag = '',
  source = 'manual',
  rawPayload = '',
  recognitions = [],
  imageCount = 0,
  workflowStatus = 'review',
  totals = []
} = {}) {
  const items = cloneValue(Array.isArray(recognitions) ? recognitions : []);
  const confirmedCount = items.filter(item => item.status === 'confirmed').length;
  return {
    id,
    scanId: String(scanId || ''),
    writerTag: String(writerTag || ''),
    source: String(source || 'manual'),
    rawPayload: String(rawPayload || ''),
    recognitions: items,
    imageCount: Number(imageCount || 0),
    recognitionCount: items.length,
    confirmedCount,
    resolvedCount: items.filter(item => item.status === 'confirmed' && !item.cancelled).length,
    workflowStatus: workflowStatus === 'complete' ? 'complete' : 'review',
    totals: cloneValue(Array.isArray(totals) ? totals : [])
  };
}

export function findResumeSession(sessions = []) {
  return sessions.find(session =>
    Array.isArray(session?.recognitions) &&
    session.recognitions.length > 0 &&
    session.workflowStatus !== 'complete'
  ) || null;
}

export function recentRestorableSessions(sessions = [], limit = 10) {
  return sessions
    .filter(session => Array.isArray(session?.recognitions) && session.recognitions.length > 0)
    .slice(0, Math.max(0, Number(limit) || 0));
}

export function groupRecognitions(items = []) {
  liveRecognitionItems = items;
  const groups = [];
  let current = null;
  for (const item of items) {
    const key = [item?.place || '', item?.time || '', item?.person || ''].join('|');
    if (!current || current.key !== key) {
      current = { key, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}
