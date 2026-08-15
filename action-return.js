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
  if (clean && !/^https:\/\//i.test(clean)) throw new Error('結果受取URLは https:// のURLを設定してください');
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

function injectSettings() {
  if ($('#actionReturnSettings')) return;
  const backendCard = $('#backendEndpoint')?.closest('.card');
  if (!backendCard) return;
  const section = document.createElement('section');
  section.id = 'actionReturnSettings';
  section.className = 'card advanced-card';
  section.innerHTML = `
    <h2>解析結果の受取設定</h2>
    <p class="card-sub">通常は変更不要です。解析結果をアプリへ戻す接続先です。</p>
    <div class="field">
      <label for="actionResultBaseUrl">結果受取URL</label>
      <input id="actionResultBaseUrl" type="url" inputmode="url" placeholder="https://...">
    </div>
    <div class="action-setup-tools">
      <button id="saveActionResultSettingsBtn" class="primary-btn" type="button">URLを保存</button>
      <button id="testActionResultSettingsBtn" class="secondary-btn" type="button">接続テスト</button>
    </div>
    <details>
      <summary class="text-button">接続先を作り直す場合だけ</summary>
      <div class="action-setup-tools"><a class="secondary-btn action-deploy-link" href="${CLOUDFLARE_DEPLOY_URL}" target="_blank" rel="noopener noreferrer">再セットアップ</a></div>
    </details>
    <div id="actionConfigStatus" class="action-config-status"></div>
  `;
  backendCard.insertAdjacentElement('beforebegin', section);
  $('#actionResultBaseUrl').value = readConfig().baseUrl;
  $('#saveActionResultSettingsBtn').addEventListener('click', () => {
    try {
      const baseUrl = saveConfig($('#actionResultBaseUrl').value);
      refreshConfigStatus();
      setStatus(baseUrl ? 'ready' : 'manual', baseUrl ? '結果受取URLを保存しました' : '自動受取が未設定です。トラブル時の復旧を使ってください');
    } catch (error) {
      setStatus('manual', error.message || '設定を保存できませんでした');
    }
  });
  $('#testActionResultSettingsBtn').addEventListener('click', testConnection);
  refreshConfigStatus();
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
    refreshConfigStatus('URLを入力してください');
    return false;
  }
  refreshConfigStatus('接続確認中…');
  try {
    const response = await fetch(`${baseUrl}/health`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) throw new Error(`HTTP ${response.status}`);
    refreshConfigStatus('接続OK');
    setStatus('ready', '接続OK。ChatGPTで解析後、アプリへ戻ると結果を自動取得します');
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
  if (!response.ok) throw new Error(`解析結果の取得エラー: HTTP ${response.status}`);
  const payload = extractCompletedScanPayload(await response.json(), scanId);
  return payload ? { state: 'completed', payload } : { state: 'pending' };
}

function importActionPayload(payload, { force = false } = {}) {
  const textarea = $('#analysisJson');
  const parseButton = $('#parseResultBtn');
  if (!textarea || !parseButton) throw new Error('解析結果の取込先が見つかりません');
  const scanId = payload.scan_id || getAwaitingScanId();
  const last = localStorage.getItem(LAST_IMPORTED_KEY) || '';
  if (!force && scanId && last === scanId) return false;
  textarea.value = JSON.stringify({ scan_id: scanId, items: payload.items }, null, 2);
  if (scanId) localStorage.setItem(LAST_IMPORTED_KEY, scanId);
  localStorage.removeItem(LEGACY_CLIPBOARD_AWAITING_KEY);
  clearAwaiting();
  setActiveScanStatus('completed', { completedAt: new Date().toISOString() });
  setStatus('done', '解析結果を受け取りました。確認画面へ進みます');
  parseButton.click();
  return true;
}

let polling = false;
async function pollBurst({ attempts = 8, intervalMs = 1100, userInitiated = false } = {}) {
  if (polling) return false;
  const scanId = getAwaitingScanId() || getActiveScan()?.scanId || '';
  if (!scanId || !isConfigured()) {
    if (userInitiated) setStatus('manual', '自動受取が未設定です。トラブル時の復旧を使ってください');
    return false;
  }
  polling = true;
  try {
    setStatus('checking', '解析結果を確認しています…');
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await fetchActionResult(scanId);
        if (result.state === 'completed') return importActionPayload(result.payload);
      } catch (error) {
        setStatus('ready', `${error.message || '解析結果を取得できませんでした'}。必要なら「最近の読み取り」から復元できます`);
        return false;
      }
      if (attempt < attempts - 1) await sleep(intervalMs);
    }
    setStatus('waiting', 'まだ結果が届いていません。ChatGPTに戻り、解析後に表示される「許可」を押してください');
    return false;
  } finally {
    polling = false;
  }
}

async function restoreActionScan(scanId) {
  const clean = String(scanId || '').trim();
  if (!clean) throw new Error('復元IDがありません');
  setStatus('checking', '保存された解析結果を復元しています…');
  const result = await fetchActionResult(clean);
  if (result.state !== 'completed') {
    setStatus('waiting', '保存された解析結果がまだ見つかりません。復元IDを確認してください');
    return false;
  }
  return importActionPayload(result.payload, { force: true });
}

function injectStyles() {
  if ($('#actionReturnStyles')) return;
  const style = document.createElement('style');
  style.id = 'actionReturnStyles';
  style.textContent = `
    .action-setup-tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .action-setup-tools>*{flex:1 1 160px}
    .action-config-status{margin-top:10px;font-size:12px;color:#68756d;overflow-wrap:anywhere}
    .action-deploy-link{text-decoration:none;display:flex;align-items:center;justify-content:center}
  `;
  document.head.appendChild(style);
}

function setup() {
  injectStyles();
  injectSettings();

  $('#imageInput')?.addEventListener('change', event => {
    if (!event.target.files?.length) return;
    startNewScan();
    clearAwaiting();
    setStatus(isConfigured() ? 'ready' : 'manual', isConfigured() ? '写真を準備しました。次は「ChatGPTを開く」を押してください' : '写真を準備しました。自動受取設定を確認してください');
  });

  $('#chatgptShareBtn')?.addEventListener('click', () => {
    const scan = ensureActiveScan();
    setAwaiting(scan.scanId);
    setActiveScanStatus('shared', { sharedAt: new Date().toISOString() });
    if (isConfigured()) {
      setStatus('waiting', 'ChatGPTで画像を送信し、解析後に必ず「許可」を押してください。終わったらアプリへ戻ってください');
    }
  });

  $('#checkActionResultBtn')?.addEventListener('click', () => pollBurst({ attempts: 3, intervalMs: 800, userInitiated: true }));

  globalThis.addEventListener('order-sheet-restore-scan', event => {
    restoreActionScan(event.detail?.scanId).catch(error => setStatus('ready', error.message || '復元できませんでした'));
  });
  window.addEventListener('focus', () => setTimeout(() => pollBurst(), 120));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(() => pollBurst(), 120);
  });

  const awaiting = getAwaitingScanId();
  if (awaiting && isConfigured()) setTimeout(() => pollBurst(), 250);
}

if (typeof document !== 'undefined') setup();

export { fetchActionResult, pollBurst, readConfig, restoreActionScan, testConnection };
