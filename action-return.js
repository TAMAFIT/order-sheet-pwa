import { buildScanResultUrl, extractCompletedScanPayload, normalizeApiBaseUrl } from './action-return-core.js';
import { ensureActiveScan, getActiveScan, setActiveScanStatus, startNewScan } from './scan-session.js';
import { DEFAULT_ACTION_BASE_URL } from './runtime-config.js';

const CONFIG_KEY = 'order-sheet-action-return-config-v1';
const AWAITING_KEY = 'order-sheet-action-awaiting-v1';
const LAST_IMPORTED_KEY = 'order-sheet-action-last-imported-v1';
const LEGACY_CLIPBOARD_AWAITING_KEY = 'order-sheet-awaiting-chatgpt';
const CLOUDFLARE_DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/TAMAFIT/order-sheet-pwa/tree/main/cloudflare-action-api';

const $ = selector => document.querySelector(selector);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function readConfig() {
  try {
    const config = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return { baseUrl: normalizeApiBaseUrl(config.baseUrl || DEFAULT_ACTION_BASE_URL) };
  } catch {
    return { baseUrl: DEFAULT_ACTION_BASE_URL };
  }
}

function saveConfig(baseUrl) {
  const clean = normalizeApiBaseUrl(baseUrl || DEFAULT_ACTION_BASE_URL);
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
    .action-route-tools,.action-setup-tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .action-route-tools button,.action-setup-tools>*{flex:1 1 160px}
    .action-config-status{margin-top:10px;font-size:12px;color:#68756d;overflow-wrap:anywhere}
    .action-deploy-link{text-decoration:none;display:flex;align-items:center;justify-content:center}
  `;
  document.head.appendChild(style);
}

function rewriteFlowCopy() {
  const shareButton = $('#chatgptShareBtn');
  const card = shareButton?.closest('.card');
  if (!card) return;
  const intro = card.querySelector('.card-sub');
  if (intro) intro.textContent = '「GPTへ送る」で専用の手書き注文解析GPTを直接開きます。SCAN_ID入りの共有用画像も端末へ保存されるので、GPTでその画像を添付して送信してください。';

  const steps = [...card.querySelectorAll('.guided-flow .flow-step')];
  if (steps[0]) {
    const title = steps[0].querySelector('h3');
    const paragraph = steps[0].querySelector('p');
    if (title) title.textContent = '専用GPTを開く';
    if (paragraph) paragraph.textContent = 'ボタンを押すと、SCAN_IDと解析指示を埋め込んだ共有用画像を端末へ保存してから「手書き注文解析GPT」を直接開きます。';
    if (shareButton) shareButton.textContent = '手書き注文解析GPTを開く';
  }
  if (steps[1]) {
    const title = steps[1].querySelector('h3');
    const paragraphs = steps[1].querySelectorAll('p');
    if (title) title.textContent = '共有用画像を添付して送信';
    if (paragraphs[0]) paragraphs[0].textContent = 'GPTの添付ボタンから、直前に保存された order-sheet-xxxx.jpg を選んで送信してください。解析後は submitScanResult Action がSCAN_IDと結果をCloudflareへ保存します。';
    if (paragraphs[1]) paragraphs[1].textContent = 'Actionが使えない・失敗した場合だけ、GPTのJSON回答をコピーしてください。従来の取込ルートは残しています。';
  }
  if (steps[2]) {
    const title = steps[2].querySelector('h3');
    const paragraph = steps[2].querySelector('p');
    if (title) title.textContent = 'PWAへ戻る → 自動取得';
    if (paragraph) paragraph.textContent = '解析が終わったらPWAへ戻るだけです。同じSCAN_IDの結果を自動取得し、紙の順の全件確認画面へ反映します。';
  }

  if (!$('#actionRouteNote')) {
    const note = document.createElement('div');
    note.id = 'actionRouteNote';
    note.className = 'action-route-note';
    note.innerHTML = '<strong>通常ルート：専用GPT → Action → Cloudflare → PWA</strong><span id="actionRouteModeText"></span><div class="action-route-tools"><button id="checkActionResultBtn" class="secondary-btn" type="button">Action結果を確認</button></div>';
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
    <p class="card-sub">本番Worker URLは初期設定済みです。通常利用ではここを触る必要はありません。</p>
    <div class="security-note">GPTの解析結果だけをCloudflareへ一時保存し、PWAがSCAN_IDで取得します。APIキーはPWAへ保存しません。</div>
    <div class="field">
      <label for="actionResultBaseUrl">Worker URL</label>
      <input id="actionResultBaseUrl" type="url" inputmode="url" placeholder="https://order-sheet-action-api.xxxxx.workers.dev">
    </div>
    <div class="action-setup-tools">
      <button id="saveActionResultSettingsBtn" class="primary-btn" type="button">URLを保存</button>
      <button id="testActionResultSettingsBtn" class="secondary-btn" type="button">接続テスト</button>
    </div>
    <details>
      <summary class="text-button">Cloudflareを作り直す場合だけ</summary>
      <div class="action-setup-tools"><a class="secondary-btn action-deploy-link" href="${CLOUDFLARE_DEPLOY_URL}" target="_blank" rel="noopener noreferrer">Cloudflareを再セットアップ</a></div>
    </details>
    <div id="actionConfigStatus" class="action-config-status"></div>
  `;
  backendCard.insertAdjacentElement('beforebegin', section);
  $('#actionResultBaseUrl').value = readConfig().baseUrl;
  $('#saveActionResultSettingsBtn').addEventListener('click', () => {
    try {
      const baseUrl = saveConfig($('#actionResultBaseUrl').value);
      refreshModeText();
      refreshConfigStatus();
      setStatus(baseUrl ? 'ready' : 'manual', baseUrl ? 'Action返却URLを保存しました。接続テストで確認できます' : 'Action結果API未設定。従来のコピー方式を使います');
    } catch (error) {
      setStatus('manual', error.message || '設定を保存できませんでした');
    }
  });
  $('#testActionResultSettingsBtn').addEventListener('click', testConnection);
  refreshConfigStatus();
}

function refreshModeText() {
  const mode = $('#actionRouteModeText');
  if (!mode) return;
  mode.textContent = isConfigured()
    ? '本番Action結果APIを使用します。PWA復帰時に自動取得を試し、失敗時だけコピー方式へ戻れます。'
    : 'Action結果APIは未設定です。現在は従来の「JSONをコピー → PWAへ戻る」が動作します。';
}

function refreshConfigStatus(extra = '') {
  const el = $('#actionConfigStatus');
  if (!el) return;
  const base = isConfigured() ? `接続先: ${readConfig().baseUrl}` : '未設定';
  el.textContent = extra ? `${base} / ${extra}` : base;
}

async function testConnection() {
  let baseUrl;
  try {
    baseUrl = saveConfig($('#actionResultBaseUrl')?.value || readConfig().baseUrl);
  } catch (error) {
    refreshConfigStatus(error.message || 'URLが不正です');
    return false;
  }
  if (!baseUrl) {
    refreshConfigStatus('Worker URLを入力してください');
    return false;
  }
  refreshConfigStatus('接続確認中…');
  try {
    const response = await fetch(`${baseUrl}/health`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) throw new Error(`HTTP ${response.status}`);
    refreshModeText();
    refreshConfigStatus('接続OK');
    setStatus('ready', 'Cloudflare接続OK。専用GPTで解析後は、PWAへ戻るだけで結果を取得できます');
    return true;
  } catch (error) {
    refreshConfigStatus(`接続NG: ${error.message || '応答なし'}`);
    return false;
  }
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
    setStatus(isConfigured() ? 'ready' : 'manual', isConfigured() ? '新しいSCAN IDを発行しました。専用GPTへ送信できます' : 'SCAN IDを発行しました。Action API未設定のためコピー方式で利用できます');
  });

  $('#chatgptShareBtn')?.addEventListener('click', () => {
    const scan = ensureActiveScan();
    setAwaiting(scan.scanId);
    setActiveScanStatus('shared', { sharedAt: new Date().toISOString() });
    updateScanLabel();
    if (isConfigured()) setStatus('waiting', '専用GPTで共有用画像を添付して送信してください。Action成功後、PWAへ戻るだけで結果を自動取得します');
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

export { fetchActionResult, pollBurst, readConfig, testConnection };
