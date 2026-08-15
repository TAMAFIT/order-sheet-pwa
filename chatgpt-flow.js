const AWAITING_KEY = 'order-sheet-awaiting-chatgpt';
const ACTION_AWAITING_KEY = 'order-sheet-action-awaiting-v1';
const LAST_IMPORTED_KEY = 'order-sheet-last-imported-clipboard';

const $ = selector => document.querySelector(selector);

function cleanJsonText(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) return trimmed.slice(objectStart, objectEnd + 1).trim();
  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) return trimmed.slice(arrayStart, arrayEnd + 1).trim();
  return trimmed;
}

function looksLikeAnalysisJson(text) {
  try {
    const parsed = JSON.parse(cleanJsonText(text));
    const items = Array.isArray(parsed) ? parsed : parsed?.items;
    return Array.isArray(items) && items.length > 0 && items.some(item => item && (item.name || item.product));
  } catch {
    return false;
  }
}

function setStatus(state, message) {
  const status = $('#chatgptFlowStatus');
  const card = $('#returnFlowCard');
  if (status) {
    status.dataset.state = state;
    status.textContent = message;
  }
  if (card) card.dataset.state = state;
}

function markAwaiting() {
  localStorage.setItem(AWAITING_KEY, '1');
  setStatus('waiting', '専用GPTで解析中。Action成功後はPWAへ戻るだけで結果を取得します');
}

function clearAwaiting() {
  localStorage.removeItem(AWAITING_KEY);
}

function isAwaiting() {
  return localStorage.getItem(AWAITING_KEY) === '1';
}

function isActionAwaiting() {
  try {
    return Boolean(JSON.parse(localStorage.getItem(ACTION_AWAITING_KEY) || '{}').scanId);
  } catch {
    return false;
  }
}

function cameFromChatGPT() {
  try {
    return new URL(window.location.href).searchParams.get('from') === 'chatgpt';
  } catch {
    return false;
  }
}

function cleanReturnParam() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('from')) return;
    url.searchParams.delete('from');
    history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {}
}

function importText(text, source = 'clipboard') {
  const clean = cleanJsonText(text);
  if (!looksLikeAnalysisJson(clean)) return false;
  const textarea = $('#analysisJson');
  const parseButton = $('#parseResultBtn');
  if (!textarea || !parseButton) return false;
  textarea.value = clean;
  localStorage.setItem(LAST_IMPORTED_KEY, clean);
  clearAwaiting();
  cleanReturnParam();
  setStatus('done', '結果を取り込みました。紙の順の確認画面へ移動します');
  parseButton.click();
  return true;
}

async function readClipboardAndImport({ silent = false } = {}) {
  if (!navigator.clipboard?.readText) {
    if (!silent) setStatus('manual', 'この端末では自動取得できません。下の手動入力を使ってください');
    return false;
  }
  try {
    const text = await navigator.clipboard.readText();
    const clean = cleanJsonText(text);
    const lastImported = localStorage.getItem(LAST_IMPORTED_KEY) || '';
    if (!clean || clean === lastImported || !looksLikeAnalysisJson(clean)) {
      if (!silent) setStatus('ready', 'Action失敗時はGPTのJSON回答をコピーしてから、もう一度このボタンを押してください');
      return false;
    }
    return importText(clean, 'clipboard');
  } catch {
    if (!silent) setStatus('ready', 'Action失敗時、回答をコピー済みなら「コピー結果を取り込む」を1回押してください');
    return false;
  }
}

let resumeTimer = null;
function tryAutoImportOnReturn({ force = false } = {}) {
  if (isActionAwaiting()) return;
  if (!force && !isAwaiting()) return;
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(async () => {
    setStatus('checking', 'コピー済みのフォールバック結果を確認しています…');
    const imported = await readClipboardAndImport({ silent: true });
    if (!imported && (isAwaiting() || force)) {
      setStatus('ready', 'Action結果が無い場合は、GPTのJSON回答をコピーして下のボタンから取り込めます');
      $('#returnFlowCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 350);
}

function setup() {
  const shareButton = $('#chatgptShareBtn');
  const importButton = $('#importClipboardBtn');
  const manualPasteButton = $('#manualPasteFocusBtn');

  shareButton?.addEventListener('click', () => {
    markAwaiting();
  });

  importButton?.addEventListener('click', () => readClipboardAndImport({ silent: false }));

  manualPasteButton?.addEventListener('click', () => {
    const textarea = $('#analysisJson');
    textarea?.focus();
    textarea?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  window.addEventListener('focus', () => tryAutoImportOnReturn());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tryAutoImportOnReturn();
  });

  window.addEventListener('paste', event => {
    if (!isAwaiting() && !cameFromChatGPT()) return;
    const text = event.clipboardData?.getData('text/plain') || '';
    if (looksLikeAnalysisJson(text)) importText(text, 'paste');
  });

  if (isActionAwaiting()) {
    setStatus('checking', 'Action結果を待っています。専用GPTで解析後、PWAへ戻ると自動取得します');
  } else if (cameFromChatGPT()) {
    setStatus('checking', 'ChatGPTから戻りました。フォールバック結果を確認しています…');
    tryAutoImportOnReturn({ force: true });
  } else if (isAwaiting()) {
    setStatus('ready', 'Action失敗時はGPTのJSON回答をコピーしてPWAへ戻ってください');
  }
}

setup();
