const AWAITING_KEY = 'order-sheet-awaiting-chatgpt';
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
  setStatus('waiting', 'ChatGPTで解析中。回答をコピーして「集計アプリに戻る」を押してください');
}

function clearAwaiting() {
  localStorage.removeItem(AWAITING_KEY);
}

function isAwaiting() {
  return localStorage.getItem(AWAITING_KEY) === '1';
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
      if (!silent) setStatus('ready', 'ChatGPTの回答をコピーしてから、もう一度このボタンを押してください');
      return false;
    }
    return importText(clean, 'clipboard');
  } catch {
    if (!silent) setStatus('ready', '回答をコピー済みなら「コピー結果を取り込む」を1回押してください');
    return false;
  }
}

let resumeTimer = null;
function tryAutoImportOnReturn({ force = false } = {}) {
  if (!force && !isAwaiting()) return;
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(async () => {
    setStatus('checking', 'ChatGPTから戻りました。コピー済みの回答を確認しています…');
    const imported = await readClipboardAndImport({ silent: true });
    if (!imported && (isAwaiting() || force)) {
      setStatus('ready', '自動取得が止められました。下のボタンを1回押せば取り込めます');
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

  if (cameFromChatGPT()) {
    setStatus('checking', 'ChatGPTから戻りました。結果を自動取得しています…');
    tryAutoImportOnReturn({ force: true });
  } else if (isAwaiting()) {
    setStatus('ready', '回答をコピーしたら、ChatGPT内の「集計アプリに戻る」を押してください');
  }
}

setup();