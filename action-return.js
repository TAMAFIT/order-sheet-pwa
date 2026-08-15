import { buildScanResultUrl, extractCompletedScanPayload, normalizeApiBaseUrl } from './action-return-core.js';
import { ensureActiveScan, getActiveScan, setActiveScanStatus, startNewScan } from './scan-session.js';

const CONFIG_KEY = 'order-sheet-action-return-config-v1';
const AWAITING_KEY = 'order-sheet-action-awaiting-v1';
const LAST_IMPORTED_KEY = 'order-sheet-action-last-imported-v1';
const LEGACY_CLIPBOARD_AWAITING_KEY = 'order-sheet-awaiting-chatgpt';

const $ = selector => document.querySelector(selector);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function readConfig() {
  try {
    const config = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return { baseUrl: normalizeApiBaseUrl(config.baseUrl || '') };
  } catch {
    return { baseUrl: '' };
  }
}

function saveConfig(baseUrl) {
  const clean = normalizeApiBaseUrl(baseUrl);
  if (clean && !/^https:\/\//i.test(clean)) throw new Error('Action結果APIは https:// のURLを設定してください');
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ baseUrl: clean, updatedAt: new Date().toISOString() }));
  return clean;
}

function isConfigured() {
  return Boolean(readConfig().baseUrl);
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

function setAwaiting(scanId) {
  localStorage.setItem(AWAITING_KEY, JSON.stringify({ scanId, startedAt: new Date().toISOString() }));
}

function getAwaitingScanId() {
  try {
    return JSON.parse(localStorage.getItem(AWAITING_KEY) || '{}').scanId || '';
  } catch {
    return '';
  }
}

function clearAwaiting() {
  localStorage.removeItem(AWAITING_KEY);
}

function updateScanLabel() {
  const label = $('#activeScanId');
  if (!label) return;
  const scanId = getActiveScan()?.scanId || '';
  label.textContent = scanId || '未発行';
  label.title = scanId;
}

function injectStyles() {
  if ($('#actionReturnStyles')) return;
  const style = document.createElement('style');
  style.id = 'actionReturnStyles';
  style.textContent = `
    .action-scan-row code{max-width:68%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#315b43}
    .action-route-note{margin-top:12px;padding:12px 14px;border:1px solid #d8e7dd;border-radius:14px;background:#f7fbf8;font-size:13px;line-height:1.6;color:#355442}
    .action-route-note strong{display:block;color:#174d31;margin-bottom:3px}
    .action-route-tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .action-route-tools button{flex:1 1 160px}
    .action-config-status{margin-top:10px;font-size:12px;color:#68756d}
  `;
  document.head.appendChild(style);
}

function rewriteFlowCopy() {
  const shareButton = $('#chatgptShareBtn');
  const card = shareButton?.closest('.card');
  if (!card) return;
  const intro = card.querySelector('.card-sub');
  if (intro) intro.textContent = '専用Custom GPT＋Actionsを設定すると、GPTの解析結果をscan_idで自動受信できます。Actions未設定・失敗時は従来のコピー方式をそのまま使えます。';

  const steps = [...card.querySelectorAll('.guided-flow .flow-step')];
  if (steps[1]) {
    const title = steps[1].querySelector('h3');
    const paragraphs = steps[1].querySelectorAll('p');
    if (title) title.textContent = 'GPT解析 → Actionで結果保存';
    if (paragraphs[0]) paragraphs[0].textContent = '専用GPTでは解析後に submitScanResult Action を実行し、結果をscan_idと一緒に外部APIへ保存します。確認画面が出た場合は許可してください。';
    if (paragraphs[1]) paragraphs[1].textContent = 'Actionが使えない・失敗した場合だけ、GPTのJSON回答をコピーしてください。これが従来フォールバックです。';
  }
  if (steps[2]) {
    const title = steps[2].querySelector('h3');
    const paragraph = steps[2].querySelector('p');
    if (title) title.textContent = 'PWAへ戻る → scan_idで自動取得';
    if (paragraph) paragraph.textContent = 'PWAへ戻るとAction結果APIを短時間ポーリングします。結果が届けば自動で現在の全件確認UIへ反映します。未取得なら従来のコピー取込を使えます。';
  }

  if (!$('#actionRouteNote')) {
    const note = document.createElement('div');
    note.id = 'actionRouteNote';
    note.className = 'action-route-note';
    note.innerHTML = '<strong>通常ルート：Action → API → PWA</strong><span id="actionRouteModeText"></span><div class="action-route-tools"><button id="checkActionResultBtn" class="secondary-btn" type="button">Action結果を確認</button></div>';
    card.querySelector('.guided-flow')?.insertAdjacentElement('afterend', note);
  }
  refreshModeText();
}

function injectScanIdRow() {
  if ($('#activeScanId')) return;
  const selected = $('#selectedCount')?.closest('.selection-row');
  if (!selected) return;
  const row = document.createElement('div');
  row.className = 'selection-row action-scan-row';
  row.innerHTML = '<span>SCAN ID</span><code id="activeScanId">未発行</code>';
  selected.insertAdjacentElement('afterend', row);
  updateScanLabel();
}

function injectSettings() {
  if ($('#actionReturnSettings')) return;
  const backendCard = $('#backendEndpoint')?.closest('.card');
  if (!backendCard) return;
  const section = document.createElement('section');
  section.id = 'actionReturnSettings';
  section.className = 'card';
  section.innerHTML = `
    <h2>Custom GPT Action返却</h2>
    <p class="card-sub">ChatGPTの画像解析自体はそのまま使い、結果だけ外部APIへ保存してPWAがscan_idで取得します。APIキーはPWAへ入れません。</p>
    <div class="security-note">POST側の秘密鍵はCustom GPT Actionとサーバー側だけに置きます。PWAは推測困難なscan_idを使ってGETします。</div>
    <div class="field">
      <label for="actionResultBaseUrl">Action結果APIのベースURL</label>
      <input id="actionResultBaseUrl" type="url" inputmode="url" placeholder="https://your-worker.workers.dev">
    </div>
    <button id="saveActionResultSettingsBtn" class="primary-btn" type="button">Action返却設定を保存</button>
    <div id="actionConfigStatus" class="action-config-status"></div>
  `;
  backendCard.insertAdjacentElement('beforebegin', section);
  $('#actionResultBaseUrl').value = readConfig().baseUrl;
  $('#saveActionResultSettingsBtn').addEventListener('click', () => {
    try {
      const baseUrl = saveConfig($('#actionResultBaseUrl').value);
      refreshModeText();
      refreshConfigStatus();
      setStatus(baseUrl ? 'ready' : 'manual', baseUrl ? 'Action返却を有効化しました。次の撮影からscan_idで結果を確認します' : 'Action結果API未設定。従来のコピー方式を使います');
    } catch (error) {
      setStatus('manual', error.message || '設定を保存できませんでした');
    }
  });
  refreshConfigStatus();
}

function refreshModeText() {
  const mode = $('#actionRouteModeText');
  if (!mode) return;
  mode.textContent = isConfigured()
    ? 'Action結果API設定済み。PWA復帰時はまず自動取得を試し、失敗時だけコピー方式へ戻ります。'
    : 'Action結果APIは未設定です。現在は従来の「JSONをコピー → PWAへ戻る」が動作します。';
}

function refreshConfigStatus() {
  const el = $('#actionConfigStatus');
  if (!el) return;
  el.textContent = isConfigured() ? `接続先: ${readConfig().baseUrl}` : '未設定';
}

async function fetchActionResult(scanId) {
  const { baseUrl } = readConfig();
  if (!baseUrl) return { state: 'disabled' };
  const url = buildScanResultUrl(baseUrl, scanId);
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (response.status === 404 || response.status === 202 || response.status === 204) return { state: 'pending' };
  if (!response.ok) throw new Error(`Action結果API: HTTP ${response.status}`);
  const payload = extractCompletedScanPayload(await response.json(), scanId);
  return payload ? { state: 'completed', payload } : { state: 'pending' };
}

function importActionPayload(payload) {
  const textarea = $('#analysisJson');
  const parseButton = $('#parseResultBtn');
  if (!textarea || !parseButton) throw new Error('解析結果の取込先が見つかりません');
  const scanId = payload.scan_id || getAwaitingScanId();
  const last = localStorage.getItem(LAST_IMPORTED_KEY) || '';
  if (scanId && last === scanId) return false;
  textarea.value = JSON.stringify({ items: payload.items }, null, 2);
  if (scanId) localStorage.setItem(LAST_IMPORTED_KEY, scanId);
  localStorage.removeItem(LEGACY_CLIPBOARD_AWAITING_KEY);
  clearAwaiting();
  setActiveScanStatus('completed', { completedAt: new Date().toISOString() });
  setStatus('done', 'Action結果を自動取得しました。紙の順の確認画面へ移動します');
  parseButton.click();
  return true;
}

let polling = false;
async function pollBurst({ attempts = 8, intervalMs = 1100, userInitiated = false } = {}) {
  if (polling) return false;
  const scanId = getAwaitingScanId() || getActiveScan()?.scanId || '';
  if (!scanId || !isConfigured()) {
    if (userInitiated) setStatus('manual', 'Action結果APIが未設定です。従来のコピー方式を使ってください');
    return false;
  }
  polling = true;
  try {
    setStatus('checking', `Action結果を確認中… (${scanId.slice(0, 8)})`);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await fetchActionResult(scanId);
        if (result.state === 'completed') return importActionPayload(result.payload);
      } catch (error) {
        setStatus('ready', `${error.message || 'Action結果を取得できませんでした'}。必要なら従来のコピー取込を使えます`);
        return false;
      }
      if (attempt < attempts - 1) await sleep(intervalMs);
    }
    setStatus('ready', 'まだAction結果が届いていません。数秒後に再確認するか、Action失敗時はJSONをコピーして下の取込ボタンを押してください');
    return false;
  } finally {
    polling = false;
  }
}

function setup() {
  injectStyles();
  injectScanIdRow();
  rewriteFlowCopy();
  injectSettings();

  $('#imageInput')?.addEventListener('change', event => {
    if (!event.target.files?.length) return;
    startNewScan();
    clearAwaiting();
    updateScanLabel();
    setStatus(isConfigured() ? 'ready' : 'manual', isConfigured() ? '新しいSCAN IDを発行しました。ChatGPTへ送信できます' : 'SCAN IDを発行しました。Action API未設定のためコピー方式で利用できます');
  });

  $('#chatgptShareBtn')?.addEventListener('click', () => {
    const scan = ensureActiveScan();
    setAwaiting(scan.scanId);
    setActiveScanStatus('shared', { sharedAt: new Date().toISOString() });
    updateScanLabel();
    if (isConfigured()) setStatus('waiting', 'ChatGPTで解析中。Action成功後、PWAへ戻るだけで結果を自動取得します');
  });

  $('#checkActionResultBtn')?.addEventListener('click', () => pollBurst({ attempts: 3, intervalMs: 800, userInitiated: true }));

  globalThis.addEventListener('order-sheet-scan-changed', updateScanLabel);
  window.addEventListener('focus', () => setTimeout(() => pollBurst(), 120));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(() => pollBurst(), 120);
  });

  const awaiting = getAwaitingScanId();
  if (awaiting && isConfigured()) setTimeout(() => pollBurst(), 250);
}

if (typeof document !== 'undefined') setup();

export { fetchActionResult, pollBurst, readConfig };
