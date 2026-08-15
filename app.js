import { OrderDb } from './db.js';
import { aggregateRecognitions, parseAnalysisPayload, resolveRecognitionItem, uid } from './lib.js';
import { analyzeWithBackend, buildPrompt, SAMPLE_ANALYSIS, shareToChatGPT } from './ai.js';

const db = new OrderDb();
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
  files: [],
  recognitions: [],
  sessionId: uid('session'),
  writerTag: '',
  installPrompt: null
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toast(message, type = 'info') {
  const el = $('#toast');
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function formatConfidence(value = 0) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function setTab(name) {
  $$('.tab-button').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
  $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
  if (name === 'products') renderProducts();
  if (name === 'data') renderDataStats();
}

function renderHeaderStats() {
  $('#productCount').textContent = db.data.products.length;
  $('#aliasCount').textContent = db.data.aliases.length;
  const confirmed = db.data.recognitionHistory.filter(h => h.status === 'confirmed').length;
  $('#learnedCount').textContent = confirmed;
}

function renderFiles() {
  const container = $('#filePreviews');
  if (!state.files.length) {
    container.innerHTML = '<div class="empty-mini">注文票を撮影または選択してください</div>';
    return;
  }
  container.innerHTML = state.files.map((file, index) => {
    const url = URL.createObjectURL(file);
    return `<figure class="preview-card">
      <img src="${url}" alt="注文票 ${index + 1}">
      <figcaption>${escapeHtml(file.name || `画像 ${index + 1}`)}</figcaption>
    </figure>`;
  }).join('');
}

function setFiles(fileList) {
  state.files = Array.from(fileList || []).filter(file => file.type.startsWith('image/'));
  renderFiles();
  $('#selectedCount').textContent = `${state.files.length}枚`;
}

function currentWriterTag() {
  const tag = $('#writerTag').value.trim();
  state.writerTag = tag;
  if (tag) db.addWriter(tag);
  return tag;
}

function enrichPromptText() {
  const prompt = buildPrompt(db.data);
  $('#promptPreview').value = prompt;
  return prompt;
}

async function copyPrompt() {
  const prompt = enrichPromptText();
  await navigator.clipboard.writeText(prompt);
  toast('解析プロンプトをコピーしました');
}

async function sendToChatGPT() {
  if (!state.files.length) {
    toast('先に注文票の画像を選んでください', 'warn');
    return;
  }
  const prompt = enrichPromptText();
  try {
    const result = await shareToChatGPT(state.files, prompt);
    toast(result.method === 'share'
      ? '共有先でChatGPTを選び、返ってきたJSONをこの画面に貼り付けてください'
      : 'プロンプトをコピーしてChatGPTを開きました。画像も添付してください');
  } catch (error) {
    if (error?.name !== 'AbortError') toast(error.message || '共有に失敗しました', 'error');
  }
}

function ingestItems(items, source = 'manual') {
  const writerTag = currentWriterTag();
  state.recognitions = items.map(item => resolveRecognitionItem(item, db.data, writerTag));
  state.recognitions.forEach(item => {
    if (item.status === 'auto' && item.matchedProductId) {
      db.addAlias(item.matchedProductId, item.rawName, {
        source: 'auto-match', verified: false, writerTag, incrementHit: 1
      });
    }
  });
  db.saveSession({
    id: state.sessionId,
    writerTag,
    source,
    imageCount: state.files.length,
    recognitionCount: state.recognitions.length,
    resolvedCount: state.recognitions.filter(r => r.matchedProductId).length
  });
  renderReview();
  renderTotals();
  renderHeaderStats();
  $('#resultArea').hidden = false;
  $('#reviewArea').hidden = false;
  $('#resultArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function parsePastedResult() {
  try {
    const items = parseAnalysisPayload($('#analysisJson').value);
    ingestItems(items, 'chatgpt-paste');
    toast(`${items.length}件を読み込みました`);
  } catch (error) {
    toast(error.message || 'JSONを読み込めませんでした', 'error');
  }
}

function useSample() {
  $('#analysisJson').value = JSON.stringify(SAMPLE_ANALYSIS, null, 2);
  ingestItems(parseAnalysisPayload(SAMPLE_ANALYSIS), 'sample');
  toast('サンプルデータで動作確認しています');
}

async function analyzeBackend() {
  if (!state.files.length) {
    toast('先に注文票の画像を選んでください', 'warn');
    return;
  }
  const endpoint = db.data.settings.backendEndpoint;
  if (!endpoint) {
    toast('「データ・設定」で安全なAIバックエンドURLを設定してください', 'warn');
    setTab('data');
    return;
  }
  const button = $('#backendAnalyzeBtn');
  button.disabled = true;
  button.textContent = '解析中…';
  try {
    const items = await analyzeWithBackend({
      endpoint,
      files: state.files,
      prompt: enrichPromptText(),
      writerTag: currentWriterTag()
    });
    $('#analysisJson').value = JSON.stringify({ items }, null, 2);
    ingestItems(items, 'backend');
    toast('AIバックエンドの解析が完了しました');
  } catch (error) {
    toast(error.message || 'AI解析に失敗しました', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'バックエンドで自動解析';
  }
}

function productById(id) {
  return db.data.products.find(p => p.id === id);
}

function resolveToProduct(recognitionId, productId) {
  const item = state.recognitions.find(r => r.id === recognitionId);
  if (!item) return;
  db.mapRecognitionToProduct(item, productId, {
    writerTag: currentWriterTag(),
    sessionId: state.sessionId
  });
  renderReview();
  renderTotals();
  renderHeaderStats();
  toast(`「${item.rawName}」を学習しました`);
}

function createProductFromRecognition(recognitionId) {
  const item = state.recognitions.find(r => r.id === recognitionId);
  if (!item) return;
  const canonicalName = window.prompt('正式な商品名を入力してください', item.rawName);
  if (!canonicalName?.trim()) return;
  const product = db.addProduct(canonicalName.trim(), '');
  db.mapRecognitionToProduct(item, product.id, {
    writerTag: currentWriterTag(),
    sessionId: state.sessionId
  });
  renderReview();
  renderTotals();
  renderHeaderStats();
  toast('新商品として登録しました。売り場は後から設定できます');
}

function renderReview() {
  const queue = state.recognitions.filter(item => !item.cancelled && item.status !== 'auto' && item.status !== 'confirmed');
  const cancelled = state.recognitions.filter(item => item.cancelled).length;
  $('#reviewBadge').textContent = queue.length;
  $('#reviewSummary').textContent = `要確認 ${queue.length}件 / 自動判定 ${state.recognitions.filter(r => r.status === 'auto').length}件${cancelled ? ` / 取消 ${cancelled}件` : ''}`;

  const list = $('#reviewList');
  if (!queue.length) {
    list.innerHTML = '<div class="success-box">要確認項目はありません。集計結果を確認してください。</div>';
    return;
  }

  list.innerHTML = queue.map(item => {
    const candidates = item.candidates.length
      ? item.candidates.map(candidate => `<button class="candidate-btn" data-recognition="${item.id}" data-product="${candidate.productId}">
          <strong>${escapeHtml(candidate.canonicalName)}</strong>
          <span>${formatConfidence(candidate.score)}${candidate.location ? ` · ${escapeHtml(candidate.location)}` : ''}</span>
        </button>`).join('')
      : '<div class="muted">近い登録商品がありません</div>';
    return `<article class="review-card">
      <div class="review-head">
        <div>
          <span class="eyebrow">AI読み取り</span>
          <h3>${escapeHtml(item.rawName)}</h3>
        </div>
        <div class="qty-chip">× ${item.quantity}</div>
      </div>
      <div class="confidence-row">候補信頼度 <strong>${formatConfidence(item.confidence)}</strong></div>
      <div class="candidate-list">${candidates}</div>
      <button class="text-button new-product-btn" data-recognition="${item.id}">＋ 新しい商品として登録</button>
    </article>`;
  }).join('');

  $$('.candidate-btn').forEach(button => button.addEventListener('click', () => resolveToProduct(button.dataset.recognition, button.dataset.product)));
  $$('.new-product-btn').forEach(button => button.addEventListener('click', () => createProductFromRecognition(button.dataset.recognition)));
}

function locationOptions(current = '') {
  return ['', 'A', 'B', 'C', 'D', 'E'].map(loc =>
    `<option value="${loc}" ${loc === current ? 'selected' : ''}>${loc || '未設定'}</option>`
  ).join('');
}

function summaryText(totals) {
  const groups = new Map();
  for (const item of totals) {
    const location = item.location || '未設定';
    if (!groups.has(location)) groups.set(location, []);
    groups.get(location).push(item);
  }
  return [...groups.entries()].map(([location, items]) =>
    `【${location}】\n${items.map(item => `${item.canonicalName} × ${item.quantity}`).join('\n')}`
  ).join('\n\n');
}

function renderTotals() {
  const totals = aggregateRecognitions(state.recognitions, db.data.products);
  $('#totalProductCount').textContent = totals.length;
  $('#totalQuantity').textContent = totals.reduce((sum, item) => sum + item.quantity, 0);

  const grouped = new Map();
  for (const item of totals) {
    const key = item.location || '未設定';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  const order = ['A', 'B', 'C', 'D', 'E', '未設定'];
  $('#totalsList').innerHTML = order
    .filter(location => grouped.has(location))
    .map(location => `<section class="location-group">
      <div class="location-title"><span>${location}</span><small>${grouped.get(location).length}商品</small></div>
      ${grouped.get(location).map(item => `<div class="total-row">
        <div class="total-name">${escapeHtml(item.canonicalName)}</div>
        <div class="total-qty">${item.quantity}</div>
        <select class="location-select" data-product="${item.productId}" aria-label="売り場">${locationOptions(item.location)}</select>
      </div>`).join('')}
    </section>`).join('') || '<div class="empty-state">確定した商品がまだありません</div>';

  $$('.location-select').forEach(select => select.addEventListener('change', () => {
    db.setLocation(select.dataset.product, select.value);
    renderTotals();
    renderProducts();
    toast('売り場を更新しました');
  }));

  db.saveSession({
    id: state.sessionId,
    totals,
    resolvedCount: totals.length,
    writerTag: currentWriterTag(),
    imageCount: state.files.length
  });
}

async function shareSummary() {
  const totals = aggregateRecognitions(state.recognitions, db.data.products);
  if (!totals.length) return toast('共有できる集計結果がありません', 'warn');
  const text = summaryText(totals);
  try {
    if (navigator.share) await navigator.share({ title: '商品別 集計結果', text });
    else {
      await navigator.clipboard.writeText(text);
      toast('集計結果をコピーしました');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') toast('共有に失敗しました', 'error');
  }
}

function renderProducts() {
  const query = ($('#productSearch')?.value || '').trim().toLowerCase();
  const products = db.data.products
    .filter(product => !query || product.canonicalName.toLowerCase().includes(query) || db.data.aliases.some(a => a.productId === product.id && a.alias.toLowerCase().includes(query)))
    .sort((a, b) => (a.location || 'Z').localeCompare(b.location || 'Z', 'ja') || a.canonicalName.localeCompare(b.canonicalName, 'ja'));

  $('#productList').innerHTML = products.map(product => {
    const aliases = db.data.aliases.filter(a => a.productId === product.id);
    const humanLearned = aliases.filter(a => a.source === 'human-correction').length;
    return `<article class="product-card">
      <div class="product-main">
        <div>
          <h3>${escapeHtml(product.canonicalName)}</h3>
          <div class="alias-line">${aliases.slice(0, 5).map(a => `<span>${escapeHtml(a.alias)}</span>`).join('')}${aliases.length > 5 ? `<span>+${aliases.length - 5}</span>` : ''}</div>
        </div>
        <select class="db-location-select" data-product="${product.id}">${locationOptions(product.location)}</select>
      </div>
      <div class="product-meta">表記 ${aliases.length}件 · 手動学習 ${humanLearned}件</div>
      <button class="text-button add-alias-btn" data-product="${product.id}">＋ 別の書き方を登録</button>
    </article>`;
  }).join('') || '<div class="empty-state">該当する商品がありません</div>';

  $$('.db-location-select').forEach(select => select.addEventListener('change', () => {
    db.setLocation(select.dataset.product, select.value);
    renderProducts();
    renderTotals();
  }));
  $$('.add-alias-btn').forEach(button => button.addEventListener('click', () => {
    const product = productById(button.dataset.product);
    const alias = window.prompt(`「${product.canonicalName}」の別表記を入力`, '');
    if (!alias?.trim()) return;
    db.addAlias(product.id, alias.trim(), { source: 'human-manual', verified: true, writerTag: currentWriterTag() });
    renderProducts();
    renderHeaderStats();
    toast('別表記を登録しました');
  }));
}

function addProductManually() {
  const name = window.prompt('正式な商品名を入力してください', '');
  if (!name?.trim()) return;
  db.addProduct(name.trim(), '');
  renderProducts();
  renderHeaderStats();
  toast('商品を追加しました');
}

function renderDataStats() {
  $('#dataProductCount').textContent = db.data.products.length;
  $('#dataAliasCount').textContent = db.data.aliases.length;
  $('#dataHistoryCount').textContent = db.data.recognitionHistory.length;
  $('#dataSessionCount').textContent = db.data.sessions.length;
  $('#backendEndpoint').value = db.data.settings.backendEndpoint || '';
  $('#providerLabel').value = db.data.settings.providerLabel || '';
}

function saveSettings() {
  const endpoint = $('#backendEndpoint').value.trim();
  if (endpoint && !/^https:\/\//i.test(endpoint)) {
    toast('バックエンドURLは https:// から始めてください', 'error');
    return;
  }
  db.updateSettings({
    backendEndpoint: endpoint,
    providerLabel: $('#providerLabel').value.trim() || 'AI backend'
  });
  toast('設定を保存しました');
}

function downloadBackup() {
  const blob = new Blob([db.exportJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `order-sheet-db-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('学習DBを書き出しました');
}

async function importBackup(file) {
  if (!file) return;
  try {
    db.importJson(await file.text());
    renderHeaderStats();
    renderProducts();
    renderDataStats();
    toast('学習DBを復元しました');
  } catch (error) {
    toast(error.message || 'バックアップを読み込めませんでした', 'error');
  }
}

function resetDb() {
  if (!window.confirm('学習した商品・表記・履歴を初期化します。先にバックアップを推奨します。続けますか？')) return;
  db.reset();
  state.recognitions = [];
  renderHeaderStats();
  renderProducts();
  renderDataStats();
  renderTotals();
  toast('データベースを初期化しました');
}

function setupInstall() {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.installPrompt = event;
    $('#installBtn').hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    $('#installBtn').hidden = true;
  });
}

function setupEvents() {
  $$('.tab-button').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
  $('#imageInput').addEventListener('change', event => setFiles(event.target.files));
  $('#writerTag').addEventListener('change', currentWriterTag);
  $('#copyPromptBtn').addEventListener('click', copyPrompt);
  $('#chatgptShareBtn').addEventListener('click', sendToChatGPT);
  $('#parseResultBtn').addEventListener('click', parsePastedResult);
  $('#sampleBtn').addEventListener('click', useSample);
  $('#backendAnalyzeBtn').addEventListener('click', analyzeBackend);
  $('#shareSummaryBtn').addEventListener('click', shareSummary);
  $('#printBtn').addEventListener('click', () => window.print());
  $('#productSearch').addEventListener('input', renderProducts);
  $('#addProductBtn').addEventListener('click', addProductManually);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#exportBtn').addEventListener('click', downloadBackup);
  $('#importInput').addEventListener('change', event => importBackup(event.target.files?.[0]));
  $('#resetBtn').addEventListener('click', resetDb);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
  }
}

function init() {
  renderHeaderStats();
  renderFiles();
  renderProducts();
  renderDataStats();
  enrichPromptText();
  setupEvents();
  setupInstall();
  registerServiceWorker();
}

init();
