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
  setStatus('waiting', 'ChatGPTで画像を送信し、解析後に表示される「許可」を必ず押してください');
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

function importText(text) {
  const clean = cleanJsonText(text);
  if (!looksLikeAnalysisJson(clean)) return false;
  const textarea = $('#analysisJson');
  const parseButton = $('#parseResultBtn');
  if (!textarea || !parseButton) return false;
  textarea.value = clean;
  localStorage.setItem(LAST_IMPORTED_KEY, clean);
  clearAwaiting();
  setStatus('done', 'バックアップ結果を取り込みました。確認画面へ進みます');
  parseButton.click();
  return true;
}

async function readClipboardAndImport({ silent = false } = {}) {
  if (!navigator.clipboard?.readText) {
    if (!silent) setStatus('manual', 'この端末ではクリップボードを自動で読めません。下の貼り付け欄を使ってください');
    return false;
  }
  try {
    const text = await navigator.clipboard.readText();
    const clean = cleanJsonText(text);
    const lastImported = localStorage.getItem(LAST_IMPORTED_KEY) || '';
    if (!clean || clean === lastImported || !looksLikeAnalysisJson(clean)) {
      if (!silent) setStatus('ready', 'バックアップJSONをコピーしてから、もう一度取り込んでください');
      return false;
    }
    return importText(clean);
  } catch {
    if (!silent) setStatus('ready', 'バックアップJSONをコピー済みなら、貼り付け欄から復元してください');
    return false;
  }
}

let resumeTimer = null;
function tryAutoImportOnReturn() {
  if (isActionAwaiting() || !isAwaiting()) return;
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(async () => {
    const imported = await readClipboardAndImport({ silent: true });
    if (!imported && isAwaiting()) setStatus('ready', '通常はChatGPTで「許可」を押すと自動で届きます。送信失敗時だけ下の復旧を使ってください');
  }, 350);
}

function setup() {
  $('#chatgptShareBtn')?.addEventListener('click', markAwaiting);
  $('#importClipboardBtn')?.addEventListener('click', () => readClipboardAndImport({ silent: false }));
  $('#manualPasteFocusBtn')?.addEventListener('click', () => {
    const textarea = $('#analysisJson');
    textarea?.focus();
    textarea?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  window.addEventListener('focus', tryAutoImportOnReturn);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tryAutoImportOnReturn();
  });
  window.addEventListener('paste', event => {
    if (!isAwaiting()) return;
    const text = event.clipboardData?.getData('text/plain') || '';
    if (looksLikeAnalysisJson(text)) importText(text);
  });

  if (isActionAwaiting()) {
    setStatus('waiting', '解析結果を待っています。ChatGPTで解析後に表示される「許可」を押し、アプリへ戻ってください');
  } else if (isAwaiting()) {
    setStatus('ready', '結果が届かない場合はChatGPTで「許可」が表示されていないか確認してください');
  }
}

setup();
